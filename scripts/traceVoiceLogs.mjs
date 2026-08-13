import fs from "node:fs";

const root = process.cwd();
const networkPath = `${root}/.manus-logs/networkRequests.log`;
const auditPath = `${root}/server/tool-call-log.json`;

function parseLines(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    const match = line.match(/^\[([^\]]+)\]\s+(.*)$/s);
    if (!match) return [];
    try { return [{ timestamp: match[1], payload: JSON.parse(match[2]) }]; } catch { return []; }
  });
}

const recentNetwork = parseLines(networkPath)
  .filter(({ timestamp }) => timestamp >= "2026-08-13T03:10:00.000Z")
  .map(({ timestamp, payload }) => {
    const url = String(payload.url ?? "");
    const responseBody = payload.response?.body;
    const bodyText = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody ?? "");
    return {
      timestamp,
      method: payload.method,
      url,
      status: payload.response?.status,
      error: payload.error,
      flags: {
        dailyMinutesExceeded: bodyText.includes("exceeded_total_minutes") || bodyText.includes("Meeting has ended"),
        vapiStart: url.includes("api.vapi.ai/call/web"),
        backendEventPost: url.includes("/api/voice-agent/events"),
        transcriptOrToolPayload: bodyText.includes("transcript") || bodyText.includes("tool-call") || bodyText.includes("normalize_identifier"),
      },
    };
  })
  .filter((record) => record.url.includes("api.vapi.ai") || record.url.includes("/api/voice-agent/events") || record.url.includes("daily.co") || record.error);

const audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, "utf8")) : { entries: [] };
const recentAudit = (audit.entries ?? []).filter((entry) => entry.timestamp >= "2026-08-13T03:10:00.000Z");

console.log(JSON.stringify({
  recentNetwork,
  recentAudit: recentAudit.map((entry) => ({
    timestamp: entry.timestamp,
    toolName: entry.toolName,
    arguments: entry.arguments,
    result: entry.result,
    durationMs: entry.durationMs,
  })),
}, null, 2));
