import { describe, expect, it } from "vitest";

describe("Vapi browser configuration", () => {
  it("has a configured public key and can reach Vapi's lightweight health endpoint", async () => {
    const publicKey = process.env.VITE_VAPI_PUBLIC_KEY;
    expect(publicKey).toMatch(/^[0-9a-f-]{36}$/i);

    const response = await fetch("https://api.vapi.ai/health", {
      headers: {
        "x-vapi-public-key": publicKey!,
      },
    });

    // Public browser keys are not privileged REST credentials. The request is
    // intentionally limited to connectivity/configuration validation rather
    // than assistant mutation or account access.
    expect(response.status).toBeLessThan(500);
  }, 15_000);
});
