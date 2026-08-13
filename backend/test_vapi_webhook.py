import json

from fastapi.testclient import TestClient

import app.server as server_module


client = TestClient(server_module.app)


def vapi_batch(call_id: str, tool_call_id: str, tool_name: str, arguments: dict) -> dict:
    return {
        "message": {
            "type": "tool-calls",
            "call": {"id": call_id},
            "assistant": {"metadata": {"tenantId": "observe-insurance"}},
            "toolCallList": [{
                "id": tool_call_id,
                "type": "function",
                "function": {"name": tool_name, "arguments": json.dumps(arguments)},
            }],
        }
    }


def test_vapi_batch_lookup_returns_the_required_tool_call_result_envelope():
    response = client.post(
        "/api/voice-agent/tools",
        json=vapi_batch("call-cust-10042", "tool-lookup-1", "begin_tenant_lookup", {"identifier": "cust-10042"}),
    )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["toolCallId"] == "tool-lookup-1"
    assert result["name"] == "begin_tenant_lookup"
    payload = json.loads(result["result"])
    assert payload["status"] == "verification_required"
    assert payload["customerId"] == "CUST-10042"
    assert payload["authenticated"] is False
    assert "date of birth" in payload["prompt"].lower()


def test_vapi_tool_with_tool_call_payload_is_also_supported():
    payload = vapi_batch("call-tool-with", "tool-normalize-1", "normalize_identifier", {"rawIdentifier": "cust-10042"})
    tool_call = payload["message"].pop("toolCallList")[0]
    payload["message"]["toolWithToolCallList"] = [{"type": "function", "toolCall": tool_call}]

    response = client.post("/api/voice-agent/tools", json=payload)

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["toolCallId"] == "tool-normalize-1"
    assert json.loads(result["result"])["normalizedIdentifier"] == "cust-10042"


def test_duplicate_vapi_replay_returns_the_cached_result_without_reexecuting(monkeypatch):
    invocation_count = 0

    def fake_execute_tool(tenant_id, tool_name, arguments):
        nonlocal invocation_count
        invocation_count += 1
        return {"status": "verification_required", "customerId": "CUST-10042"}

    monkeypatch.setattr(server_module, "execute_tool", fake_execute_tool)
    first = client.post(
        "/api/voice-agent/tools",
        json=vapi_batch("call-replay", "tool-replay-1", "begin_tenant_lookup", {"identifier": "cust-10042"}),
    )
    second = client.post(
        "/api/voice-agent/tools",
        json=vapi_batch("call-replay", "tool-replay-2", "begin_tenant_lookup", {"identifier": "cust-10042"}),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert invocation_count == 1
    assert first.json()["results"][0]["result"] == second.json()["results"][0]["result"]
