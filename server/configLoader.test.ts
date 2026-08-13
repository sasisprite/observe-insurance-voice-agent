import { describe, expect, it } from "vitest";
import {
  ConfigValidationError,
  VAPI_MAX_ENDPOINTING_MS,
  loadConfig,
  validateConfig,
} from "./configLoader";

describe("centralized voice configuration", () => {
  it("loads an endpointing value accepted by Vapi", () => {
    const config = loadConfig();

    expect(config.voice.endpointing_ms).toBeLessThanOrEqual(VAPI_MAX_ENDPOINTING_MS);
    expect(config.voice.endpointing_ms).toBeGreaterThanOrEqual(0);
  });

  it("loads the tenant tool registry beneath the selected tenant", () => {
    const config = loadConfig();
    const tenant = config.tenants["observe-insurance"];

    expect(tenant.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "normalize_identifier",
      "begin_tenant_lookup",
      "verify_tenant_record",
    ]);
  });

  it("accepts the provider's inclusive 500 ms maximum", () => {
    const config = loadConfig();

    expect(() =>
      validateConfig({
        ...config,
        voice: { ...config.voice, endpointing_ms: VAPI_MAX_ENDPOINTING_MS },
      }),
    ).not.toThrow();
  });

  it("rejects endpointing values above the provider maximum", () => {
    const config = loadConfig();

    expect(() =>
      validateConfig({
        ...config,
        voice: { ...config.voice, endpointing_ms: VAPI_MAX_ENDPOINTING_MS + 1 },
      }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      validateConfig({
        ...config,
        voice: { ...config.voice, endpointing_ms: VAPI_MAX_ENDPOINTING_MS + 1 },
      }),
    ).toThrow("voice.endpointing_ms");
  });

  it("rejects negative and non-numeric endpointing values", () => {
    const config = loadConfig();

    expect(() =>
      validateConfig({ ...config, voice: { ...config.voice, endpointing_ms: -1 } }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      validateConfig({
        ...config,
        voice: { ...config.voice, endpointing_ms: Number.NaN },
      }),
    ).toThrow(ConfigValidationError);
  });
});
