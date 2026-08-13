"""Canonicalization of speech-transcribed identifiers and dates.

The transcriber emits what the caller said, not what the database stores: a phone
number arrives as "plus one triple five two three four five six seven eight" and a
date of birth as "November twentieth nineteen eighty eight". Relying on the LLM to
emit the canonical wire format is unreliable, so the backend re-derives it here and
treats whatever the model sent as raw input.
"""

import re
from typing import List, Optional

DIGIT_WORDS = {
    "zero": "0", "oh": "0", "o": "0", "nought": "0",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9",
}

TEEN_AND_TENS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}

NUMBER_WORDS = {**{w: int(d) for w, d in DIGIT_WORDS.items()}, **TEEN_AND_TENS}

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
    "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}

ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20, "thirtieth": 30, "thirty first": 31, "thirtyfirst": 31,
}

_REPEAT_COUNTS = {"double": 2, "triple": 3, "quadruple": 4}


def expand_repeated_digits(text: str) -> str:
    """Rewrites "triple five" as "five five five" so digit extraction stays positional."""
    pattern = re.compile(
        r"\b(double|triple|quadruple)\s+(" + "|".join(DIGIT_WORDS) + r"|\d)\b",
        re.IGNORECASE,
    )
    return pattern.sub(
        lambda m: " ".join([m.group(2)] * _REPEAT_COUNTS[m.group(1).lower()]), text
    )


def spoken_digits(text: str) -> str:
    """Extracts an ordered digit string from mixed spoken/numeric text."""
    expanded = expand_repeated_digits((text or "").lower())
    digits: List[str] = []
    for token in re.findall(r"[a-z]+|\d+", expanded):
        if token in DIGIT_WORDS:
            digits.append(DIGIT_WORDS[token])
        elif token.isdigit():
            digits.append(token)
    return "".join(digits)


def format_us_phone(digits: str) -> str:
    """Renders a 10- or 11-digit string as the canonical +1 (555) 234-5678 form."""
    cleaned = re.sub(r"\D", "", digits or "")
    national = cleaned[1:] if len(cleaned) == 11 and cleaned.startswith("1") else cleaned
    if len(national) == 10:
        return f"+1 ({national[0:3]}) {national[3:6]}-{national[6:]}"
    return cleaned


def normalize_customer_id(text: str) -> Optional[str]:
    """Recovers cust-10042 from spellings such as "c u s t hyphen one zero zero four two"."""
    lowered = (text or "").lower()
    prepared = re.sub(r"\bc\s*u\s*s\s*t\b", " cust ", lowered)
    prepared = re.sub(r"\bcustomer(\s+id)?\b", " cust ", prepared)
    prepared = re.sub(r"\baccount(\s+(id|number))?\b", " cust ", prepared)
    prepared = re.sub(r"\b(hyphen|dash|minus)\b", " ", prepared)
    prepared = prepared.replace("-", " ").replace("_", " ")

    # No trailing \b: the compact "cust10042" form has no boundary before the digits.
    match = re.search(r"\bcust", prepared)
    if not match:
        return None
    digits = spoken_digits(prepared[match.end():])
    return f"cust-{digits}" if digits else None


def normalize_identifier(text: str) -> dict:
    """Canonicalizes a caller identifier and reports which kind it turned out to be."""
    raw = (text or "").strip()
    if not raw:
        return {"ok": False, "error": "Empty identifier provided", "normalizedIdentifier": "", "type": "unknown"}

    customer_id = normalize_customer_id(raw)
    if customer_id:
        return {"ok": True, "normalizedIdentifier": customer_id, "raw": raw, "type": "customerId"}

    digits = spoken_digits(raw)
    if len(digits) in (10, 11):
        return {"ok": True, "normalizedIdentifier": format_us_phone(digits), "raw": raw, "type": "phone"}

    if digits:
        return {
            "ok": False,
            "error": f"Expected a 10-digit phone number but heard {len(digits)} digits.",
            "normalizedIdentifier": digits,
            "raw": raw,
            "type": "partialPhone",
        }

    return {
        "ok": False,
        "error": "Could not read a phone number or account ID from that. Ask the caller to repeat it slowly.",
        "normalizedIdentifier": "",
        "raw": raw,
        "type": "unknown",
    }


