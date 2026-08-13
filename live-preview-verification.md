# Live Preview Verification

On 2026-08-12, the live preview loaded successfully with Sarah's voice room showing `Voice session available` and `Begin`. Clicking `Begin` changed the room to `Opening a secure voice session` and the primary controls to `Connecting`.

The session remained in `Connecting` during the follow-up browser view; no end-to-end spoken lookup was completed in the sandbox browser because microphone/Vapi session negotiation did not reach the conversational state. Backend verification was completed separately through the live HTTP tool endpoint: `CUST-10042` normalized to `cust10042` and returned `verification_required`; `+15552345678` normalized to `15552345678` and returned `verification_required`. The server persisted redacted tool-call traces for both flows.

The follow-up browser view showed the session returned to `Session ended` with the visible Vapi error `daily-error` / `Meeting has ended` at 18:13:12. This is a Vapi session-level failure after connection, not a lookup normalization failure; no microphone transcript or tool event was produced in the sandbox preview session.
