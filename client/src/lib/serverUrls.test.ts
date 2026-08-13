import { describe, expect, it } from "vitest";
import {
  checkWebhookReachable,
  isLocallyScopedUrl,
  resolveEventServerUrl,
  resolveToolServerUrl,
} from "./serverUrls";

const TUNNEL = "https://hope-flights-donald-bench.trycloudflare.com";
const LOCAL = "http://localhost:3005";

describe("webhook URL resolution", () => {
  it("falls back to the page origin when no public URL is configured", () => {
    expect(resolveToolServerUrl(LOCAL)).toBe(`${LOCAL}/api/voice-agent/tools`);
    expect(resolveEventServerUrl(LOCAL)).toBe(`${LOCAL}/api/voice-agent/events`);
  });

  it("prefers the configured public URL over the page origin", () => {
    expect(resolveToolServerUrl(LOCAL, TUNNEL)).toBe(`${TUNNEL}/api/voice-agent/tools`);
    expect(resolveEventServerUrl(LOCAL, TUNNEL)).toBe(`${TUNNEL}/api/voice-agent/events`);
  });

  it("routes tools and events through the same public host", () => {
    // Regression: the tool webhook was moved to the tunnel but the event webhook was
    // left on window.location.origin, so no call was ever recorded server-side.
    const tools = new URL(resolveToolServerUrl(LOCAL, TUNNEL));
    const events = new URL(resolveEventServerUrl(LOCAL, TUNNEL));
    expect(events.origin).toBe(tools.origin);
  });

  it("tolerates a trailing slash on the configured URL", () => {
    expect(resolveToolServerUrl(LOCAL, `${TUNNEL}/`)).toBe(`${TUNNEL}/api/voice-agent/tools`);
    expect(resolveEventServerUrl(LOCAL, `${TUNNEL}///`)).toBe(`${TUNNEL}/api/voice-agent/events`);
  });
});

describe("isLocallyScopedUrl", () => {
  it("flags hosts that only resolve on the serving machine", () => {
    for (const url of [
      "http://localhost:3005/api/voice-agent/tools",
      "http://127.0.0.1:3000/api/voice-agent/events",
      "http://0.0.0.0:8080/x",
      "http://[::1]:3005/x",
      "http://macbook.local:3005/x",
    ]) {
      expect(isLocallyScopedUrl(url), url).toBe(true);
    }
  });

  it("accepts a publicly reachable tunnel host", () => {
    expect(isLocallyScopedUrl(`${TUNNEL}/api/voice-agent/tools`)).toBe(false);
    expect(isLocallyScopedUrl("https://api.example.com/api/voice-agent/tools")).toBe(false);
  });
});

describe("checkWebhookReachable", () => {
  const ok = async () => ({ ok: true }) as Response;
  const notOk = async () => ({ ok: false }) as Response;
  const boom = async () => { throw new Error("network"); };

  it("reports reachable when the public health route answers", async () => {
    await expect(checkWebhookReachable(LOCAL, TUNNEL, ok as unknown as typeof fetch))
      .resolves.toEqual({ reachable: true });
  });

  it("flags a local URL without making a request", async () => {
    let called = false;
    const spy = (async () => { called = true; return { ok: true } as Response; }) as unknown as typeof fetch;
    await expect(checkWebhookReachable(LOCAL, undefined, spy))
      .resolves.toEqual({ reachable: false, reason: "local" });
    expect(called).toBe(false);
  });

  it("flags a dead tunnel, which is what a stale hostname looks like", async () => {
    // Regression: a page loaded against a tunnel URL that later died kept advertising
    // it to Vapi. Tool calls were dispatched and silently never arrived.
    await expect(checkWebhookReachable(LOCAL, TUNNEL, boom as unknown as typeof fetch))
      .resolves.toEqual({ reachable: false, reason: "unreachable" });
  });

  it("treats a non-2xx response as unreachable", async () => {
    await expect(checkWebhookReachable(LOCAL, TUNNEL, notOk as unknown as typeof fetch))
      .resolves.toEqual({ reachable: false, reason: "unreachable" });
  });
});
