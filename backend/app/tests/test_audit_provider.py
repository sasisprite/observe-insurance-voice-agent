import pytest
from app.audit import AuditLogger
from app.provider import validate_and_build_vapi_config

def test_audit_redaction_and_idempotency(tmp_path):
    log_file = tmp_path / "events.jsonl"
    logger = AuditLogger(str(log_file))
    
    payload = {"rawIdentifier": "+15552345678", "dateOfBirth": "1988-11-20"}
    key1 = logger.log_event("test_event", "observe-insurance", payload, "call-1")
    key2 = logger.log_event("test_event", "observe-insurance", payload, "call-1")
    
    assert key1 == key2
    assert log_file.exists()
    
    line = log_file.read_text(encoding="utf-8").strip()
    assert "[REDACTED]" in line
    assert "1988-11-20" not in line

def test_vapi_provider_validation():
    cfg = validate_and_build_vapi_config("observe-insurance", "http://localhost:3000")
    assert cfg["name"] == "Sarah"
    assert "transcript" in cfg["clientMessages"]
    assert len(cfg["model"]["tools"]) > 0
