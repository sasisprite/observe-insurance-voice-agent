from .base import VoiceProviderAdapter
from .vapi import VapiAdapter

def get_voice_provider(name: str) -> VoiceProviderAdapter:
    if name.lower() == "vapi":
        return VapiAdapter()
    raise ValueError(f"Unsupported voice provider: {name}")
