"""Vapi implementation of the provider-neutral voice adapter."""
from __future__ import annotations
from typing import Any
from app.provider import validate_and_build_vapi_config
from .base import VoiceProviderAdapter

class VapiAdapter(VoiceProviderAdapter):
    name = "vapi"

    def build_assistant_config(self, tenant_id: str, public_origin: str) -> dict[str, Any]:
        return validate_and_build_vapi_config(tenant_id, public_origin)

    def parse_tool_calls(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        message = payload.get("message") or payload
        calls = message.get("toolCallList") or message.get("toolCalls") or []
        result = []
        for call in calls:
            function = call.get("function") if isinstance(call.get("function"), dict) else call
            if not isinstance(function, dict) or not function.get("name"):
                continue
            result.append({
                "toolCallId": call.get("id") or call.get("toolCallId"),
                "name": function.get("name"),
                "arguments": function.get("arguments") or {},
            })
        return result

    def parse_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        message = payload.get("message") or payload
        assistant = message.get("assistant") if isinstance(message.get("assistant"), dict) else {}
        metadata = assistant.get("metadata") if isinstance(assistant.get("metadata"), dict) else {}
        call = message.get("call") if isinstance(message.get("call"), dict) else {}
        return {
            "eventType": message.get("type") or payload.get("type") or "unknown",
            "callId": payload.get("callId") or call.get("id"),
            "tenantId": payload.get("tenantId") or metadata.get("tenantId"),
            "deploymentKey": payload.get("deploymentKey") or metadata.get("deploymentKey"),
            "payload": message,
        }
