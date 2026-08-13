# Voice Agent Tool Contract, Transformation vs. Validation, and Architecture Guide

## 1. The Architectural Principle: Transformation vs. Validation

In voice-AI agents, speech transcription is inherently noisy. A caller saying "+1 555 234 5678" or spelling "C-U-S-T dash 1-0-0-4-2" produces conversational text with spaces, punctuation variations, or spelled-out words. 

Our architecture enforces a strict separation of concerns between the **LLM transformation boundary** and the **backend validation boundary**:

1. **LLM Transformation Layer (`normalize_identifier`)**:
   - The LLM and its tool definitions act as the canonicalization bridge.
   - The tool description explicitly instructs the model to translate raw speech (e.g., `plus one, triple five...` or `c u s t hyphen one zero zero four two`) into strict canonical string formats before downstream calls:
     - **Phone Numbers**: Canonical formatted US wire format: `+1 (555) 234-5678`.
     - **Customer IDs**: Canonical lowercase dashed format: `cust-10042` (case-insensitive matching).
     - **Dates of Birth**: ISO standard format: `YYYY-MM-DD`.

2. **Backend Validation and Multi-Candidate Matching Layer (`begin_tenant_lookup` / `verify_tenant_record`)**:
   - Backend APIs (implemented in Express/tRPC and equivalent to a FastAPI/Python service) **do not trust raw transcript text blindly**.
   - Instead of strict one-to-one string equality, the backend implements **multi-candidate candidate generation**:
     - Strips all non-digit characters to evaluate both 11-digit (`+1`) and 10-digit national telephone forms.
     - Compares customer IDs case-insensitively in both dashed (`cust-10042`) and compact (`cust10042`) forms.
     - Generates multiple comparison candidates so minor transcription discrepancies never cause false support failures.

---

## 2. End-to-End Codepath and Method Trace

| Step | Component | Method / File | Description |
|---|---|---|---|
| **1. Client Initialization** | React UI | `client/src/pages/Home.tsx` (`startCall`) | Configures Vapi session using tenant configuration loaded from backend tRPC router. |
| **2. Spoken Turn** | Vapi Web SDK | `client/src/lib/vapiSession.ts` | Captures speech turns, groups semantic sentences, and forwards tool calls to the backend bridge. |
| **3. Tool Dispatch** | Express Bridge | `server/_core/index.ts` (`POST /api/voice-agent/tools`) | Receives Vapi tool execution requests and routes them to `dispatchToolCall`. |
| **4. Normalization** | Service Layer | `server/voiceAgentService.ts` & `server/inputNormalization.ts` | Converts raw spoken identifiers into canonical `+1 (555) 234-5678` or `cust-10042` wire formats. |
| **5. Database Lookup** | Service Layer | `server/voiceAgentService.ts` (`begin_tenant_lookup`) | Generates multi-candidate comparison lists and searches `server/database.json`. |
| **6. Audit Logging** | Service Layer | `server/voiceAgentService.ts` (`appendToolTrace`) | Persists tool inputs, normalized identifiers, matching strategy, and outcomes to `server/tool-call-log.json`. |
| **7. Live UI Trace** | React UI | `client/src/pages/Home.tsx` | Renders live tool activity and status pills for the caller and auditor. |

---

## 3. Interview Walkthrough Summary

When presenting this architecture in an interview, emphasize:
- **Resilience over Fragility**: Handling voice transcription noise requires robust normalizers plus multi-candidate backend matching.
- **Configurability**: Zero hardcoding; all prompts, tool schemas, and tenant metadata are loaded from `config.yaml`.
- **Auditability**: Every tool execution is traced with safe argument redaction and matching strategies.
- **Path to Visual Orchestration**: The service layer is structured to be easily wrapped by LangGraph or LangFlow nodes for visual enterprise editing.
