/**
 * Resolves the webhook URLs handed to Vapi.
 *
 * Vapi dispatches both tool calls and call events from its own cloud, so these must be
 * publicly reachable. `window.location.origin` is http://localhost:<port> during local
 * development, which Vapi cannot resolve — and neither failure surfaces as an error:
 * tool calls come back empty, and call records never arrive. Point
 * VITE_PUBLIC_SERVER_URL at a tunnel (cloudflared / ngrok) to make both work locally.
 */

export const TOOL_ROUTE = "/api/voice-agent/tools";
export const EVENT_ROUTE = "/api/voice-agent/events";
export const HEALTH_ROUTE = "/api/voice-agent/health";

export function resolveServerUrl(origin: string, routePath: string, configured?: string): string {
  return `${(configured || origin).replace(/\/+$/, "")}${routePath}`;
}

export function resolveToolServerUrl(origin: string, configured?: string): string {
  return resolveServerUrl(origin, TOOL_ROUTE, configured);
}

export function resolveEventServerUrl(origin: string, configured?: string): string {
  return resolveServerUrl(origin, EVENT_ROUTE, configured);
}

/** True when a URL only resolves on the machine that serves it, so Vapi cannot call it. */
export function isLocallyScopedUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local)(:\d+)?(\/|$)/i.test(url);
}

export type WebhookReachability =
  | { reachable: true }
  | { reachable: false; reason: "local" | "unreachable" };

/**
 * Confirms Vapi could actually reach our webhooks before a call starts.
 *
 * A quick tunnel dies on its own and gets a new hostname on every restart, and a
 * browser tab loaded against an older URL keeps using it. Both leave the caller
 * talking to an agent whose tools silently never respond, so check up front.
 */
export async function checkWebhookReachable(
  origin: string,
  configured: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000,
): Promise<WebhookReachability> {
  const url = resolveServerUrl(origin, HEALTH_ROUTE, configured);
  if (isLocallyScopedUrl(url)) return { reachable: false, reason: "local" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return response.ok ? { reachable: true } : { reachable: false, reason: "unreachable" };
  } catch {
    return { reachable: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
