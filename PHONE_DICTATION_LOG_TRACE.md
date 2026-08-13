# Phone Dictation Log Trace

## Finding

The latest available browser interaction did not reach phone-number speech recognition or any backend tool call. The failure occurred before normalization and lookup, during the provider session lifecycle.

| Timestamp | Evidence | Interpretation |
|---|---|---|
| 2026-08-13 03:10:26.909Z | Session replay records a click on `client/src/pages/Home.tsx:317`; button changes from `BEGIN` to `CONNECTING` | The browser attempted to start Sarah |
| 2026-08-13 03:10:28.917Z | Network request `POST https://api.vapi.ai/call/web` returned HTTP 201 | Vapi accepted the web-call creation request |
| 2026-08-13 03:10:30.901Z | Daily room check returned HTTP 200 and `exceeded_total_minutes: true` in provider metadata | The provider room was created or checked, but the available voice-minute allowance was exhausted |
| 2026-08-13 03:10:42.901Z | Session replay sees the greeting transcript bubble, but no user speech event follows | No phone dictation reached the transcript/tool pipeline in the captured interval |
| 2026-08-13 03:10:00Z onward | `server/tool-call-log.json` has no new entries | `/api/voice-agent/tools` was not invoked for this session; therefore `normalize_identifier`, lookup, and verification did not run |

## Exact Runtime Path

The start button is handled by `client/src/pages/Home.tsx`, `startCall()` around lines 204–232. It creates the inline Sarah assistant using the tenant configuration and calls `vapi.start(...)`.

The client receives Vapi messages in the `vapi.on("message", ...)` handler around lines 161–180. Transcript messages are reduced by `client/src/lib/vapiSession.ts`; tool messages are extracted by `extractVapiToolEvents(...)` and rendered in `client/src/pages/Home.tsx`.

Vapi sends tool calls to `POST /api/voice-agent/tools` in `server/_core/index.ts` around lines 51–77. That route calls `dispatchToolCall(...)` in `server/voiceAgentService.ts`, which routes `normalize_identifier`, `begin_tenant_lookup`, and `verify_tenant_record`.

The dispatcher normalizes and generates comparison candidates in `server/inputNormalization.ts`, then uses the shared candidate matcher in `server/voiceAgentService.ts` for both initial lookup and verification. Recognized tool calls are persisted to `server/tool-call-log.json` by the service trace writer.

Provider lifecycle events are sent to `POST /api/voice-agent/events` in `server/_core/index.ts` around lines 98–104. This route now persists a redacted event summary to the YAML-configured `server/voice-event-log.jsonl`, including event type, call ID, end reason, error, transcript presence, and tool count without storing raw speech content.

## Root Cause

This trace does **not** show a phone-number parsing failure. It shows a provider-side session availability failure before the user’s phone number could be transcribed. The previous UI message, `Meeting has ended`, was too generic and could make the failure look like a lookup problem. The browser diagnostic now reports that the provider voice-minute limit was reached and explicitly states that no phone transcript or tool call was available.

## What to Validate After Voice Capacity Is Available

1. Start Sarah and confirm the status transitions from `BEGIN` to `CONNECTING` to `ACTIVE`.
2. Speak a formatted phone number such as `+1 555 234 5678`.
3. Confirm the transcript contains a user turn and the tool trace shows `normalize_identifier`.
4. Confirm the normalization result is the formatted canonical number `+1 (555) 234-5678` and that lookup diagnostics include multiple comparison candidates.
5. Confirm `begin_tenant_lookup` runs only after normalization and returns either `verification_required`, `not_found`, or an explicit safe error.
6. Speak the verification date and confirm `verify_tenant_record` runs only after a successful initial lookup.
7. If no tool trace appears, inspect `server/voice-event-log.jsonl` first. A provider lifecycle error with `toolCount: 0` means the issue is before the backend matching path.
