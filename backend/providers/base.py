"""Provider-neutral contracts for voice transports and tool/event adapters."""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any

class VoiceProviderAdapter(ABC):
    name: str

    @abstractmethod
    def build_assistant_config(self, tenant_id: str, public_origin: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def parse_tool_calls(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def parse_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError
