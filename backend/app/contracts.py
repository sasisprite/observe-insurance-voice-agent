"""Canonical domain contracts shared by provider adapters and the runtime."""
from __future__ import annotations
from enum import StrEnum
from typing import Any, Optional
from pydantic import BaseModel, Field

class CallStatus(StrEnum):
    CONNECTING = "connecting"
    ACTIVE = "active"
    AUTHENTICATING = "authenticating"
    AUTHENTICATED = "authenticated"
    RESOLVING = "resolving"
    ESCALATION_PENDING = "escalation_pending"
    TERMINATING = "terminating"
    COMPLETED = "completed"
    FAILED = "failed"

class TerminationReason(StrEnum):
    CUSTOMER_HANGUP = "customer_hangup"
    CUSTOMER_COMPLETED = "customer_completed"
    CUSTOMER_SILENCE = "customer_silence"
    AGENT_INACTIVITY_TIMEOUT = "agent_inactivity_timeout"
    PROVIDER_ERROR = "provider_error"
    PROVIDER_MAX_DURATION = "provider_max_duration"
    TOOL_TIMEOUT = "tool_timeout"
    TOOL_RETRY_EXHAUSTED = "tool_retry_exhausted"
    AUTHENTICATION_EXHAUSTED = "authentication_exhausted"
    ESCALATION_REQUESTED = "escalation_requested"
    HANDOFF_FAILED = "handoff_failed"
    BROWSER_DISCONNECT = "browser_disconnect"
    UNKNOWN = "unknown"

class EventEnvelope(BaseModel):
    event_id: str
    event_type: str
    tenant_id: str
    call_id: Optional[str] = None
    session_id: Optional[str] = None
    trace_id: Optional[str] = None
    sequence: Optional[int] = None
    source: str
    timestamp: str
    payload: dict[str, Any] = Field(default_factory=dict)

class HandoffCase(BaseModel):
    case_id: str
    tenant_id: str
    call_id: str
    reason: str
    priority: str = "normal"
    status: str = "open"
    summary: str
    recommended_next_action: str
    customer_id: Optional[str] = None
    claim_id: Optional[str] = None
    customer_name: Optional[str] = None
    identity_status: str = "unknown"
    attempts: int = 0
    created_at: str

class CallOutcome(BaseModel):
    call_id: str
    tenant_id: str
    outcome: str
    reason: str
    termination_reason: str
    needs_human_follow_up: bool
    priority: str
    authenticated: bool = False
    escalation_requested: bool = False
    answer_delivered: bool = False
    turn_count: int = 0
    ended_at: Optional[str] = None
    case_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
