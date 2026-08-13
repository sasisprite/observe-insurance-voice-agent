import json
import re
import time
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from threading import RLock
from app.config import settings, ROOT_DIR
from app.normalization import identifier_candidates, normalize_date

class DatabaseRepository:
    def __init__(self, db_path: Optional[str] = None):
        if db_path:
            self.db_path = Path(db_path)
        else:
            self.db_path = ROOT_DIR / settings.paths.database
        self._write_lock = RLock()

    def load_db(self) -> dict:
        if not self.db_path.exists():
            return {"tenants": {}}
        try:
            with open(self.db_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"tenants": {}}

    def save_db(self, data: dict):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.db_path.with_suffix(self.db_path.suffix + ".tmp")
        with self._write_lock:
            with temp_path.open("w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2)
                handle.flush()
            temp_path.replace(self.db_path)

    def find_customer(self, tenant_id: str, identifier: str) -> Optional[dict]:
        """Matches a caller against either stored phone number or customer ID.

        Both sides are expanded into every plausible spelling, so transcription
        formatting (punctuation, country code, casing) never decides a match.
        """
        db = self.load_db()
        customers = db.get("tenants", {}).get(tenant_id, {}).get("customers", [])
        given = set(identifier_candidates(identifier))
        if not given:
            return None

        for customer in customers:
            stored = set(identifier_candidates(str(customer.get("phoneNumber", ""))))
            stored |= set(identifier_candidates(str(customer.get("customerId", ""))))
            if given & stored:
                return customer
        return None

    def lookup_customer(self, tenant_id: str, identifier: str) -> dict:
        customer = self.find_customer(tenant_id, identifier)
        if not customer:
            return {
                "status": "not_found",
                "authenticated": False,
                "message": "Customer record not found. Please verify your phone number or account ID.",
            }

        stored_phone = str(customer.get("phoneNumber", ""))
        masked = f"***-***-{stored_phone[-4:]}" if len(stored_phone) >= 4 else "***"
        return {
            "status": "verification_required",
            "authenticated": False,
            "customerName": customer.get("fullName"),
            "maskedPhone": masked,
            "customerId": customer.get("customerId", ""),
            "requiredFactor": "date of birth (YYYY-MM-DD)",
            "prompt": f"Thanks, {customer.get('fullName', 'Customer')}. To protect your privacy, could you please verify your date of birth?",
        }

    def verify_record(self, tenant_id: str, identifier: str, verification_value: str) -> dict:
        """Authenticates a caller matched by phone or customer ID against their date of birth."""
        customer = self.find_customer(tenant_id, identifier)
        if not customer:
            return {
                "status": "not_found",
                "authenticated": False,
                "message": "Customer record not found for verification.",
            }

        stored_dob = normalize_date(str(customer.get("verificationFactor", "")))
        given_dob = normalize_date(verification_value)
        if not stored_dob or not given_dob or stored_dob != given_dob:
            return {
                "status": "auth_failure",
                "authenticated": False,
                "customerId": customer.get("customerId", ""),
                "message": "Verification failed. The date of birth provided does not match our records.",
            }

        claim_info = {
            "claimId": customer.get("claimId"),
            "policyNumber": customer.get("policyNumber"),
            "status": customer.get("claimStatus"),
            "stage": customer.get("claimStage"),
            "requiredDocuments": customer.get("requiredDocuments", []),
            "adjusterName": customer.get("adjusterName"),
        }
        return {
            "status": "success",
            "authenticated": True,
            "customerName": customer.get("fullName"),
            "customerId": customer.get("customerId", ""),
            "claims": [claim_info],
            "summary": f"Authenticated successfully. Claim {claim_info['claimId']} status is {claim_info['status']}.",
        }

    def _outcome_log_path(self) -> Path:
        return (ROOT_DIR / settings.paths.call_log).with_name("call-outcomes.json")

    def load_call_outcomes(self, tenant_id: Optional[str] = None) -> List[dict]:
        path = self._outcome_log_path()
        if not path.exists():
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f) or {}
        except Exception:
            return []
        records = data.get("calls", []) if isinstance(data, dict) else []
        return [r for r in records if not tenant_id or r.get("tenantId") == tenant_id]

    def record_call_outcome(self, tenant_id: str, call_id: str, report: dict) -> dict:
        """Derives and persists the outcome of a finished call.

        Keyed by callId and idempotent: Vapi retries webhooks, and the browser may also
        have logged the same call, so a repeat delivery updates in place rather than
        creating a duplicate follow-up for the escalation team.
        """
        from app.call_outcome import classify_call

        artifact = report.get("artifact") or {}
        messages = artifact.get("messages") or []
        ended_reason = report.get("endedReason") or (report.get("call") or {}).get("endedReason") or "unknown"

        tool_results = [
            {"toolName": e.get("payload", {}).get("toolName"), "result": e.get("payload", {}).get("result")}
            for e in self._events_for_call(call_id)
            if e.get("eventType") == "tool_dispatch_response"
        ]

        ended_at = report.get("timestamp")
        if isinstance(ended_at, (int, float)):
            ended_at = datetime.fromtimestamp(ended_at / 1000, tz=timezone.utc).isoformat()

        outcome = classify_call(call_id, tenant_id, ended_reason, messages, tool_results, ended_at)

        path = self._outcome_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        existing = {"calls": []}
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    existing = json.load(f) or {"calls": []}
            except Exception:
                existing = {"calls": []}
        calls = existing.get("calls", []) if isinstance(existing, dict) else []
        calls = [c for c in calls if c.get("callId") != call_id]
        calls.append(outcome)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"calls": calls}, f, indent=2)

        if outcome["needsHumanFollowUp"]:
            print(
                f"[voice-agent] FOLLOW-UP ({outcome['priority']}) call={call_id} "
                f"outcome={outcome['outcome']} customer={outcome.get('customerName')} "
                f"claim={outcome.get('claimId')} :: {outcome['reason']}"
            )
        return outcome

    def _events_for_call(self, call_id: str) -> List[dict]:
        path = ROOT_DIR / settings.paths.event_log
        if not path.exists():
            return []
        events = []
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or call_id not in line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if record.get("callId") == call_id:
                        events.append(record)
        except Exception:
            return []
        return events

    def log_interaction(self, tenant_id: str, record: dict) -> dict:
        db = self.load_db()
        if "interactions" not in db:
            db["interactions"] = []
        db["interactions"].append({"tenantId": tenant_id, **record})
        self.save_db(db)

        try:
            call_log_path = ROOT_DIR / settings.paths.call_log
            call_log_path.parent.mkdir(parents=True, exist_ok=True)
            existing: Any = []
            if call_log_path.exists():
                with open(call_log_path, "r", encoding="utf-8") as f:
                    existing = json.load(f) or []
            # The historical file is {"calls": [...]}; keep that shape so an existing
            # log is appended to rather than replaced by an incompatible bare list.
            calls = existing.get("calls", []) if isinstance(existing, dict) else existing
            calls.append({"callId": f"CALL-{int(time.time() * 1000)}", "tenantId": tenant_id, **record})
            with open(call_log_path, "w", encoding="utf-8") as f:
                json.dump({"calls": calls}, f, indent=2)
        except Exception as exc:
            # Logging is best-effort, but a silent failure hid a real format bug for a
            # long time, so make it visible without breaking the call.
            print(f"[voice-agent] failed to append call log: {exc}")

        return {"logged": True, "record": record}

def build_repository():
    database_url = os.getenv("DATABASE_URL")
    mode = os.getenv("VOICE_REPOSITORY", "sql" if os.getenv("APP_ENV") == "production" else "json")
    if mode == "sql":
        if not database_url:
            raise RuntimeError("DATABASE_URL is required when VOICE_REPOSITORY=sql")
        from app.sql_repository import SqlRepository
        return SqlRepository(database_url)
    return DatabaseRepository()

repo = build_repository()
