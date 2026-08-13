# Vapi Debug Findings

The Vapi Web SDK quickstart documents the browser lifecycle as `new Vapi(publicKey)`, followed by `vapi.start(assistantId)`, with `call-start`, `call-end`, and `message` event listeners. It also recommends including client messages such as `transcript` when live captions are required.

The reported `Meeting has ended` / ejection message is consistent with a call ending before the user sees an active conversation. The user-facing handler currently logs the raw Vapi error object, which becomes `[object Object]` in the browser console. The repair should serialize nested `error`, `message`, `stage`, and `endedReason` fields, distinguish informational call-end events from connection failures, and prefer a pre-created Vapi assistant ID for production. The dynamic assistant override path should be checked against the current SDK schema, especially model provider, voice provider, transcriber, tool placement, and server URL field names.

References:
- https://docs.vapi.ai/quickstart/web
- https://docs.vapi.ai/calls/troubleshoot-call-errors

## Reproduction

On the live preview at `https://3000-isb8ae4s19ylpq0cihb34-3b6a9275.sg1.manus.computer/?from_webdev=1`, clicking **Begin** changes the UI from `Ready when you are` to `Opening a secure voice session` and then remains in `Connecting`; the browser trace later reports the Vapi error object and `Meeting has ended`. The failure occurs before `call-start`, so the client should not display `active` until that event arrives. The current reproduction confirms a pre-connection failure rather than a normal completed call.

## Second reproduction after patch

After changing `clientMessages` and `serverMessages` to the documented array shape and switching the inline voice to Vapi's built-in `Hana` voice, the preview still remained in `Connecting` in the sandbox browser. No new browser console payload was captured. The patched UI now has structured error formatting and a pre-connect end-state message, but the sandbox reproduction cannot complete the microphone/Vapi handshake; this remains an environment/provider configuration dependency to validate with a real browser microphone and a configured Vapi assistant.

## Timeout verification

The reducer-backed session lifecycle was exercised in the preview. The browser remained in `Connecting` while the sandbox could not complete the Vapi/microphone handshake, then transitioned automatically to `Session ended` after the YAML-configured 20-second timeout. The UI displayed the readable message: `No Vapi assistant ID is configured. The inline assistant requires an enabled Vapi model and voice provider. The connection timed out after 20 seconds.` This confirms the client-side lifecycle no longer hangs indefinitely or renders `[object Object]`; a real successful voice conversation still requires a Vapi assistant/provider configuration and a browser microphone permission.

## 2026-08-12 UX pass: Chrome deprecation report

The `AuthorizationCoveredByWildcard` report is emitted by the bundled `@vapi-ai/web` dependency through its internal `ReportingObserver`; it is not emitted by the Observe Insurance application code or the local `/api/voice-agent/tools` route. Local tenant/runtime requests return HTTP 200, and TypeScript, Vitest, and production build checks pass. The report is therefore treated as browser/provider compatibility telemetry rather than a lookup failure. The application should not suppress `console.error` globally. The practical mitigation is to keep the Vapi Web SDK current and ensure production CORS is origin-scoped when this service is deployed. Structured Vapi errors remain separate from Chrome deprecation reports.

## 2026-08-12 UX visual verification

The desktop preview now presents the verification guidance above a bounded transcript region, which uses one chronological stream with user messages right-aligned and Sarah messages left-aligned. The transcript region is capped with `max-h-64` and `overflow-y-auto`, so additional turns scroll inside the voice room instead of expanding the card. The mobile preview remains horizontally contained without a page-level horizontal scrollbar; the voice card continues below the hero as a normal responsive section.
