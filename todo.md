# Project TODO: Architecture Evolution & LangGraph Migration Guide

- [x] Outline the limitations of a rigid TypeScript/Vapi service layer
- [x] Design the LangGraph state schema, node transitions, and tool registry contract
- [x] Define visual configurability boundaries for non-technical users via LangFlow
- [x] Prepare a comprehensive interview walkthrough document and export it as an attachment
- [x] Synchronize the stable project source into the attached desktop folder without copying secrets or generated build artifacts
- [x] Verify the synchronized desktop file tree and report the local path
- [x] Fix Vapi transcriber endpointing to remain at or below the provider maximum of 500 ms
- [x] Add configuration validation and regression coverage for the Vapi endpointing limit
- [x] Verify browser session startup, full tests, and production build after the fix
- [x] Add deterministic, provider-neutral identifier normalization before customer lookup for phone numbers and customer IDs
- [x] Source Vapi tool schemas from centralized tenant configuration and make normalization requirements explicit
- [x] Persist and surface tool-call inputs, normalized identifiers, results, and lookup failures for debugging
- [x] Correct client session state so not-found and authentication-failure tool results are not treated as successful matches
- [x] Document the incremental LangGraph/LangFlow migration boundary and admin-configurable connector model
- [x] Verify the live browser preview end-to-end with spoken CUST-10042, confirming visible tool activity, normalization to cust-10042, and expected lookup/verification states
- [x] Verify the live browser preview end-to-end with spoken +15552345678, confirming visible tool activity, normalization to +1 (555) 234-5678, and expected lookup/verification states
- [x] Collapse spaced spoken characters like 'c u s t hyphen 1 0 0 4 2' into canonical customer IDs
- [x] Group live transcript turns into meaningful multi-word sentences and paragraphs rather than fragmented single-word line breaks
- [x] Surface exact code paths, registered tool definitions, and invoked action traces for interview walkthrough
- [x] Update customer-ID normalization to return canonical dash-separated cust-10042 format case-insensitively
- [x] Update database lookup and verification helpers to match customer IDs case-insensitively with or without hyphens
- [x] Update regression test suites and documentation for dashed customer-ID canonicalization
- [x] Implement multi-candidate fallback matching for phone numbers and customer IDs
- [x] Update centralized tool descriptions in config.yaml for voice transcription resilience
- [x] Provide an interview walkthrough document detailing code paths and end-to-end validation
- [x] Collect and analyze server logs, network requests, session replay, and tool call audit logs for phone number dictation issues
- [x] Trace confirmed the captured failure occurred before speech parsing; added provider-minute-limit diagnostics and redacted provider-event persistence instead of changing the parser
- [x] Define explicit canonical wire formats in config.yaml tool schemas and prompt instructions
- [x] Debug and resolve lookup failure for phone and customer ID inputs
- [x] Improve transcript streaming to render interim speech immediately without waiting for turn completion
- [x] Implement two-hour callback message and automatic session completion on representative escalation
- [x] Persist full transaction timelines and surface them in tool activity and audit logs
- [x] Build FastAPI backend application (`server.py`) with FastAPI, Pydantic, and Uvicorn
- [x] Implement YAML-driven configuration loader and tenant manager in Python (`config_loader.py`)
- [x] Implement database lookup, verification, and persistent audit logging in Python (`db_adapter.py`)
- [x] Implement Vapi tool dispatch and event webhook endpoints (`/api/voice-agent/tools` and `/api/voice-agent/events`)
- [x] Add explicit tool descriptions and parameter contracts in `config.yaml` for LLM reasoning
- [x] Integrate React frontend with FastAPI endpoints and verify full browser voice support
- [x] Write Python pytest suite and verify build integration
- [x] Trace exact tool response serialization and handler mapping between Vapi and backend
- [x] Reproduce normalize_identifier and begin_tenant_lookup with live utterances
- [x] Expose exact file paths and request-response payloads in tool activity UI
- [x] Fix Vapi clientMessages event names to use provider-accepted values (tool-calls, tool-calls-result) instead of invalid clientMessages values

