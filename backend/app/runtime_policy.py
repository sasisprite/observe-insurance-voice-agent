"""Backend-owned policy for provider adapters and tenant isolation."""
from __future__ import annotations
import os
from typing import Any
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
    assistant = message.get("assistant") if isinstance(message.get("assistant"), dict) else {}
    metadata = assistant.get("metadata") if isinstance(assistant.get("metadata"), dict) else {}
    tenant_id = body.get("tenantId") or metadata.get("tenantId")
    deployment_key = body.get("deploymentKey") or metadata.get("deploymentKey")
    if deployment_key:
        matches = [tid for tid, config in settings.tenants.items() if getattr(config, "deployment_key", None) == deployment_key]
        if len(matches) != 1:
            raise HTTPException(status_code=403, detail="Unknown or ambiguous deployment identity")
        if tenant_id and tenant_id != matches[0]:
            raise HTTPException(status_code=403, detail="Tenant does not match deployment identity")
        tenant_id = matches[0]
    if not tenant_id and os.getenv("APP_ENV", "development") == "development":
        tenant_id = os.getenv("DEFAULT_TENANT_ID", "observe-insurance")
    if not tenant_id or tenant_id not in settings.tenants:
        raise HTTPException(status_code=400, detail="A valid trusted tenant context is required")
    if os.getenv("APP_ENV", "development") == "production" and not deployment_key:
        raise HTTPException(status_code=403, detail="Production calls require a deployment identity")
    return tenant_id

def assert_tool_allowed(name: str) -> None:
    if name in BACKEND_ONLY_TOOLS:
        raise HTTPException(status_code=400, detail=f"{name} is backend-owned and cannot be called by the live assistant")
