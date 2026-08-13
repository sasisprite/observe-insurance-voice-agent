import pytest
from fastapi.testclient import TestClient
from app.server import app
from app.repository import DatabaseRepository
from app.tools import normalize_identifier_logic
from app.graph import build_voice_agent_graph

client = TestClient(app)

def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["tenantsLoaded"] > 0

def test_tenants_endpoint():
    resp = client.get("/api/voice-agent/tenants")
    assert resp.status_code == 200
    data = resp.json()
    assert "tenants" in data
    assert len(data["tenants"]) > 0

def test_normalize_identifier():
    res1 = normalize_identifier_logic("+1 (555) 234-5678")
    assert res1["normalizedIdentifier"] == "+1 (555) 234-5678"

    res_cust = normalize_identifier_logic("cust-10042")
    assert res_cust["normalizedIdentifier"] == "cust-10042"

def test_repo_lookup_and_verify():
    repo = DatabaseRepository()
    lookup = repo.lookup_customer("observe-insurance", "+15552345678")
    assert lookup["status"] == "verification_required"
    assert lookup["customerId"] == "CUST-10042"

    lookup_cust = repo.lookup_customer("observe-insurance", "cust-10042")
    assert lookup_cust["status"] == "verification_required"
    assert lookup_cust["customerId"] == "CUST-10042"

    verify = repo.verify_record("observe-insurance", "CUST-10042", "1988-11-20")
    assert verify["authenticated"] == True
    assert len(verify["claims"]) > 0

def test_langgraph_workflow():
    graph = build_voice_agent_graph()
    initial_state = {
        "session_id": "test-session-1",
        "tenant_id": "observe-insurance",
        "call_id": "call-123",
        "status": "pending",
        "intent": "claim_status",
        "transcript": [],
        "pending_partial_transcript": "",
        "identifier_raw": "+15552345678",
        "identifier_normalized": "+1 (555) 234-5678",
        "matched_customer_ref": None,
        "verification_attempts": 0,
        "authenticated": False,
        "claim_context": None,
        "escalated": False,
        "sentiment": "neutral",
        "last_error": None,
        "tool_trace": [],
        "completion_reason": None,
    }
    res = graph.invoke(initial_state)
    assert res["status"] in ["verification_required", "authenticated", "completed", "escalated", "not_found"]

def test_workflow_does_not_use_default_verification_value():
    graph = build_voice_agent_graph()
    state = {
        "session_id": "safety-test",
        "tenant_id": "observe-insurance",
        "call_id": "call-safety-test",
        "status": "pending",
        "identifier_raw": "+15552345678",
        "identifier_normalized": None,
        "matched_customer_ref": None,
        "verification_attempts": 0,
        "authenticated": False,
        "escalated": False,
        "tool_trace": [],
    }
    result = graph.invoke(state)
    assert result["authenticated"] is False
    assert "default authentication value" in result["last_error"]

def test_invalid_tenant_context_is_rejected():
    response = client.post("/api/voice-agent/tools", json={
        "tenantId": "does-not-exist",
        "toolName": "normalize_identifier",
        "arguments": {"rawIdentifier": "+1 555 234 5678"},
    })
    assert response.status_code == 400


def test_backend_owned_interaction_logging_is_not_a_live_tool():
    response = client.post("/api/voice-agent/tools", json={
        "tenantId": "observe-insurance",
        "toolName": "log_interaction",
        "arguments": {"callSummary": "should be rejected"},
    })
    assert response.status_code == 400

def test_production_requires_deployment_identity(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    response = client.post("/api/voice-agent/tools", json={
        "tenantId": "observe-insurance",
        "toolName": "normalize_identifier",
        "arguments": {"rawIdentifier": "+1 555 234 5678"},
    })
    assert response.status_code == 403


def test_deployment_identity_resolves_tenant(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    response = client.post("/api/voice-agent/tools", json={
        "deploymentKey": "observe-insurance-dev",
        "toolName": "normalize_identifier",
        "arguments": {"rawIdentifier": "+1 555 234 5678"},
    })
    assert response.status_code == 200
    assert response.json()["normalizedIdentifier"]


def test_metrics_endpoint_exposes_runtime_snapshot():
    response = client.get("/api/metrics")
    assert response.status_code == 200
    assert "counters" in response.json()
    assert "timings" in response.json()


def test_circuit_breaker_opens_after_bounded_failures():
    from app.resilience import CircuitBreaker
    breaker = CircuitBreaker(failure_threshold=2, recovery_seconds=60)
    assert breaker.allow() is True
    breaker.failure()
    assert breaker.allow() is True
    breaker.failure()
    assert breaker.allow() is False


def test_vapi_adapter_normalizes_tool_calls_and_events():
    from providers import VapiAdapter
    adapter = VapiAdapter()
    calls = adapter.parse_tool_calls({"message": {"toolCallList": [{"id": "tc-1", "function": {"name": "normalize_identifier", "arguments": {"rawIdentifier": "123"}}}]}})
    assert calls[0]["toolCallId"] == "tc-1"
    assert calls[0]["name"] == "normalize_identifier"
    event = adapter.parse_event({"message": {"type": "end-of-call-report", "call": {"id": "call-1"}, "assistant": {"metadata": {"tenantId": "observe-insurance", "deploymentKey": "observe-insurance-dev"}}}})
    assert event["eventType"] == "end-of-call-report"
    assert event["callId"] == "call-1"
    assert event["deploymentKey"] == "observe-insurance-dev"
