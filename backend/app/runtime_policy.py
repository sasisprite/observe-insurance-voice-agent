"""Backend-owned policy for every provider adapter and tenant."""
from __future__ import annotations
import os
from typing import Any, Optional
from fastapi import HTTPException
from app.config import settings

BACKEND_ONLY_TOOLS = {"log_interaction"}
TOOL_LIMITS = {
    "normalize_identifier": 2,
    "begin_tenant_lookup": 3,
    "verify_tenant_record": 2,
    "lookup_tenant_record": 2,
}

def resolve_tenant_id(body: dict[str, Any], message: dict[str, Any]) -> str:
    metadata = message.get("assistant", {}).get("metadata", {}) if isinstance(message.get("assistant"), dict) else {}
    tenant_id = body.get("tenantId") or metadata.get("tenantId")
    if not tenant_id and os.getenv("APP_ENV", "development") == "development":
        tenant_id = os.getenv("DEFAULT_TENANT_ID", "observe-insurance")
    if not tenant_id or tenant_id not in settings.tenants:
        raise HTTPException(status_code=400, detail="A valid trusted tenant context is required")
    return tenant_id

def assert_tool_allowed(name: str) -> None:
    if name in BACKEND_ONLY_TOOLS:
        raise HTTPException(status_code=400, detail=f"{name} is backend-owned and cannot be called by the live assistant")

def termination_reason(ended_reason: str) -> str:
    value = (ended_reason or "").lower()
    if "silence" in value or "inactiv" in value:
        return "customer_silence"
    if "quota" in value or "error" in value or "failed" in value:
        return "provider_error"
    if "max" in value or "duration" in value:
        return "provider_max_duration"
    if "customer" in value or "hangup" in value or "ended" in value:
        return "customer_hangup"
    return "unknown"
