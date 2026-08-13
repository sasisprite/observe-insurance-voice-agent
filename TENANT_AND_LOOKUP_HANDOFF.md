# Tenant Context and Claim-Lookup Handoff Note

**Prepared:** 13 August 2026  
**Scope:** Current local project handoff only. Development has been stopped. This note records verified code behavior, observed runtime evidence, and the reasons a successful live lookup was not conclusively demonstrated.

## Executive conclusion

The `begin_tenant_lookup` tool does **not** receive an explicit tenant identifier such as `Observe`, `Insurance`, or `observe-insurance` as one of its model-generated arguments. It receives only an `identifier`, for example `cust-10042` or `+1 (555) 234-5678`.

The active browser experience is currently **single-tenant by convention**, not by a robust runtime tenant-resolution contract. The React page fixes `tenantId` to `observe-insurance`; the FastAPI webhook attempts to obtain a tenant from a top-level request field or Vapi assistant metadata, but otherwise silently falls back to `observe-insurance`. The inline Vapi assistant configuration used by the page does not add that metadata. Therefore, the fixture is normally selected through a hard-coded/default route, rather than an explicit tenant field carried end-to-end with every Vapi tool call.

> The direct FastAPI tests prove that the repository can locate `CUST-10042` from `server/database.json` when it receives `tenant_id="observe-insurance"` and `identifier="cust-10042"`. They do **not** prove that the live Vapi model consumed that tool result and advanced the voice conversation to date-of-birth verification.

## Answer: how tenant identification currently works

| Runtime layer | Tenant behavior | Evidence | Assessment |
|---|---|---|---|
| Browser UI | `client/src/pages/Home.tsx` sets `const tenantId = "observe-insurance"`. This value is used for browser-side tenant content and post-call logging. | `Home.tsx:15`, `Home.tsx:110–113`, `Home.tsx:241–249` | **Hard-coded single tenant.** |
| Inline Vapi assistant | The browser builds the assistant configuration locally and sends Vapi custom tools to `/api/voice-agent/tools`. The tool schema contains only the lookup `identifier`; it does not include `tenantId` as a function parameter or assistant metadata. | `Home.tsx:21–35`, `Home.tsx:64–85`, `config.yaml:67–76` | **No explicit tenant propagation in the live inline assistant.** |
| FastAPI webhook | The dispatcher chooses a tenant in this order: top-level `tenantId`, `message.assistant.metadata.tenantId`, `message.assistant.server.metadata.tenantId`, then `"observe-insurance"`. | `backend/app/server.py:145–155` | **Default fallback is what selects the Observe fixture when metadata is absent.** |
| Repository | The repository accesses `db["tenants"][tenant_id]["customers"]`. | `backend/app/repository.py:57–60` | **A wrong or absent tenant key produces an empty customer list and `not_found`.** |

The `backend/app/provider.py` function can select a named tenant when called as `validate_and_build_vapi_config(tenant_id, origin)`, but the page does not use that returned configuration for the normal inline call. Instead, `Home.tsx` constructs an inline configuration using its own prompt, model, voice, and tools. This leaves two configuration paths in the codebase.

## What should happen on the example customer-ID call

The fixture database contains a tenant key `observe-insurance` and a customer record with `customerId: "CUST-10042"`, `phoneNumber: "+15552345678"`, and `verificationFactor: "1988-11-20"`. The status is deliberately protected until date-of-birth verification succeeds.

| Step | Expected input/output | Current implementation |
|---|---|---|
| 1. Vapi transcription and model reasoning | Caller says “C U S T minus one double zero four two.” The model should call `normalize_identifier`. | The tool description requests the canonical lower-case dashed value `cust-10042`. |
| 2. Normalization tool | `rawIdentifier` → `{ "normalizedIdentifier": "cust-10042" }`. | `backend/app/tools.py:58–61` accepts the raw identifier. |
| 3. Lookup tool | `identifier: "cust-10042"` → `verification_required`. | `backend/app/tools.py:63–65` calls `repo.lookup_customer(tenant_id, identifier)`. |
| 4. Repository match | Tenant `observe-insurance` is selected; customer IDs are compared case-insensitively in dashed and compact forms. | `backend/app/repository.py:46–55`, `57–89`. |
| 5. Vapi result return | The webhook must return a top-level `results` array containing the original `toolCallId`, tool `name`, and a stringified `result`. | `backend/app/server.py:159–183`; this matches Vapi’s documented tool-call result model.[1] |
| 6. Voice continuation | Sarah should receive `status: verification_required` and ask once for `1988-11-20` in natural spoken form. | This final Vapi consumption step was **not confirmed in a live microphone session**. |

The repository does not require a stored phone number to be formatted exactly as the spoken version. It strips non-digits and tries both ten-digit national and eleven-digit country-code candidates. Customer-ID comparison considers both `cust10042` and `cust-10042`. This behavior is implemented in `backend/app/repository.py:28–55` and `62–74`.

## Why the database lookup appeared to fail

The caller trace showed the important distinction: the UI displayed `cust-10042 · requested`, not `cust-10042 · verification_required`. That tells us the browser received tool activity for an invocation, but did not display a correlated success result. It is **not evidence by itself** that `database.json` could not match the record.

The direct API runner tested the active FastAPI service against the same fixture. It obtained `verification_required` for both `cust-10042` and the canonical phone number. That validates the **repository and fixture layer** under an explicit/default `observe-insurance` tenant. The direct runner cannot validate the complete provider path, because it bypasses live audio, Vapi’s tool-call delivery, and Vapi’s post-result model continuation.

