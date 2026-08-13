# Observe Insurance AI Voice Agent: End-to-End Architecture & Validation Walkthrough

This document provides a complete technical walkthrough of the voice support agent built for Observe Insurance. It covers the system architecture, normalization pipeline, multi-candidate fallback matching, tool definitions, error handling, and validation protocols designed for technical interviews.

---

## 1. System Architecture & Overview

The agent is implemented as a domain-neutral, highly configurable voice service with a tenant profile for **Observe Insurance** ("Sarah"). 

```
┌─────────────────────────┐       Vapi Web SDK      ┌─────────────────────────┐
│  React 19 Landing Page  │ ◄──────────────────────►│  Browser Audio Stream   │
└───────────┬─────────────┘                         └───────────┬─────────────┘
            │                                                   │
            │ tRPC / REST Dispatch                              │ Vapi / Deepgram STT
            ▼                                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      Express / tRPC Backend Service                        │
│  ┌─────────────────────────┐   ┌──────────────────────────────────────┐   │
│  │    config.yaml Loader   │   │  Multi-Candidate Fallback Matcher    │   │
│  └─────────────────────────┘   └──────────────────────────────────────┘   │
│  ┌─────────────────────────>   ┌──────────────────────────────────────┐   │
│  │   Semantic Transcript   │   │     Tool-Call Audit Log Service      │   │
│  └─────────────────────────┘   └──────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions
1. **Centralized YAML Configuration (`config.yaml`):** All models, timeouts, prompt instructions, FAQs, and tool contracts are externalized so that tenants can be reconfigured or swapped without touching core source code.
2. **Provider-Neutral Dispatcher (`server/voiceAgentService.ts`):** Tool calls received from the voice provider are validated against tenant onboarding permissions and dispatched through a robust server-side service layer.
3. **Multi-Candidate Fallback Matching:** Voice transcription introduces natural variations (such as country codes, parentheses, hyphens, and spelling). Instead of strict one-to-one string equality, the backend generates robust candidate sets for both phone numbers and account IDs.

---

## 2. Normalization & Multi-Candidate Fallback Matching

Voice inputs are processed through two distinct layers to eliminate lookup failures:

### A. Spoken Identifier Normalization (`server/inputNormalization.ts`)
* **Spoken Customer IDs:** Recognizer output like `"c u s t hyphen 1 0 0 4 2"` or `"customer id cust-10042"` is mapped to the canonical lowercase dashed form `cust-10042`.
* **Spoken Phone Numbers:** Phrases such as `"plus one, triple five, two three four, five six seven eight"` expand repeated digits and format into standard US representations (`+1 (555) 234-5678`).

### B. Multi-Candidate Fallback Engine
When `begin_tenant_lookup` or `verify_tenant_record` executes, `buildIdentifierCandidates` creates comparison sets:
* **Phone Variants:** Strips all non-digits, evaluates 11-digit country-code (`15552345678`), 10-digit national (`5552345678`), and formatted (`+1 (555) 234-5678`) variants against database records.
* **Customer ID Variants:** Compares case-insensitively in both dashed (`cust-10042`) and compact (`cust10042`) forms.

---

## 3. Tool Definitions & Code Path

Tools are declared in `config.yaml` and exposed to the LLM/voice session. Each invocation follows an auditable codepath:

| Tool Name | Purpose | Key Inputs | Result / Action |
| :--- | :--- | :--- | :--- |
| `normalize_identifier` | Canonicalizes spoken phone or account ID | `rawIdentifier` (string) | Returns `{ status: "normalized", normalizedIdentifier, identifierType }` |
| `begin_tenant_lookup` | Locates customer record (Step 1) | `identifier` (string) | Returns `verification_required` or `not_found` |
| `verify_tenant_record` | Authenticates date of birth (Step 2) | `identifier`, `verificationFactor` | Returns `success` (with safe customer record) or `auth_failure` |
| `log_interaction` | Records post-call audit summary | `callerName`, `callSummary`, `sentiment`, `escalated` | Appends record to `server/call-log.json` |

### Code Path Execution Flow
1. **Client Audio Capture:** `client/src/pages/Home.tsx` and `client/src/lib/vapiSession.ts` manage the Vapi Web SDK session.
2. **Transcript Grouping:** Incoming speech fragments are intelligently merged into sentence-level rows while respecting paragraph pauses.
3. **Tool Interception:** When Vapi triggers a tool call, the request hits `/api/trpc/voiceAgent` or backend tool endpoints, invoking `dispatchToolCall`.
4. **Audit Logging:** Every tool call, sanitized arguments, duration, and matching strategy is persisted to `server/tool-call-log.json` and rendered live in the UI tool-activity panel.

---

## 4. End-to-End Validation Checklist

To validate the agent successfully, use the following test cases:

| Scenario | Input / Spoken Phrase | Expected Behavior |
| :--- | :--- | :--- |
| **Happy Path (Customer ID)** | `"CUST-10042"` or `"c u s t hyphen 1 0 0 4 2"` | Normalized to `cust-10042`. Returns `verification_required`. Providing `"November 20, 1988"` successfully authenticates and retrieves Eleanor Vance's claim status under review. |
| **Happy Path (Phone Number)** | `"+1 (555) 234-5678"` or `"plus one triple five two three four five six seven eight"` | Formatted and matched via candidate fallbacks. Returns `verification_required`. |
| **Authentication Failure** | Correct identifier + `"January 1, 1970"` | Returns `auth_failure` without leaking record data. |
| **Customer Not Found** | `"CUST-99999"` or `"+1 (555) 000-0000"` | Returns `not_found` gracefully. |
| **FAQ Support** | `"What are your office hours?"` | Sarah answers concisely from `config.yaml` faqs. |
| **Human Escalation** | `"I want to speak with a representative"` | Sarah acknowledges and invokes escalation/logging. |

---

## 5. Verification Status & Test Suite

* **Unit Tests:** 45 Vitest tests covering configuration loading, normalization, candidate generation, Vapi session state, and service dispatch pass successfully (`pnpm test`).
* **Build Integrity:** Production bundle compiles cleanly (`pnpm build`).
* **Desktop Synchronization:** All source files, configurations, and walkthrough documents are mirrored in `/Users/apple/Documents/Observe.ai`.
