import { describe, expect, it } from "vitest";
import { buildVapiTools } from "./vapiTools";

const SERVER = "https://example.trycloudflare.com/api/voice-agent/tools";

const tenantTools = [
  { name: "normalize_identifier", description: "Canonicalize the caller's identifier.", parameters: { type: "object", properties: {} } },
  { name: "begin_tenant_lookup", description: "Find the account.", parameters: { type: "object", properties: {} } },
];

describe("buildVapiTools", () => {
  it("suppresses Vapi's built-in filler by sending an empty messages array", () => {
    // Regression from a live call: with no `messages`, Vapi speaks "Hold on a sec" /
    // "One moment" / "This'll just take a sec" on every tool call. These come from
    // Vapi, not the model, so the system prompt cannot suppress them.
    const tools = buildVapiTools(tenantTools, SERVER);

    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool.messages).toEqual([]);
    }
  });

  it("points every tool at the given server URL", () => {
    for (const tool of buildVapiTools(tenantTools, SERVER)) {
      expect(tool.server.url).toBe(SERVER);
    }
  });

  it("preserves name, description and parameters verbatim", () => {
    const [tool] = buildVapiTools([tenantTools[0]], SERVER);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("normalize_identifier");
    expect(tool.function.description).toBe("Canonicalize the caller's identifier.");
    expect(tool.function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("drops malformed tool definitions rather than sending a broken schema", () => {
    const tools = buildVapiTools(
      [null, "nope", {}, { name: "x" }, { name: "y", description: "d" }, tenantTools[0]],
      SERVER,
    );
    expect(tools.map((t) => t.function.name)).toEqual(["normalize_identifier"]);
  });

  it("returns an empty list when the tenant has no tools", () => {
    expect(buildVapiTools([], SERVER)).toEqual([]);
  });
});

describe("backend-owned tool boundaries", () => {
  it("does not expose interaction finalization to the live assistant", () => {
    const tools = buildVapiTools([
      ...tenantTools,
      { name: "log_interaction", description: "backend only", parameters: { type: "object", properties: {} } },
    ], SERVER);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      "normalize_identifier",
      "begin_tenant_lookup",
    ]);
  });
});