def identifier_candidates(value: str) -> List[str]:
    """Builds every comparison form a stored record might use for this identifier."""
    raw = (value or "").strip().lower()
    if not raw:
        return []

    customer_id = normalize_customer_id(raw)
    if customer_id:
        return list(dict.fromkeys([customer_id, customer_id.replace("-", "")]))

    digits = spoken_digits(raw)
    if not digits:
        return []

    national = digits[1:] if len(digits) == 11 and digits.startswith("1") else digits
    candidates = {digits, national}
    if len(national) == 10:
        candidates.update({f"1{national}", f"+1{national}", format_us_phone(national)})
    return list(candidates)


def _parse_number_words(text: str) -> Optional[int]:
    words = [w for w in re.split(r"[\s,-]+", (text or "").lower()) if w]
    if not words:
        return None
    total = 0
    for word in words:
        if word in NUMBER_WORDS:
            total += NUMBER_WORDS[word]
        elif word.isdigit():
            total += int(word)
        else:
            return None
    return total


def _as_number(token: str) -> Optional[int]:
    if token in NUMBER_WORDS:
        return NUMBER_WORDS[token]
    return int(token) if token.isdigit() else None


def _parse_year(text: str) -> Optional[int]:
    numeric = re.search(r"\b(\d{4})\b", text or "")
    if numeric:
        return int(numeric.group(1))

    words = [w for w in re.split(r"[\s,-]+", (text or "").lower()) if w]
    if words and words[0] in ("nineteen", "twenty") and len(words) <= 3:
        suffix = _parse_number_words(" ".join(words[1:]))
        if suffix is not None and 0 <= suffix <= 99:
            return (1900 if words[0] == "nineteen" else 2000) + suffix

    # Transcribers split a spoken year into two numbers: "nineteen eighty-eight"
    # comes back as "19 88", and "two thousand five" as "20 05". Without this the
    # date is unreadable and verification fails even though the caller said it fine.
    if len(words) == 2:
        century, remainder = _as_number(words[0]), _as_number(words[1])
        if century in (19, 20) and remainder is not None and 0 <= remainder <= 99:
            return century * 100 + remainder
    return None


def _parse_day(text: str) -> Optional[int]:
    compact = re.sub(r"[^a-z0-9 ]", "", (text or "").lower()).strip()
    if compact in ORDINALS:
        return ORDINALS[compact]
    if compact.replace(" ", "") in ORDINALS:
        return ORDINALS[compact.replace(" ", "")]

    # "twenty first" / "twenty-first" style compounds
    parts = compact.split()
    if len(parts) == 2 and parts[0] in TEEN_AND_TENS and parts[1] in ORDINALS:
        return TEEN_AND_TENS[parts[0]] + ORDINALS[parts[1]]

    numeric = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", compact)
    if numeric:
        return int(numeric.group(1))
    return _parse_number_words(compact)


def _iso_date(year: int, month: int, day: int) -> Optional[str]:
    if not (1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31):
        return None
    from datetime import date
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def normalize_date(text: str) -> Optional[str]:
    """Converts ISO, US-numeric, and spoken dates into YYYY-MM-DD, or None if unreadable."""
    raw = (text or "").strip().lower()
    if not raw:
        return None

    iso = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", raw)
    if iso:
        return _iso_date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))

    us = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$", raw)
    if us:
        return _iso_date(int(us.group(3)), int(us.group(1)), int(us.group(2)))

    cleaned = re.sub(r"\b(of|the|on|my|date|birth|dob|is|born)\b", " ", raw)
    words = [w for w in re.split(r"[\s,]+", cleaned) if w]

    month_index = next((i for i, w in enumerate(words) if w.strip(".").rstrip(",") in MONTHS), None)
    if month_index is not None:
        month = MONTHS[words[month_index].strip(".").rstrip(",")]
        remainder = words[month_index + 1:]
        # "November twentieth nineteen eighty eight" -> split day words from year words.
        for split in range(1, len(remainder)):
            day = _parse_day(" ".join(remainder[:split]))
            year = _parse_year(" ".join(remainder[split:]))
            if day is not None and year is not None:
                resolved = _iso_date(year, month, day)
                if resolved:
                    return resolved
        # "twentieth of November nineteen seventy five" -> day precedes the month.
        # Longest year phrase first, so "nineteen seventy five" wins over "nineteen seventy".
        leading = words[:month_index]
        for split in range(len(remainder), 0, -1):
            day = _parse_day(" ".join(leading))
            year = _parse_year(" ".join(remainder[:split]))
            if day is not None and year is not None:
                resolved = _iso_date(year, month, day)
                if resolved:
                    return resolved

    digits = spoken_digits(raw)
    if len(digits) == 8:
        return _iso_date(int(digits[0:4]), int(digits[4:6]), int(digits[6:8]))
    return None
