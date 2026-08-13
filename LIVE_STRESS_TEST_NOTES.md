# Live Stress-Test Notes

## Run started
- Date: 2026-08-13
- Target: browser-based Observe Insurance voice room
- URL: `https://3000-isb8ae4s19ylpq0cihb34-3b6a9275.sg1.manus.computer/?from_webdev=1`

## Initial observations
- Initial page renders the expected landing page and live voice room.
- The first `BEGIN` click transitions the UI to `Connecting` / `Opening a secure voice session`.
- After a subsequent page view, the browser UI remains in `Connecting`; no transcript or assistant greeting is visible yet.
- Need to correlate this with browser console and `.manus-logs` provider events before treating it as a product failure, because Vapi startup may be asynchronous.

## Planned scenarios
- Happy path with canonical phone and CUST ID.
- Messy spoken phone number and spaced customer ID.
- Mid-utterance correction, short pause, repeated identifier.
- Authentication failure twice, customer not found, representative request, unsupported question, FAQ, and emergency statement.

## Safety note
- Emergency testing will use a simulated spoken statement only; no real emergency action will be initiated.
- No real customer data beyond the configured test fixtures will be used.
- No payment, posting, transfer, or other sensitive external operation will be performed.

## Status
- Live UI connection currently still pending; browser event/log inspection is next.

## Source matrix
- `ADVERSARIAL_TEST_MATRIX.md`
- Existing unit suites: 52 Vitest tests and 7 Pytest tests before this stress-test run.

## Tool-discovery notes
- No `AGENTS.md` was found under `/home/ubuntu`.
- Project-specific fullstack guidance was re-read before testing.

## Next evidence to capture
- `.manus-logs/browserConsole.log`
- `.manus-logs/networkRequests.log`
- `.manus-logs/devserver.log`
- Browser console output and current DOM state
- Tool activity and post-call audit state after each completed scenario

## Important caveat
- This document is a live test log, not a final readiness report.


## Continued browser state
- Browser remained on the live page after one initial navigation, one click on `BEGIN`, and one page view.
- UI text still showed `Connecting` and `Opening a secure voice session`; no assistant transcript appeared yet.
- Browser HTML snapshot available under `/home/ubuntu/browser_html/3000-isb8ae4s19ylpq0cihb34-3b6a9275_sg1_manus_computer_page_1786603334096.html` for DOM inspection if needed.
- Next action: inspect logs and console for startup failure or delayed provider response.


## Formal scenario result placeholders
| Scenario | Result | Evidence |
|---|---|---|
| SM-01 Happy path (phone) | Pending | |
| SM-02 Happy path (customer ID) | Pending | |
| SM-03 Messy phone | Pending | |
| SM-04 Messy customer ID | Pending | |
| SM-05 Self-correction | Pending | |
| SM-06 Auth failure | Pending | |
| SM-07 Auth lockout | Pending | |
| SM-08 Customer not found | Pending | |
| SM-09 Representative escalation | Pending | |
| SM-10 Unsupported question | Pending | |
| SM-11 Emergency safety | Pending | |
| SM-12 FAQ | Pending | |


## Follow-up browser/log evidence
- Pending after current `Connecting` state.


## Observed startup behavior after waiting
- Browser page still displays `Connecting` / `Opening a secure voice session` after a short wait.
- No visible transcript or tool activity was emitted before log inspection.
- This is a possible startup/provider-capacity issue and will be checked against browser console and server logs before any code change.


## Result log update
- Still pending: no provider call-start, no transcript, and no tool event visible in UI.
- Next diagnostic action is a terminal tail of the managed browser/server logs and browser console output.


## Observed browser page after initial session start
- Current page title: `Observe Insurance — Voice Support`.
- Live room status: `Opening a secure voice session`.
- Connect control: `Connecting`.
- No visible transcript bubble, no visible tool activity, and no final call state.
- A preview-mode banner is visible at the bottom of the browser viewport; this is expected for the WebDev preview and does not itself indicate an application error.

