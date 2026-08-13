"""MySQL/TiDB repository for production runtime data."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse
import pymysql
from app.call_outcome import classify_call
from app.normalization import identifier_candidates, normalize_date

class SqlRepository:
    def __init__(self, database_url: str):
        parsed = urlparse(database_url)
        self._config = {
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 3306,
            "user": parsed.username or "root",
            "password": parsed.password or "",
            "database": (parsed.path or "/").lstrip("/"),
            "autocommit": True,
            "cursorclass": pymysql.cursors.DictCursor,
        }

    def _connection(self):
        return pymysql.connect(**self._config)

    def _customer(self, tenant_id: str, identifier: str) -> Optional[dict]:
        candidates = list(identifier_candidates(identifier))
        if not candidates:
            return None
        marks = ",".join(["%s"] * len(candidates))
        query = f"SELECT * FROM voiceCustomers WHERE tenantId=%s AND (customerId IN ({marks}) OR phoneNumber IN ({marks})) LIMIT 1"
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query, [tenant_id, *candidates, *candidates])
            return cur.fetchone()

    def lookup_customer(self, tenant_id: str, identifier: str) -> dict:
        customer = self._customer(tenant_id, identifier)
        if not customer:
            return {
                "status": "not_found",
                "authenticated": False,
                "message": "Customer record not found. Please verify your phone number or account ID.",
            }
        phone = str(customer.get("phoneNumber") or "")
        return {
            "status": "verification_required",
            "authenticated": False,
            "customerName": customer.get("fullName"),
            "maskedPhone": f"***-***-{phone[-4:]}",
            "customerId": customer.get("customerId"),
            "requiredFactor": "date of birth (YYYY-MM-DD)",
            "prompt": f"Thanks, {customer.get('fullName', 'Customer')}. Could you please verify your date of birth?",
        }

    def verify_record(self, tenant_id: str, identifier: str, verification_value: str) -> dict:
        customer = self._customer(tenant_id, identifier)
        if not customer:
            return {"status": "not_found", "authenticated": False, "message": "Customer record not found for verification."}
        expected = normalize_date(str(customer.get("verificationFactor") or ""))
        given = normalize_date(verification_value)
        if not expected or expected != given:
            return {"status": "auth_failure", "authenticated": False, "customerId": customer.get("customerId"), "message": "Verification failed."}
        claim = None
        if customer.get("claimId"):
            with self._connection() as conn, conn.cursor() as cur:
                cur.execute("SELECT * FROM voiceClaims WHERE tenantId=%s AND claimId=%s LIMIT 1", (tenant_id, customer["claimId"]))
                claim = cur.fetchone()
        return {
            "status": "success",
            "authenticated": True,
            "customerId": customer.get("customerId"),
            "customerName": customer.get("fullName"),
            "claims": [claim] if claim else [],
        }

    def append_event(self, tenant_id: str, event_id: str, call_id: Optional[str], event_type: str, source: str, payload: dict, sequence: Optional[int] = None) -> None:
        query = "INSERT INTO voiceCallEvents (eventId, callId, tenantId, eventType, source, sequence, payloadJson) VALUES (%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE eventId=eventId"
        values = (event_id, call_id, tenant_id, event_type, source, sequence, json.dumps(payload, default=str))
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query, values)

    def record_call_outcome(self, tenant_id: str, call_id: str, report: dict) -> dict:
        artifact = report.get("artifact") or {}
        messages = artifact.get("messages") or []
        ended_reason = report.get("endedReason") or "unknown"
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT eventType, payloadJson FROM voiceCallEvents WHERE tenantId=%s AND callId=%s ORDER BY id", (tenant_id, call_id))
            events = cur.fetchall()
        tool_results = []
        for event in events:
            if event.get("eventType") != "tool_dispatch_response":
                continue
            payload = json.loads(event.get("payloadJson") or "{}")
            tool_results.append({"toolName": payload.get("toolName"), "result": payload.get("result")})
        outcome = classify_call(call_id, tenant_id, ended_reason, messages, tool_results, datetime.now(timezone.utc).isoformat())
        query = "INSERT INTO voiceCalls (callId, tenantId, provider, status, outcome, terminationReason, metadataJson, endedAt) VALUES (%s,%s,%s,%s,%s,%s,%s,NOW()) ON DUPLICATE KEY UPDATE status=VALUES(status), outcome=VALUES(outcome), terminationReason=VALUES(terminationReason), metadataJson=VALUES(metadataJson), endedAt=VALUES(endedAt)"
        values = (call_id, tenant_id, "vapi", "completed", outcome["outcome"], outcome["endedReason"], json.dumps(outcome, default=str))
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query, values)
            if outcome["needsHumanFollowUp"]:
                case_query = "INSERT INTO handoffCases (caseId, callId, tenantId, status, priority, reason, summary, payloadJson) VALUES (%s,%s,%s,'open',%s,%s,%s,%s) ON DUPLICATE KEY UPDATE priority=VALUES(priority), reason=VALUES(reason), summary=VALUES(summary), payloadJson=VALUES(payloadJson)"
                case_values = (outcome["caseId"], call_id, tenant_id, outcome["priority"], outcome["outcome"], outcome["reason"], json.dumps(outcome, default=str))
                cur.execute(case_query, case_values)
        return outcome

    def load_call_outcomes(self, tenant_id: str) -> list[dict]:
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT metadataJson FROM voiceCalls WHERE tenantId=%s ORDER BY startedAt DESC", (tenant_id,))
            rows = cur.fetchall()
        return [json.loads(row["metadataJson"]) for row in rows if row.get("metadataJson")]
