import { describe, expect, it } from "vitest";
import { expandRepeatedDigits, formatPhoneDigits, formatSpokenText } from "./spokenText";

describe("expandRepeatedDigits", () => {
  it("expands repeat words so each digit is counted individually", () => {
    expect(expandRepeatedDigits("triple five")).toBe("five five five");
    expect(expandRepeatedDigits("double four")).toBe("four four");
  });

  it("leaves text without repeat words untouched", () => {
    expect(expandRepeatedDigits("a double espresso please")).toBe("a double espresso please");
  });
});

describe("formatPhoneDigits", () => {
  it("renders 10- and 11-digit runs in the stored database shape", () => {
    expect(formatPhoneDigits("5552345678")).toBe("+1 (555) 234-5678");
    expect(formatPhoneDigits("15552345678")).toBe("+1 (555) 234-5678");
  });

  it("returns the input unchanged when it is not a usable phone length", () => {
    expect(formatPhoneDigits("5551234")).toBe("5551234");
  });
});

describe("formatSpokenText", () => {
  it("turns a spoken phone number into a readable one", () => {
    expect(formatSpokenText("plus one triple five two three four five six seven eight"))
      .toBe("+1 (555) 234-5678");
  });

  it("keeps the surrounding sentence intact", () => {
    expect(formatSpokenText("my number is plus one triple five two three four five six seven eight thanks"))
      .toBe("my number is +1 (555) 234-5678 thanks");
  });

  it("collapses a bare digit run that is not a phone number", () => {
    expect(formatSpokenText("the code is one two three four")).toBe("the code is 1234");
  });

  it("leaves ordinary prose with isolated number words alone", () => {
    expect(formatSpokenText("one moment please")).toBe("one moment please");
    expect(formatSpokenText("I have two claims open")).toBe("I have two claims open");
  });

  it("does not collapse a run shorter than three digit words", () => {
    expect(formatSpokenText("two three")).toBe("two three");
  });

  it("handles an empty or whitespace-only transcript", () => {
    expect(formatSpokenText("")).toBe("");
    expect(formatSpokenText("   ")).toBe("");
  });

  it("is stable when applied twice, so re-rendering a line cannot drift", () => {
    const once = formatSpokenText("plus one triple five two three four five six seven eight");
    expect(formatSpokenText(once)).toBe(once);
  });
});
