import os
import json
import uvicorn
from hashlib import sha256
from pathlib import Path
from threading import Lock
from time import monotonic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Any, Optional

from app.config import settings, load_app_config
from app.repository import repo
from app.tools import execute_tool
from app.audit import audit_logger
from app.provider import validate_and_build_vapi_config
from app.streaming import event_generator
from app.runtime_policy import TOOL_LIMITS, assert_tool_allowed, resolve_tenant_id

app = FastAPI(title="Observe Insurance FastAPI LangGraph Voice Agent", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vapi may resend the same webhook after a transient network failure, and a model can
# occasionally issue the same function call twice before the first result is observed.
# Cache the response briefly by call/name/arguments so the caller receives a result for
# every toolCallId without re-running repository writes or duplicate lookups.
_tool_result_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_tool_result_cache_lock = Lock()
_tool_attempts: dict[tuple[str, str], int] = {}

class ToolCallRequest(BaseModel, extra="allow"):
    tenantId: Optional[str] = None
    toolName: Optional[str] = None
    arguments: Optional[dict[str, Any]] = None
    callId: Optional[str] = None
    message: Optional[dict[str, Any]] = None


def _parse_tool_arguments(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _extract_vapi_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    """Support Vapi's `toolCallList` and `toolWithToolCallList` webhook payloads."""
    raw_calls = message.get("toolCallList")
    if not isinstance(raw_calls, list):
        raw_with_tools = message.get("toolWithToolCallList")
        raw_calls = [item.get("toolCall") for item in raw_with_tools if isinstance(item, dict) and isinstance(item.get("toolCall"), dict)] if isinstance(raw_with_tools, list) else []

    parsed_calls: list[dict[str, Any]] = []
    for raw_call in raw_calls:
        if not isinstance(raw_call, dict):
            continue
        function = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else raw_call
        name = function.get("name") if isinstance(function, dict) else None
        if not isinstance(name, str) or not name:
            continue
        parsed_calls.append({
            "toolCallId": raw_call.get("id") or raw_call.get("toolCallId"),
            "name": name,
            "arguments": _parse_tool_arguments(function.get("arguments") if isinstance(function, dict) else None),
        })
    return parsed_calls


def _tool_cache_key(tenant_id: str, call_id: Optional[str], name: str, arguments: dict[str, Any]) -> str:
    canonical = json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str)
    return sha256(f"{tenant_id}|{call_id or 'no-call'}|{name}|{canonical}".encode("utf-8")).hexdigest()


def _purge_expired_tool_results(now: float) -> None:
    expired = [key for key, (expires_at, _) in _tool_result_cache.items() if expires_at <= now]
    for key in expired:
        del _tool_result_cache[key]


def _execute_vapi_tool(tenant_id: str, call_id: Optional[str], name: str, arguments: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Return a result and whether the request reused a short-lived response cache."""
    now = monotonic()
    assert_tool_allowed(name)
    cache_key = _tool_cache_key(tenant_id, call_id, name, arguments)
    with _tool_result_cache_lock:
        _purge_expired_tool_results(now)
        cached = _tool_result_cache.get(cache_key)
        if cached:
            return cached[1], True
        if call_id:
            attempt_key = (call_id, name)
            limit = TOOL_LIMITS.get(name)
            if limit is not None and _tool_attempts.get(attempt_key, 0) >= limit:
                return {"status": "tool_budget_exhausted", "authenticated": False, "message": "This operation has reached its attempt limit. Escalation or an alternate channel is required."}, False
            _tool_attempts[attempt_key] = _tool_attempts.get(attempt_key, 0) + 1

    result = execute_tool(tenant_id, name, arguments)
    with _tool_result_cache_lock:
        _tool_result_cache[cache_key] = (now + settings.server.vapi_tool_dedup_ttl_seconds, result)
    return result, False

@app.get("/api/health")
def health_check():
    cfg = load_app_config()
    return {
        "status": "healthy",
        "service": "fastapi-voice-agent",
        "tenantsLoaded": len(cfg.tenants),
        "defaultTenant": "observe-insurance",
    }

@app.get("/api/voice-agent/health")
def voice_agent_health():
    """Reachability probe for the public webhook URL.

    Lives under /api/voice-agent so it is covered by the same proxy rule Vapi's tool
    and event webhooks use: if this answers through the public URL, those will too.
    """
    return {"status": "healthy", "service": "fastapi-voice-agent"}


@app.get("/api/voice-agent/tenants")
def get_tenants():
    cfg = load_app_config()
    tenants_list = []
    for tid, t in cfg.tenants.items():
        tenants_list.append({
            "tenantId": tid,
            "organizationName": t.organization_name,
            "agentName": t.agent_name,
            "firstMessage": t.first_message,
            "systemPrompt": t.system_prompt,
            "faqs": [f.model_dump() for f in t.faqs],
            "tools": [tool.model_dump() for tool in t.tools],
        })
    return {"tenants": tenants_list}

@app.get("/api/voice-agent/config/{tenant_id}")
def get_tenant_vapi_config(tenant_id: str, origin: Optional[str] = "http://localhost:3000"):
    try:
        cfg = validate_and_build_vapi_config(tenant_id, origin)
        return {"tenantId": tenant_id, "vapiConfig": cfg}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/voice-agent/stream/{session_id}")
async def stream_events(session_id: str):
    init_evt = {"sessionId": session_id, "status": "connected", "message": "Graph event stream open"}
    return StreamingResponse(event_generator(session_id, init_evt), media_type="text/event-stream")

@app.post("/api/voice-agent/tools")
def dispatch_tools(req: ToolCallRequest):
    body = req.model_dump()
    message = body.get("message") or body
    tenant_id = resolve_tenant_id(body, message)
    call_id = body.get("callId") or message.get("call", {}).get("id")

    audit_logger.log_event("tool_dispatch_request", tenant_id, body, call_id)

    if message.get("type") == "tool-calls":
        results = []
        tool_calls = _extract_vapi_tool_calls(message)
        if not tool_calls:
            raise HTTPException(status_code=400, detail="Vapi tool-calls webhook did not contain a valid tool call")
        for tool_call in tool_calls:
            try:
                result, replayed = _execute_vapi_tool(tenant_id, call_id, tool_call["name"], tool_call["arguments"])
                results.append({
                    "toolCallId": tool_call["toolCallId"],
                    "name": tool_call["name"],
                    "result": json.dumps(result, separators=(",", ":")),
                })
                audit_logger.log_event("tool_dispatch_response", tenant_id, {
                    "toolName": tool_call["name"],
                    "result": result,
                    "replayed": replayed,
                }, call_id)
            except HTTPException as exc:
                results.append({
                    "toolCallId": tool_call["toolCallId"],
                    "name": tool_call["name"],
                    "error": str(exc.detail),
                })
        return {"results": results}

    tool_name = body.get("toolName") or message.get("toolName")
    arguments = body.get("arguments") or message.get("arguments") or {}
    arguments = _parse_tool_arguments(arguments)

    assert_tool_allowed(tool_name)
    result = execute_tool(tenant_id, tool_name, arguments)
    audit_logger.log_event("tool_dispatch_response", tenant_id, {"toolName": tool_name, "result": result}, call_id)
    return result

@app.post("/api/voice-agent/events")
def receive_event(req: dict):
    msg = req.get("message") or req
    tenant_id = resolve_tenant_id(req, msg)
    call_id = req.get("callId") or msg.get("call", {}).get("id")
    event_type = msg.get("type") or req.get("type") or "unknown"
    audit_logger.log_event(event_type, tenant_id, msg, call_id)

    # Vapi delivers end-of-call-report server-side even when the browser has died, so
    # this is the only place a completion record can be written reliably.
    if event_type == "end-of-call-report" and call_id:
        try:
            outcome = repo.record_call_outcome(tenant_id, call_id, msg)
            return {"received": True, "logged": True, "outcome": outcome["outcome"]}
        except Exception as exc:  # never fail the webhook back to Vapi
            print(f"[voice-agent] failed to record call outcome for {call_id}: {exc}")

    return {"received": True, "logged": True}


@app.get("/api/voice-agent/follow-ups")
def list_follow_ups(tenant_id: str, include_resolved: bool = False):
    """Work queue for the escalation team: calls that did not reach a clean finish."""
    records = repo.load_call_outcomes(tenant_id)
    if not include_resolved:
        records = [r for r in records if r.get("needsHumanFollowUp")]
    order = {"high": 0, "normal": 1, "none": 2}
    records.sort(key=lambda r: (order.get(r.get("priority"), 3), r.get("endedAt") or ""))
    return {
        "tenantId": tenant_id,
        "count": len(records),
        "highPriority": sum(1 for r in records if r.get("priority") == "high"),
        "followUps": records,
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