# Fresh FastAPI/LangGraph Backend Redesign

- [x] Create the canonical Python backend package with typed configuration, API schemas, graph state, graph builder, tool registry, repositories, provider adapters, streaming, and audit modules
- [x] Make validated config.yaml the single source of truth for tenant prompts, tools, graph flow, Vapi events, voice settings, timeouts, retries, and escalation policy
- [x] Implement the generic LangGraph orchestration state and explicit claims-support nodes with resumable session boundaries
- [x] Implement typed FastAPI tool contracts for normalization, lookup, verification, claim status, FAQ, escalation, and interaction logging
- [x] Implement provider-independent identifier/date normalization validation with multi-candidate repository matching and redacted traces
- [x] Implement idempotent append-only transaction logging for tool calls, graph transitions, escalation, and post-call interaction records
- [x] Implement Vapi provider adapter and validate only provider-supported client event subscriptions before session startup
- [x] Implement FastAPI SSE/WebSocket graph and tool event streaming with immediate partial-event delivery to the frontend
- [x] Implement configurable flow registry and read-only flow/nodes/edges/tools/config validation endpoints with LangFlow-compatible export
- [ ] Refactor React business calls to use FastAPI as the exclusive agent backend while retaining the existing UI layer
- [x] Improve Sarah prompt, voice behavior, proactive short turns, escalation wording, interruption handling, and streaming transcript rendering
- [x] Add Python graph/API/repository/provider/redaction/idempotency tests and frontend streaming/session regression tests
- [ ] Verify happy path, authentication failure, customer not found, representative escalation, FAQ, unsupported, emergency, refresh, and provider-failure flows via live browser interaction (partially blocked by provider voice-minute capacity)
- [ ] Remove TypeScript claims domain logic from the runtime path after FastAPI contract and browser validation pass
- [x] Synchronize the completed implementation to the attached desktop folder without secrets or generated build artifacts
- [x] Update architecture and interview walkthrough documentation for the fresh FastAPI/LangGraph implementation
- [ ] Verify the live browser preview end-to-end with the new FastAPI backend and streaming behavior (blocked by provider voice-minute limit)
- [x] Verify the final project test suite, type checks, production build, endpoint smoke tests, and checkpoint state
- [x] Complete legacy TODO items for live browser scenarios and exact tool payload/path documentation after the new backend is active
- [x] Complete the approved plan definition-of-done and report remaining provider limitations separately from frontend buffering

## Definition of done

- [ ] React uses FastAPI endpoints exclusively for agent behavior (TypeScript tRPC bridge still handles getTenants, getRuntimeConfig, logCall)
- [x] LangGraph flow is inspectable and changeable through validated configuration and export
- [x] Required demo paths and safety fallbacks pass automated tests
- [x] Partial transcript text appears before turn completion when provider partial events are available
- [x] Tool and post-call events are traceable, redacted, and idempotent
- [x] The implementation is explainable as separate transport, orchestration, tools, repositories, configuration, and presentation layers
- [x] Final checkpoint is saved after todo.md review shows all new work complete

# Identifier Lookup Tracing & CUST/Phone Normalization Fixes

- [x] Add rigorous test suite in pytest covering diverse spoken inputs for phone numbers (+1 555..., triple five..., 555-...) and customer IDs (CUST-10042, cust 10042, 10042)
- [x] Update config.yaml tool descriptions and argument schemas to mandate strict canonical wire formats for LLM argument generation
- [x] Update backend repository multi-candidate matching to accept all phone formats and CUST prefixes case-insensitively without relying on strict formatting in lookup calls
- [x] Verify frontend tool activity trace successfully processes normalization and lookup results without dropping authentication state

# Model-Owned Normalization & Pure Backend Validation