## Browser interaction sequence
1. Navigated to `/?from_webdev=1`.
2. Clicked `BEGIN`.
3. Waited and viewed the page once.
4. Captured the clean viewport screenshots returned by the browser operations.

## Evidence files
- `/home/ubuntu/page_texts/3000-isb8ae4s19ylpq0cihb34-3b6a9275.sg1.manus.computer__from_webdev_1.md`
- `/home/ubuntu/screenshots/3000-isb8ae4s19ylpq0_2026-08-13_06-41-57_9042.webp`
- `/home/ubuntu/screenshots/3000-isb8ae4s19ylpq0_2026-08-13_06-42-05_1413.webp`
- `/home/ubuntu/screenshots/3000-isb8ae4s19ylpq0_2026-08-13_06-42-11_3600.webp`

## Current conclusion
- Cannot yet exercise voice input because the session has not reached `active` state.
- Need to determine whether startup is blocked by provider configuration, voice-minute capacity, or a client-side event handling issue.

## Live UI result: provider capacity blocker

The first real browser voice-session attempt reached the provider but ended without opening audio. Sarah's UI displayed: `Vapi/Daily ended the session because the provider voice-minute limit was reached. No phone transcript or tool call was available to normalize or look up the caller.` Therefore no actual microphone utterance could be submitted in this run. This is an external provider-capacity blocker, not evidence that the speech pipeline handled or mishandled messy input.

The page recovered to the idle `Begin` state after the provider ended the session. The UI remained navigable; selecting `View FAQs` scrolled to the FAQ section while preserving the session-ended notice. This path did not show a frontend exception.

## Direct FastAPI adversarial results

A repeatable runner was created at `scripts/runAdversarialApi.mjs` and executed against `http://127.0.0.1:8000`. The active service is `backend/app/server.py`, not the older `python/server.py` launcher.

| Scenario | Result | Evidence |
|---|---|---|
| Messy spoken phone normalization | Pass at HTTP level; active backend returned `+1 (555) 234-5678` | Runner output for SM-03 |
| Messy spaced CUST ID normalization | Pass at HTTP level; active backend returned `cust-10042` | Runner output for SM-04 |
| Canonical phone lookup | Pass; returned verification required for `CUST-10042` | Runner output for SM-01 |
| Canonical CUST ID lookup | Pass; returned verification required for `CUST-10042` | Runner output for SM-02 |
| Customer not found | Pass; returned `status: not_found` | Runner output for SM-08 |
| Authentication failure | Pass; returned `status: auth_failure` | Runner output for SM-06 |
| Authentication success test as written | Fail; fixture's active `verificationFactor` did not match the expected `November 20, 1988` value used by the old test | Runner output for SM-07; requires fixture/test contract reconciliation |
| Escalation interaction log | Pass; returned `logged: true` and preserved escalation flag | Runner output for SM-09 |
| Event webhook | Pass; returned `received: true`, `logged: true` | Runner output for SM-11 |
| Unknown tool rejection | Fail contract; returned HTTP 200 with `{ok:false,error:...}` instead of HTTP 400 | Runner output for SM-12; API should choose one consistent error contract |

## Important interpretation

The direct backend runner demonstrates that the active backend can normalize messy text, match the configured customer, reject a non-matching account, report authentication failure, and append an interaction record. It does not replace a real Vapi microphone test because the provider ended the session before speech was available. The two concrete backend issues found are the authentication-success fixture/contract mismatch and inconsistent unknown-tool HTTP error semantics.

## Vapi custom-tool response contract reference

Vapi's custom-tool troubleshooting documentation specifies that a tool-call webhook must return HTTP 200, an outer `results` array, an exactly matched `toolCallId`, and string-valued `result` or `error` entries; non-200 responses can be ignored by the provider. The active lookup-handoff repair must therefore validate the actual Vapi batch payload and preserve that provider contract instead of treating ordinary tool failures as HTTP errors. Sources: https://docs.vapi.ai/tools/custom-tools-troubleshooting and https://docs.vapi.ai/server-url/events.