The repeated live failures are best explained by a failure at, or after, the Vapi custom-tool handoff boundary rather than a simple `database.json` formatting mismatch. The observed repeated calls also show that the model or provider retried before it had observed a usable result. A cache/replay guard and Vapi batch-result envelope were subsequently added, but a live call could not confirm the repair because the provider ended the available browser session for voice-minute capacity before microphone speech was accepted.

## Verified findings versus unresolved findings

| Area | Status | Meaning |
|---|---|---|
| `database.json` path | Verified | `config.yaml` points to `server/database.json`; the repository loads that path relative to the project root. |
| Fixture record | Verified | `observe-insurance` contains `CUST-10042` / `+15552345678` / `1988-11-20`. |
| Identifier matching | Verified in direct API tests | Canonical and messy identifier inputs can resolve to the expected customer record in FastAPI. |
| Tenant routing | Partially verified, structurally weak | The active UI relies on the hard-coded/default tenant; it does not pass a durable tenant context in the inline Vapi config. |
| Vapi response envelope | Implemented and unit-tested | FastAPI returns `results[]` with `toolCallId`, `name`, and stringified `result` for Vapi tool-calls.[1] |
| Real provider tool-result consumption | **Not verified** | Voice-minute exhaustion prevented a fresh microphone call after the webhook repair. |
| Duplicate lookups | Observed in caller trace | A short replay guard prevents identical server execution, but no final live provider trace was captured to prove one visible Vapi turn end-to-end. |

## Main technical challenges and why multiple fixes did not close the issue

### 1. Two sources of runtime configuration

The project contains a YAML/FastAPI configuration path and a separate browser-built Vapi configuration path. `config.yaml` names ElevenLabs/Rachel and an OpenRouter model, whereas the browser inline configuration names a Groq model and Vapi/Hana voice. More importantly for lookup, the browser derives tenant content through an older tRPC query while FastAPI separately owns the YAML tenant registry. This architectural split means a change made to one path can fail to affect the live call that is actually running.

### 2. Tenant context is implicit rather than contractual

The database is tenant-scoped, but `begin_tenant_lookup` only accepts an identifier. The caller is effectively routed to Observe Insurance because both the page and FastAPI fallback use `observe-insurance`. That is enough for the present fixture, but it is not suitable for a configurable multi-tenant service. A missing metadata field does not fail closed; it silently becomes Observe Insurance.

### 3. The hard problem was tool-result consumption, not identifier comparison

The customer ID reached the expected canonical form in the reported trace. The problematic transition was from Vapi’s tool invocation to the model receiving and acting on the returned result. Vapi requires results to retain the originating `toolCallId`, the tool `name`, and string contents within a top-level `results` list.[1] Earlier result-shape and duplicate-delivery concerns were addressed, but they were not retested through a real audio turn because provider capacity blocked the session.

### 4. Automated tests did not exercise the provider boundary

Vitest, Pytest, and the direct FastAPI runner covered deterministic parsing, repository matching, and webhook payload construction. They did not create a real Vapi audio call with a valid provider quota and then assert that the model asked for date of birth after reading the result. Thus the test suite gave legitimate confidence in components, but not a complete integration proof.

## Recommended next debugging step when development resumes

Do not change the normalization rules or fixture records first. Start with a **single, instrumented live call** and capture the following correlation fields for one `begin_tenant_lookup` invocation:

| Capture point | Required fields |
|---|---|
| Browser/Vapi outbound tool call | Vapi `call.id`, `toolCallId`, tool name, raw argument string, page tenant ID |
| HTTP request arriving at `/api/voice-agent/tools` | Full message `type`, `toolCallList` or `toolWithToolCallList`, resolved tenant ID, origin/header information |
| FastAPI response | HTTP status, exact `{ results: [...] }` body, matching `toolCallId`, stringified result |
| Next Vapi client event | `tool-calls-result` payload and the next assistant transcript |

The required target behavior is: exactly one `begin_tenant_lookup` call for `cust-10042`, an HTTP `200` response with `status: verification_required`, followed by Sarah asking for the date of birth once. If FastAPI returns that result but Vapi does not emit a corresponding `tool-calls-result` or assistant turn, the remaining defect is provider/server-URL configuration, public reachability, or the Vapi session configuration—not `database.json` lookup logic.

For a production multi-tenant architecture, the tenant ID should be resolved at session start by the hosting application, placed into immutable assistant/server metadata, validated against the YAML registry in FastAPI, and required by every repository operation. The server should reject an unknown or missing tenant rather than silently defaulting to Observe Insurance.

## Relevant project files

| File | Purpose |
|---|---|
| `config.yaml` | Tenant registry, fixture paths, prompt, tool contracts, and provider settings. |
| `server/database.json` | Local test fixture; not a production database. |
| `client/src/pages/Home.tsx` | Active browser Vapi session configuration, hard-coded tenant selection, and tool server URL. |
| `backend/app/server.py` | FastAPI Vapi webhook, tenant fallback, batch tool dispatch, and result envelope. |
| `backend/app/tools.py` | `normalize_identifier`, `begin_tenant_lookup`, verification, and logging dispatch. |
| `backend/app/repository.py` | Tenant-scoped `database.json` loading and multi-candidate matching. |
| `backend/app/provider.py` | Unused-by-default tenant-specific Vapi configuration builder; illustrates the parallel configuration path. |
| `LIVE_STRESS_TEST_NOTES.md` | Evidence log of direct API results and the provider voice-minute blocker. |

## References

[1]: https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/ServerMessageResponseToolCalls.ts "Vapi ServerMessageResponseToolCalls type"

