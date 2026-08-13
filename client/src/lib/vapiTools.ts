/**
 * Builds the Vapi function-tool definitions from the tenant's configured tools.
 *
 * `messages: []` is deliberate. When a function tool carries no `messages` array, Vapi
 * speaks one of its built-in fillers on every tool call — "Hold on a sec", "One
 * moment", "Just a sec", "Give me a moment", "This'll just take a sec" — and two
 * parallel tool calls emit it twice back to back. These are injected by Vapi, not
 * produced by the model, so no prompt instruction can suppress them. Our lookups
 * return in milliseconds, so there is nothing worth stalling for.
 */

export type VapiFunctionTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
  messages: never[];
  server: { url: string };
};

export function buildVapiTools(configuredTools: unknown[], serverUrl: string): VapiFunctionTool[] {
  return configuredTools.flatMap((candidate) => {
    if (candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).name === "log_interaction") return [];
    if (!candidate || typeof candidate !== "object") return [];
    const tool = candidate as Record<string, unknown>;
    if (
      typeof tool.name !== "string" ||
      typeof tool.description !== "string" ||
      !tool.parameters ||
      typeof tool.parameters !== "object"
    ) {
      return [];
    }
    return [{
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      },
      messages: [] as never[],
      server: { url: serverUrl },
    }];
  });
}
