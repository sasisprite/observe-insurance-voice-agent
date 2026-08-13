import os
from pathlib import Path
import yaml
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT_DIR / "config.yaml"

class ServerConfig(BaseModel):
    port: int = 3000
    host: str = "0.0.0.0"
    timeout_seconds: int = 600
    vapi_tool_dedup_ttl_seconds: int = 15

class PathsConfig(BaseModel):
    database: str = "server/database.json"
    call_log: str = "server/call-log.json"
    tool_log: str = "server/tool-call-log.json"
    event_log: str = "server/voice-event-log.jsonl"

class LLMConfig(BaseModel):
    provider: str = "openrouter"
    model: str = "openai/gpt-4o-mini"
    temperature: float = 0.2
    max_tokens: int = 1024
    api_base_url: str = "https://openrouter.ai/api/v1"

class TranscriberConfig(BaseModel):
    provider: str = "deepgram"
    model: str = "nova-2"
    language: str = "en-US"

class TTSConfig(BaseModel, extra="allow"):
    provider: str = "vapi"
    voice_id: str = "Savannah"
    speed: float = 1.0
    version: Optional[int] = None

class VoiceConfig(BaseModel):
    connect_timeout_seconds: int = 20
    connect_timeout_warning_seconds: int = 5
    inactivity_prompt_after_seconds: int = 10
    inactivity_timeout_seconds: int = 20
    inactivity_prompt_message: str = "I haven\'t heard back. Are you still there, or would you like me to continue?"
    inactivity_timeout_message: str = "I\'m going to end this call because I haven\'t heard a response. Thanks for calling."
    goodbye_message: str = "Thanks for calling. Have a great day."
    goodbye_delay_ms: int = 900
    endpointing_ms: int = 500
    default_provider: str = "vapi"
    transcriber: TranscriberConfig = Field(default_factory=TranscriberConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)

class AuthConfig(BaseModel):
    required_identifier_label: str = "phone number or customer ID"
    required_verification_label: str = "date of birth (YYYY-MM-DD)"
    max_attempts: int = 2

class FAQItem(BaseModel):
    question: str
    answer: str

class ToolDef(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)

class TenantConfig(BaseModel):
    tenant_id: str
    deployment_key: Optional[str] = None
    organization_name: str
    agent_name: str = "Sarah"
    first_message: Optional[str] = None
    system_prompt: str
    auth_config: AuthConfig = Field(default_factory=AuthConfig)
    faqs: List[FAQItem] = Field(default_factory=list)
    tools: List[ToolDef] = Field(default_factory=list)

class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    paths: PathsConfig = Field(default_factory=PathsConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    tenants: Dict[str, TenantConfig] = Field(default_factory=dict)

def load_app_config(path: Optional[Path] = None) -> AppConfig:
    p = path or CONFIG_PATH
    if not p.exists():
        return AppConfig()
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return AppConfig.model_validate(data)
    except Exception as e:
        raise RuntimeError(f"Failed to load or validate configuration from {p}: {e}")

# Singleton loaded instance
settings = load_app_config()
