import { describe, expect, it } from "vitest";

describe("OpenRouter secret validation", () => {
  it("has a configured OpenRouter API key and successfully connects to OpenRouter models endpoint", async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    expect(apiKey).toMatch(/^sk-or-v1-/);

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data).toBeInstanceOf(Array);
  }, 15_000);
});
