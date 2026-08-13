"""Deterministic workflow contract; persistence is owned by backend finalization."""
from typing import Any, Dict, List, Optional, TypedDict
from langgraph.graph import END, StateGraph
from app.tools import execute_tool

class AgentState(TypedDict, total=False):
    session_id: str
    tenant_id: str
    call_id: str
    status: str
    identifier_raw: Optional[str]
    identifier_normalized: Optional[str]
    matched_customer_ref: Optional[Dict[str, Any]]
    verification_value: Optional[str]
    verification_attempts: int
    authenticated: bool
    claim_context: Optional[Dict[str, Any]]
    escalated: bool
    handoff_requested: bool
    last_error: Optional[str]
    tool_trace: List[Dict[str, Any]]
    completion_reason: Optional[str]

def init_node(state: AgentState) -> AgentState:
    state["status"] = "initialized"
    state.setdefault("verification_attempts", 0)
    state.setdefault("tool_trace", [])
    state.setdefault("handoff_requested", False)
    return state

def normalize_node(state: AgentState) -> AgentState:
    raw = state.get("identifier_raw") or ""
    result = execute_tool(state["tenant_id"], "normalize_identifier", {"rawIdentifier": raw})
    state["tool_trace"].append({"tool": "normalize_identifier", "output": result})
    state["status"] = "normalized" if result.get("normalizedIdentifier") else "normalization_failed"
    state["identifier_normalized"] = result.get("normalizedIdentifier")
    state["last_error"] = None if result.get("normalizedIdentifier") else result.get("error", "Normalization failed")
    return state

def lookup_node(state: AgentState) -> AgentState:
    identifier = state.get("identifier_normalized") or state.get("identifier_raw") or ""
    result = execute_tool(state["tenant_id"], "begin_tenant_lookup", {"identifier": identifier})
    state["tool_trace"].append({"tool": "begin_tenant_lookup", "output": result})
    state["status"] = "verification_required" if result.get("status") == "verification_required" else "not_found"
    state["matched_customer_ref"] = result if state["status"] == "verification_required" else None
    return state

def verify_node(state: AgentState) -> AgentState:
    reference = state.get("matched_customer_ref") or {}
    value = state.get("verification_value")
    if not value:
        state["last_error"] = "verification_value is required; no default authentication value is permitted"
        state["status"] = "auth_failure"
        return state
    identifier = reference.get("customerId") or state.get("identifier_normalized") or ""
    result = execute_tool(state["tenant_id"], "verify_tenant_record", {
        "identifier": identifier,
        "verificationFactor": value,
    })
    state["tool_trace"].append({"tool": "verify_tenant_record", "output": result})
    if result.get("authenticated"):
        state["authenticated"] = True
        state["claim_context"] = result.get("claims")
        state["status"] = "authenticated"
    else:
        state["verification_attempts"] = state.get("verification_attempts", 0) + 1
        state["status"] = "auth_failure"
    return state

def escalation_node(state: AgentState) -> AgentState:
    state["escalated"] = True
    state["handoff_requested"] = True
    state["status"] = "escalation_pending"
    state["completion_reason"] = state.get("completion_reason") or "Escalation policy triggered."
    return state

def finalize_node(state: AgentState) -> AgentState:
    state["status"] = "completed"
    state.setdefault("completion_reason", "Workflow completed without a persistence side effect.")
    return state

def after_normalize(state: AgentState) -> str:
    return "lookup" if state.get("status") == "normalized" else "finalize"

def after_lookup(state: AgentState) -> str:
    return "verify" if state.get("status") == "verification_required" else "finalize"

def after_verify(state: AgentState) -> str:
    if state.get("status") == "authenticated":
        return "finalize"
    return "escalation" if state.get("verification_attempts", 0) >= 2 else "finalize"

def build_voice_agent_graph():
    workflow = StateGraph(AgentState)
    for name, fn in (("init", init_node), ("normalize", normalize_node), ("lookup", lookup_node), ("verify", verify_node), ("escalation", escalation_node), ("finalize", finalize_node)):
        workflow.add_node(name, fn)
    workflow.set_entry_point("init")
    workflow.add_edge("init", "normalize")
    workflow.add_conditional_edges("normalize", after_normalize)
    workflow.add_conditional_edges("lookup", after_lookup)
    workflow.add_conditional_edges("verify", after_verify)
    workflow.add_edge("escalation", "finalize")
    workflow.add_edge("finalize", END)
    return workflow.compile()