- [x] Remove programmatic Python string manipulation for identifier normalization and delegate argument formatting entirely to LLM thinking via strict tool descriptions in config.yaml
- [x] Update backend tool validation in backend/app/tools.py to receive pre-normalized wire formats (`+1 (XXX) XXX-XXXX` or `cust-XXXXX`) from the model, validating structure rather than transforming raw speech
- [x] Update pytest suites to test strict wire-format validation and repository matching against model-supplied arguments
- [x] Verify that no custom transformation code remains in tool handlers

# Vapi Normalization-to-Lookup Handoff Fixes

- [x] Inspect client/src/lib/vapiSession.ts to ensure normalize_identifier response is correctly parsed and sets active identifier state
- [x] Ensure begin_tenant_lookup consumes the normalized identifier correctly without requiring a secondary normalization round
- [x] Add unit test in client/src/lib/vapiSession.test.ts for tool call progression and state advancement

# Identifier Lookup Troubleshooting & Fixes

- [x] Write a dedicated integration test simulating the exact multi-turn failure trace reported by the user (phone number dictation -> normalize_identifier -> begin_tenant_lookup)
- [x] Inspect backend tool execution handlers for normalize_identifier and begin_tenant_lookup to check parameter name mismatches (e.g. identifier vs phone vs rawIdentifier)
- [x] Fix any argument extraction mismatch between FastAPI tool dispatch and Vapi payload structure

# Warm Healthcare Voice & Low-Latency Streaming Improvements

- [x] Inspect config.yaml and client/src/pages/Home.tsx for voice provider parameters (ElevenLabs/Cartesia settings) and interim transcript event handlers
- [x] Update config.yaml to configure a warm, empathetic voice model suitable for healthcare/insurance claims support (e.g. ElevenLabs Rachel/Matilda or Cartesia voice profile) with expressive pitch and stable pacing
- [x] Refactor client/src/lib/vapiSession.ts and TranscriptPanel.tsx to support real-time interim speech updates, replace duplicate incremental transcript lines, and commit final turns on pause or sentence completion
- [x] Add regression tests for low-latency interim transcript deduplication and turn finalization
- [x] Verify the updated voice configuration and streaming transcript flow in the preview environment

# Adversarial UI and Messy-Input Stress Test

- [x] Stress-test the live UI with happy-path, messy phone, messy customer ID, pause/correction, authentication failure, customer-not-found, escalation, unsupported-question, FAQ, and emergency scenarios
- [x] Correlate live browser/Vapi startup failures with provider capacity, browser console, network, FastAPI, and audit logs
- [x] Add regression tests for every reproducible stress-test failure and verify the complete adversarial matrix
- [x] Document readiness blockers and final adversarial test results
- [x] Reconcile the active FastAPI verification fixture contract with the successful CUST-10042 test path
- [x] Make unknown-tool and tool-dispatch error responses consistent for direct and Vapi batch requests
- [x] Ensure the live UI's post-call logging and runtime configuration do not depend on the legacy TypeScript claims service

# Canonical Lookup Result Handoff Repair

- [x] Reproduce the exact Vapi batch tool-call payload for duplicated `normalize_identifier` and `begin_tenant_lookup` activity
- [x] Fix the FastAPI/Vapi tool-result response contract so Sarah receives `verification_required` exactly once
- [x] Prevent duplicate browser tool-activity entries and duplicate server invocations for the same Vapi tool-call ID
- [ ] Add regression tests using the reported `cust-10042` Vapi payload and verify live browser lookup once provider minutes are available
- [ ] Verify one live Vapi browser session after the webhook repair, confirming Sarah advances to date-of-birth verification exactly once
- [ ] Capture one end-to-end browser/network trace showing a single lookup invocation and a consumed Vapi tool-result event

# Development Stop and Local Handoff

- [x] Synchronize the complete current project to the attached local Observe.ai folder without secrets or generated artifacts
- [x] Verify the local copy contains the latest checkpointed source files and documentation
- [x] Stop the active development and FastAPI processes after synchronization
