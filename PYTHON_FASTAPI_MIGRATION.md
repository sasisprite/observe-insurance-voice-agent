# Python & FastAPI Voice-Agent Migration Architecture

This document outlines the architecture, rationale, and implementation details for migrating the Observe Insurance voice-agent backend from TypeScript/Express to **Python & FastAPI**, fulfilling the user's requirement for robust LLM-driven reasoning, explicit tool argument schemas, and clean separation of concerns between natural language transcription and backend database validation.

---

## 1. Architectural Rationale

In high-throughput conversational voice agents, strict type contracts and LLM reasoning are essential. The migrated FastAPI architecture establishes:
1. **LLM Reasoning & Normalization:** Raw speech transcription (which often includes spaced characters, punctuation variants, or colloquial phrasing) is interpreted by the LLM reasoning layer using explicit parameter descriptions in `config.yaml`.
2. **FastAPI Tool Contracts:** Pydantic models define strict validation boundaries for each tool (`normalize_identifier`, `begin_tenant_lookup`, `verify_tenant_record`, `log_interaction`).
3. **Multi-Candidate Matching:** The Python database adapter (`db_adapter.py`) normalizes candidate identifiers across country codes, parentheses, hyphens, and case insensitivity, ensuring high recall despite transcription noise.

---

## 2. Core Components

```
python/
  ├── server.py         # FastAPI application with Vapi webhook & tool endpoints
  ├── config_loader.py  # YAML configuration parser
  ├── db_adapter.py     # JSON database adapter with multi-candidate phone & customer ID matching
  └── test_server.py    # Pytest test suite validating all tool dispatch paths
```

### Endpoints
- `GET /api/voice-agent/tenants` — Returns active tenant configurations.
- `POST /api/voice-agent/tools` — Dispatches Vapi tool calls and single-tool requests to FastAPI handlers.
- `POST /api/voice-agent/events` — Ingests Vapi lifecycle and telemetry events.

---

## 3. Verification & Testing

All FastAPI tool endpoints have been verified using `pytest`:
- **Phone Lookup:** Successfully resolves `+15552345678` to `CUST-10042` with `verification_required`.
- **Customer ID Lookup:** Successfully resolves `CUST-10042` to `verification_required`.
- **Verification:** Successfully authenticates against stored Date of Birth (`November 20, 1988`).
- **Interaction Logging:** Persists post-call interaction audits.
