# Observe Insurance Voice Agent: Transcript and Tool-Call Codepath

This document maps the browser-to-backend path for Sarah’s live voice interaction. The current implementation keeps Vapi as the browser voice transport while the business workflow remains provider-neutral in the TypeScript service layer.

## 1. Browser session and transcript path

| Stage | Source path | Responsibility |
|---|---|---|
| Vapi session creation | `client/src/pages/Home.tsx:204-233` | Starts Vapi with the centralized tenant prompt, runtime endpointing value, and tenant tool registry. |
| Vapi message listener | `client/src/pages/Home.tsx:161-180` | Receives transcript and tool messages from Vapi. It forwards tool names, arguments, and results into the local reducer. |
| Session state machine | `client/src/lib/vapiSession.ts:44-126` | Tracks status, authentication stage, transcript rows, pending partial speech, and tool activity. |
| Transcript grouping | `client/src/lib/vapiSession.ts:44-80` | Merges adjacent fragments from the same speaker into one readable message, starts a new row after sentence punctuation followed by a new sentence, and preserves explicit newline paragraphs. |
| Transcript rendering | `client/src/components/TranscriptPanel.tsx:11-31` | Renders one bubble per grouped transcript row, preserves intentional newline breaks, and auto-scrolls inside the bounded panel. |

Vapi may emit several final transcript fragments for one spoken utterance. The reducer therefore does not render every provider fragment as a new bubble. Adjacent same-speaker fragments are joined with a space. A new bubble is created only when the speaker changes, the prior text ends in sentence punctuation and the next fragment begins a new sentence, or the provider sends an explicit newline boundary.

## 2. Tool registration path

The source of truth for the tool definitions is `config.yaml`, not an inline list in the React component. The selected tenant is `observe-insurance`, and its tool registry defines the descriptions and JSON schemas consumed by the model. Customer IDs use the canonical lowercase dashed form `cust-10042`; normalization lowercases input and inserts the dash, so comparisons are case-insensitive and accept hyphenated or unhyphenated caller input.

| Tool | Purpose | Expected order |
|---|---|---|
| `normalize_identifier` | Converts spoken phone numbers and account IDs into canonical values such as `15552345678` or `cust-10042`. | First, after the caller provides an identifier. |
| `begin_tenant_lookup` | Checks whether the normalized identifier matches a customer record. | Second, only after normalization. |
| `verify_tenant_record` | Checks the normalized identifier plus the verification factor, currently date of birth. | Third, after a matching account is found. |
| `log_interaction` | Writes the post-call caller name, summary, sentiment, escalation flag, and timestamp. | At call completion. |

`client/src/pages/Home.tsx:21-36` converts the tenant tool registry into Vapi function-tool definitions. `client/src/pages/Home.tsx:64-85` places those functions inside Sarah’s model configuration and points the tool server to `/api/voice-agent/tools`.

## 3. Backend invocation path

| Stage | Source path | Responsibility |
|---|---|---|
| HTTP tool endpoint | `server/_core/index.ts:49-77` | Receives Vapi `tool-calls`, resolves the tenant, parses function arguments, and dispatches each call. |
| Provider-neutral dispatcher | `server/voiceAgentService.ts:108-138` | Enforces the tenant allow-list, selects the runtime adapter, records a redacted trace, and returns a typed result. |
| Identifier adapter | `server/voiceAgentService.ts:140-166` | Calls `normalizeIdentifier()` and returns `normalizedIdentifier` plus `identifierType`. |
| Lookup adapter | `server/voiceAgentService.ts:168-179` | Normalizes the supplied identifier again defensively, reads `server/database.json`, and returns `not_found` or `verification_required`. |
| Verification adapter | `server/voiceAgentService.ts:181-202` | Normalizes the identifier and date-of-birth factor, then returns `success`, `auth_failure`, or `not_found`. |
| Interaction logger | `server/voiceAgentService.ts:204-224` | Appends the post-call record to `server/call-log.json`. |

The Vapi request shape is accepted in both batch form (`message.toolCallList`) and direct form (`body.toolName`). The backend does not trust the model to provide canonical identifiers: the lookup and verification adapters normalize again before reading the database.

## 4. Observability path

Every dispatched tool call is persisted in `server/tool-call-log.json` by `appendToolTrace()` at `server/voiceAgentService.ts:83-106`. Sensitive identifier and verification values are redacted before persistence. Each event contains the call ID, tenant ID, tool name, safe arguments, result summary, duration, and UTC timestamp.

The browser receives tool messages through `extractVapiToolEvents()` in `client/src/lib/vapiSession.ts:128-146`. `Home.tsx` now forwards both `arguments` and `result` into the reducer. The compact **Tool activity** panel at `client/src/pages/Home.tsx:314` shows the invoked action and a safe human-readable result, for example:

```text
normalize_identifier    CUST-10042 → cust-10042
begin_tenant_lookup     cust-10042 · verification_required
verify_tenant_record    cust-10042 · success
```

## 5. Spaced customer-ID normalization

The recognizer output observed in the browser, `c u s t hyphen 1 0 0 4 2`, is handled by `normalizeSpokenCustomerId()` in `server/inputNormalization.ts:131-149`. It converts character-by-character `c u s t` speech and the word `hyphen` into a canonical prefix and digit stream, returning `cust-10042`. The same helper accepts `customer id c u s t - one zero zero four two` and matching remains case-insensitive.

The regression coverage is in `server/inputNormalization.test.ts:17-21`, and the full dispatcher path is exercised by `lookupRecord()` using the normalized customer ID and the stored verification factor.

## 6. Interview explanation

The practical design decision is to keep the **voice transport adapter** and the **workflow service** separate. Vapi handles browser audio, transcription, turn-taking, and function delivery. The tenant YAML describes the allowed tools. The provider-neutral dispatcher owns normalization, authorization, database access, result contracts, and audit traces. A future LangGraph or LangFlow layer can replace the orchestration decision logic without replacing the Vapi adapter or the tool implementations.
