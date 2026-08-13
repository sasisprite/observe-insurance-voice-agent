from typing import Any, Dict, List
from app.config import settings

SUPPORTED_VAPI_CLIENT_MESSAGES = {
    "conversation-update",
    "assistant.speechStarted",
    "function-call",
    "function-call-result",
    "hang",
    "language-changed",
    "metadata",
    "model-output",
    "speech-update",
    "status-update",
    "transcript",
    "tool-calls",
    "tool-calls-result",
    "tool.completed",
    "transfer-update",
    "user-interrupted",
    "voice-input",
    "workflow.node.started",
    "assistant.started",
}

def _build_voice() -> dict:
    """Voice config from YAML. `version` is only emitted when set, because Vapi
    rejects the assistant outright if it carries an unexpected null field."""
    tts = settings.voice.tts
    voice: dict[str, Any] = {
        "provider": tts.provider,
        "voiceId": tts.voice_id,
        "speed": tts.speed,
    }
    if tts.version is not None:
        voice["version"] = tts.version
    return voice


def validate_and_build_vapi_config(tenant_id: str, frontend_origin: str) -> dict:
    tenant = settings.tenants.get(tenant_id)
    prompt = tenant.system_prompt if tenant else "You are Sarah, an AI Claims Support Assistant."
    
    client_messages = ["transcript", "status-update", "tool-calls", "tool-calls-result"]
    for msg in client_messages:
        if msg not in SUPPORTED_VAPI_CLIENT_MESSAGES:
            raise ValueError(f"Unsupported Vapi clientMessage: {msg}")

    # Each tool carries its own server URL: Vapi dispatches tool calls from its cloud,
    # so this must be publicly reachable, not the browser's own origin.
    tool_server = {"url": f"{frontend_origin.rstrip('/')}/api/voice-agent/tools"}
    tools = []
    if tenant and tenant.tools:
        for t in tenant.tools:
            tools.append({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
                "server": tool_server,
            })

    return {
        "name": tenant.agent_name if tenant else "Sarah",
        "firstMessage": (tenant.first_message if tenant and tenant.first_message
                         else f"Hi, you've reached {tenant.organization_name if tenant else 'Observe Insurance'} — I'm {tenant.agent_name if tenant else 'Sarah'}. What can I help you with today?"),
        "model": {
            "provider": settings.llm.provider,
            "model": settings.llm.model,
            "temperature": settings.llm.temperature,
            "messages": [{"role": "system", "content": prompt}],
            "tools": tools,
        },
        "voice": _build_voice(),
        "transcriber": {
            "provider": settings.voice.transcriber.provider,
            "model": settings.voice.transcriber.model,
            "language": settings.voice.transcriber.language,
            "endpointing": settings.voice.endpointing_ms,
        },
        "firstMessageMode": "assistant-speaks-first",
        "clientMessages": client_messages,
        "serverMessages": ["status-update", "end-of-call-report", "tool-calls"],
        "server": {"url": f"{frontend_origin.rstrip('/')}/api/voice-agent/events"},
        "maxDurationSeconds": settings.server.timeout_seconds,
    }
