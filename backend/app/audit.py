import hashlib
import json
from pathlib import Path
from threading import Lock
from typing import Any, Optional
from app.config import ROOT_DIR, settings

class AuditLogger:
    def __init__(self, log_path: Optional[str] = None):
        self.log_path = Path(log_path) if log_path else ROOT_DIR / settings.paths.event_log
        self._lock = Lock()
        self._seen: set[str] = set()
        if self.log_path.exists():
            try:
                with self.log_path.open("r", encoding="utf-8") as handle:
                    for line in handle:
                        try:
                            key = json.loads(line).get("idempotencyKey")
                            if key:
                                self._seen.add(key)
                        except json.JSONDecodeError:
                            continue
            except OSError:
                pass

    def _redact(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                key: "[REDACTED]" if key.lower() in {"dob", "dateofbirth", "verificationvalue", "verification_value", "ssn", "password"} else self._redact(value)
                for key, value in data.items()
            }
        if isinstance(data, list):
            return [self._redact(item) for item in data]
        return data

    def log_event(self, event_type: str, tenant_id: str, payload: dict, call_id: Optional[str] = None) -> str:
        safe_payload = self._redact(payload)
        raw = f"{tenant_id}:{call_id}:{event_type}:{json.dumps(safe_payload, sort_keys=True, default=str)}"
        key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        record = {"idempotencyKey": key, "tenantId": tenant_id, "callId": call_id, "eventType": event_type, "payload": safe_payload}
        with self._lock:
            if key in self._seen:
                return key
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, default=str) + "\n")
            self._seen.add(key)
        return key

audit_logger = AuditLogger()
