/**
 * Display-side cleanup for live transcripts.
 *
 * Deepgram returns what the caller said, so an identifier arrives as
 * "plus one triple five two three four five six seven eight". That is correct
 * transcription but unreadable on screen. This rewrites runs of spoken digits into
 * the digits themselves, leaving ordinary prose untouched.
 *
 * This is presentation only. The authoritative canonicalization for tool arguments
 * happens in `backend/app/normalization.py`, so a display bug can never change what
 * gets looked up in the database.
 */

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  nought: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const REPEAT_WORDS: Record<string, number> = { double: 2, triple: 3, quadruple: 4 };

/** A shorter run than this is far more likely to be prose ("one moment", "two things"). */
const MIN_DIGIT_RUN = 3;

const DIGIT_WORD_PATTERN = Object.keys(DIGIT_WORDS).join("|");

/** Rewrites "triple five" as "five five five" so the run counter sees each digit. */
export function expandRepeatedDigits(text: string): string {
  const pattern = new RegExp(`\\b(double|triple|quadruple)\\s+(${DIGIT_WORD_PATTERN}|\\d)\\b`, "gi");
  return text.replace(pattern, (_match, repeat: string, digit: string) =>
    Array.from({ length: REPEAT_WORDS[repeat.toLowerCase()] }, () => digit).join(" "),
  );
}

/** Renders a 10- or 11-digit run in the same shape the tenant database uses. */
export function formatPhoneDigits(digits: string): string {
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return digits;
  return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

type Token = { text: string; isDigitWord: boolean; digit: string };

function tokenize(text: string): Token[] {
  return text.split(/(\s+)/).map((chunk) => {
    const bare = chunk.toLowerCase().replace(/[^a-z0-9]/g, "");
    const digit = DIGIT_WORDS[bare];
    return { text: chunk, isDigitWord: digit !== undefined, digit: digit ?? "" };
  });
}

function collapseRun(run: Token[], hadPlusOne: boolean): string {
  const digits = run.map((token) => token.digit).join("");
  const withCountryCode = hadPlusOne && !digits.startsWith("1") ? `1${digits}` : digits;
  const formatted = formatPhoneDigits(withCountryCode);
  if (formatted !== withCountryCode) return formatted;
  return hadPlusOne ? `+${withCountryCode}` : digits;
}

/**
 * Collapses spoken digit runs into readable numbers.
 *
 * "plus one triple five two three four five six seven eight" -> "+1 (555) 234-5678"
 * "one moment please" -> unchanged (a single digit word is prose, not an identifier)
 */
export function formatSpokenText(text: string): string {
  if (!text) return text;

  const tokens = tokenize(expandRepeatedDigits(text));
  const output: string[] = [];
  // `runSpaces[i]` is the whitespace that followed `run[i]`, kept so a run that turns
  // out to be prose can be re-emitted exactly as the caller said it.
  let run: Token[] = [];
  let runSpaces: string[] = [];
  let pendingWhitespace = "";

  const flushRun = () => {
    if (!run.length) return;
    if (run.length >= MIN_DIGIT_RUN) {
      // A "plus" immediately ahead of the run is a spoken country code, not prose.
      let hadPlusOne = false;
      for (let i = output.length - 1; i >= 0; i -= 1) {
        const previous = output[i].trim().toLowerCase().replace(/[^a-z+]/g, "");
        if (!previous) continue;
        if (previous === "plus" || previous === "+") {
          hadPlusOne = true;
          output.splice(i, output.length - i);
          output.push(" ");
        }
        break;
      }
      output.push(collapseRun(run, hadPlusOne));
    } else {
      run.forEach((token, index) => {
        output.push(token.text);
        if (runSpaces[index]) output.push(runSpaces[index]);
      });
    }
    run = [];
    runSpaces = [];
  };

  for (const token of tokens) {
    if (/^\s+$/.test(token.text)) {
      if (run.length) pendingWhitespace += token.text;
      else output.push(token.text);
      continue;
    }
    if (token.isDigitWord) {
      if (run.length) runSpaces[run.length - 1] = pendingWhitespace;
      pendingWhitespace = "";
      run.push(token);
      continue;
    }
    const trailing = pendingWhitespace;
    pendingWhitespace = "";
    flushRun();
    if (trailing) output.push(trailing);
    output.push(token.text);
  }
  flushRun();
  if (pendingWhitespace) output.push(pendingWhitespace);

  return output.join("").replace(/[ \t]{2,}/g, " ").trim();
}
