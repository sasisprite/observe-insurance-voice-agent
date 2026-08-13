from typing import Any, Dict, Optional
from fastapi import HTTPException
from app.repository import repo
from app.normalization import normalize_date, normalize_identifier

# The model is asked for these argument names, but transcription-driven LLMs drift
# between synonyms. Accept the aliases rather than silently receiving an empty string.
IDENTIFIER_KEYS = ("identifier", "normalizedIdentifier", "rawIdentifier", "phone",
                   "phoneNumber", "customerId", "accountId")
VERIFICATION_KEYS = ("verificationFactor", "verificationValue", "dateOfBirth", "dob", "date_of_birth")


def _first_string(args: dict, keys: tuple) -> str:
    for key in keys:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


# Smaller tool-calling models sometimes echo the JSON schema back as the argument
# value — sending "normalizedIdentifier returned by normalize_identifier" instead of
# the caller's actual digits. Left undetected this surfaces as not_found, so the agent
# blames the caller and asks them to repeat a number that was never sent.
_SCHEMA_ECHO_MARKERS = (
    "normalizedidentifier",
    "rawidentifier",
    "verificationfactor",
    "returned by",
    "copied exactly",
    "as transcribed",
    "phone number or account id",
    "date of birth (yyyy-mm-dd)",
    "yyyy-mm-dd",
    "<",
    "{",
)


def looks_like_schema_echo(value: str) -> bool:
    """True when an argument is the parameter's own description rather than a value."""
    lowered = (value or "").strip().lower()
    if not lowered:
        return False
    if any(marker in lowered for marker in _SCHEMA_ECHO_MARKERS):
        return True
    # A value with no digits at all that just restates what was asked for.
    return not any(ch.isdigit() for ch in lowered) and lowered in {
        "phone number", "account id", "customer id", "identifier", "date of birth", "dob",
    }


def _schema_echo_error(field: str, value: str) -> dict:
    return {
        "status": "invalid_arguments",
        "ok": False,
        "authenticated": False,
        "error": f"{field} contained the parameter description, not a value.",
        "message": (
            f"You sent the schema text {value!r} as {field}. Do not describe the argument — "
            "send the caller's own words verbatim, for example 'plus 1 triple 5 2 3 4 5 6 7 8'. "
            "Do not ask the caller to repeat; you already have what they said."
        ),
    }


def normalize_identifier_logic(raw: str) -> dict:
    """Canonicalizes whatever the model heard into the wire format the repository matches on."""
    result = normalize_identifier(raw)
    if not result["ok"]:
        return {
            "ok": False,
            "error": result["error"],
            "normalizedIdentifier": result.get("normalizedIdentifier", ""),
            "type": result.get("type", "unknown"),
            "message": "Ask the caller to repeat only the phone number or account ID, slowly.",
        }
    return {
        "ok": True,
        "normalizedIdentifier": result["normalizedIdentifier"],
        "raw": result["raw"],
        "type": result["type"],
        "message": "Pass normalizedIdentifier verbatim as the identifier argument of begin_tenant_lookup.",
    }


def execute_tool(tenant_id: str, tool_name: str, args: dict) -> dict:
    args = args if isinstance(args, dict) else {}

    if tool_name == "normalize_identifier":
        raw = _first_string(args, IDENTIFIER_KEYS)
        if looks_like_schema_echo(raw):
            return _schema_echo_error("rawIdentifier", raw)
        return normalize_identifier_logic(raw)

    if tool_name == "begin_tenant_lookup":
        identifier = _first_string(args, IDENTIFIER_KEYS)
        if looks_like_schema_echo(identifier):
            return _schema_echo_error("identifier", identifier)
        if not identifier:
            return {
                "status": "invalid_arguments",
                "authenticated": False,
                "message": "identifier is required. Call normalize_identifier first and pass its normalizedIdentifier.",
            }
        # Re-normalize defensively: the model may forward the caller's raw speech.
        normalized = normalize_identifier(identifier)
        return repo.lookup_customer(tenant_id, normalized.get("normalizedIdentifier") or identifier)

    if tool_name in ("verify_tenant_record", "lookup_tenant_record"):
        identifier = _first_string(args, IDENTIFIER_KEYS)
        raw_factor = _first_string(args, VERIFICATION_KEYS)
        if looks_like_schema_echo(identifier):
            return _schema_echo_error("identifier", identifier)
        if looks_like_schema_echo(raw_factor):
            return _schema_echo_error("verificationFactor", raw_factor)
        if not identifier or not raw_factor:
            missing = "identifier" if not identifier else "verificationFactor"
            return {
                "status": "invalid_arguments",
                "authenticated": False,
                "message": f"{missing} is required. Send the same identifier used for begin_tenant_lookup plus the date of birth.",
            }
        iso_date = normalize_date(raw_factor)
        if not iso_date:
            return {
                "status": "unreadable_verification",
                "authenticated": False,
                "message": "The date of birth could not be interpreted. Ask the caller to repeat it as month, day, and year.",
            }
        normalized = normalize_identifier(identifier)
        return repo.verify_record(tenant_id, normalized.get("normalizedIdentifier") or identifier, iso_date)

    if tool_name == "log_interaction":
        raise HTTPException(status_code=400, detail="log_interaction is backend-owned")
        record = {
            "callerName": args.get("callerName", "Unknown Caller"),
            "callSummary": args.get("callSummary", "No summary provided"),
            "sentiment": args.get("sentiment", "neutral"),
            "escalated": bool(args.get("escalated", False)),
            "timestamp": args.get("timestamp") or 0,
        }
        return repo.log_interaction(tenant_id, record)

    raise HTTPException(status_code=400, detail=f"Unknown tool name: {tool_name}")
