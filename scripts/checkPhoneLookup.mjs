import { dispatchToolCall } from "../server/voiceAgentService.ts";

const inputs = [
  "+1 (555) 234-5678",
  "+15552345678",
  "1 555 234 5678",
  "5552345678",
  "plus one, triple five, two three four, five six seven eight",
];

const rows = inputs.map((rawIdentifier) => {
  const normalized = dispatchToolCall({
    tenantId: "observe-insurance",
    toolName: "normalize_identifier",
    arguments: { rawIdentifier },
    callId: `manual-normalize-${rawIdentifier}`,
  });
  const normalizedIdentifier = normalized.ok && typeof normalized.data?.normalizedIdentifier === "string"
    ? normalized.data.normalizedIdentifier
    : undefined;
  const lookup = normalizedIdentifier
    ? dispatchToolCall({
        tenantId: "observe-insurance",
        toolName: "begin_tenant_lookup",
        arguments: { identifier: normalizedIdentifier },
        callId: `manual-lookup-${rawIdentifier}`,
      })
    : null;
  return { rawIdentifier, normalized, lookup };
});

console.log(JSON.stringify(rows, null, 2));
