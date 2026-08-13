"""Classifies how a call ended and whether a human needs to pick it up.

The browser is not a reliable place to decide this. The completion record used to be
written by the client when the caller pressed "End session", so any dropout — tab
closed, laptop asleep, network lost, page crash — left no trace at all. A real call in
this project authenticated successfully and then vanished from the log for exactly that
reason.

Vapi delivers `end-of-call-report` to the server webhook regardless of what happened to
the browser, so outcome classification belongs here. Every call produces a record, and
anything that did not reach a clean finish is queued for a human.
"""

from typing import Any, Optional

# Vapi ended the call the way anyone would expect: somebody hung up on purpose.
CLEAN_ENDED_REASONS = {
    "customer-ended-call",
    "assistant-ended-call",
    "assistant-ended-call-with-hangup-task",
    "assistant-forwarded-call",
}

# The caller stopped responding. They may have been cut off mid-problem.
ABANDONED_ENDED_REASONS = {
    "silence-timed-out",
    "customer-did-not-answer",
    "customer-did-not-give-microphone-permission",
    "exceeded-max-duration",
}

ESCALATION_PHRASES = (
    "representative", "human agent", "real person", "speak to someone",
    "talk to a person", "supervisor", "agent please",
)


def _is_system_failure(ended_reason: str) -> bool:
    """Provider/pipeline faults — never the caller's fault, always worth a follow-up."""
    reason = (ended_reason or "").lower()
    return (
        reason.startswith("pipeline-error")
        or reason.startswith("call.start.error")
        or "quota-exceeded" in reason
        or "out-of-credits" in reason
        or "error" in reason and reason not in CLEAN_ENDED_REASONS
    )


def summarize_tool_activity(tool_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Reduces the tool results seen during a call into the facts we care about."""
    authenticated = False
    auth_failures = 0
    agent_logged = False
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    claim_id: Optional[str] = None

    for entry in tool_results:
        name = entry.get("toolName")
        result = entry.get("result")
        if not isinstance(result, dict):
            continue
        if name == "verify_tenant_record":
            if result.get("status") == "success" or result.get("authenticated") is True:
                authenticated = True
                customer_name = result.get("customerName") or customer_name
                customer_id = result.get("customerId") or customer_id
                claims = result.get("claims") or []
                if claims and isinstance(claims[0], dict):
                    claim_id = claims[0].get("claimId") or claim_id
            elif result.get("status") == "auth_failure":
                auth_failures += 1
        elif name == "begin_tenant_lookup":
            customer_name = result.get("customerName") or customer_name
            customer_id = result.get("customerId") or customer_id
        elif name == "log_interaction":
            agent_logged = True

    return {
        "authenticated": authenticated,
        "authFailures": auth_failures,
        "agentLogged": agent_logged,
        "customerName": customer_name,
        "customerId": customer_id,
        "claimId": claim_id,
    }


def _transcript_turns(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    turns = []
    for message in messages or []:
        role = message.get("role")
        if role in ("system", "tool_calls", "tool_call_result"):
            continue
        text = message.get("message") or message.get("content") or ""
        if isinstance(text, str) and text.strip():
            turns.append({"role": role, "text": text.strip()})
    return turns


def _requested_escalation(turns: list[dict[str, str]]) -> bool:
    return any(
        t["role"] == "user" and any(phrase in t["text"].lower() for phrase in ESCALATION_PHRASES)
        for t in turns
    )


# Shorter than this and the agent was cut off mid-word rather than answering.
SUBSTANTIVE_TURN_CHARS = 12


def _answer_delivered(messages: list[dict[str, Any]], agent_logged: bool) -> bool:
    """True when the caller actually got an answer before the call ended.

    Two independent signals, either of which is sufficient:

    1. The agent called log_interaction — its own end-of-call wrap-up, which it only
       reaches after handling the request.
    2. The agent spoke a substantive turn after the caller's final utterance, so the
       last thing that happened was an answer rather than an unanswered question.

    Anchoring on the caller's last turn matters: anchoring on the last *tool* call
    misreads a successful call as dropped, because the wrap-up log is itself the final
    tool call and no bot turn follows it.
    """
    if agent_logged:
        return True

    last_user_index = -1
    for index, message in enumerate(messages or []):
        if message.get("role") == "user":
            last_user_index = index
    if last_user_index == -1:
        return False

    return any(
        message.get("role") == "bot"
        and len((message.get("message") or "").strip()) > SUBSTANTIVE_TURN_CHARS
        for message in (messages or [])[last_user_index + 1:]
    )


def classify_call(
    call_id: str,
    tenant_id: str,
    ended_reason: str,
    messages: list[dict[str, Any]],
    tool_results: list[dict[str, Any]],
    ended_at: Optional[str] = None,
) -> dict[str, Any]:
    """Produces the durable outcome record for one call."""
    facts = summarize_tool_activity(tool_results)
    turns = _transcript_turns(messages)
    escalation_requested = _requested_escalation(turns)
    answer_delivered = _answer_delivered(messages, facts["agentLogged"])
    clean = ended_reason in CLEAN_ENDED_REASONS

    if _is_system_failure(ended_reason):
        outcome, reason = "system_failure", f"The call ended on a platform fault ({ended_reason})."
    elif escalation_requested:
        outcome, reason = "escalation_requested", "The caller asked for a human representative."
    elif facts["authFailures"] >= 2:
        outcome, reason = "auth_failed", "Identity verification failed repeatedly."
    elif facts["authenticated"] and not answer_delivered:
        outcome, reason = (
            "dropped_after_auth",
            "The caller was verified but the call ended before the agent delivered the claim status.",
        )
    elif facts["authenticated"]:
        outcome, reason = "completed", "The caller was verified and received their claim status."
    elif ended_reason in ABANDONED_ENDED_REASONS:
        outcome, reason = "abandoned_before_auth", f"The caller stopped responding before verifying ({ended_reason})."
    elif clean and len(turns) <= 2:
        outcome, reason = "abandoned_before_auth", "The caller hung up almost immediately."
    elif clean:
        outcome, reason = "ended_before_auth", "The call ended before the caller was verified."
    else:
        outcome, reason = "unknown", f"The call ended for an unrecognised reason ({ended_reason})."

    needs_follow_up = outcome != "completed"
    # Someone we identified and verified is the most actionable follow-up: we know who
    # they are and which claim they were asking about.
    if outcome in ("dropped_after_auth", "system_failure", "escalation_requested"):
        priority = "high"
    elif needs_follow_up:
        priority = "normal"
    else:
        priority = "none"

    last_user = next((t["text"] for t in reversed(turns) if t["role"] == "user"), None)

    case_id = f"CASE-{call_id}" if needs_follow_up else None
    return {
        "callId": call_id,
        "tenantId": tenant_id,
        "caseId": case_id,
        "handoffStatus": "open" if needs_follow_up else "not_required",
        "outcome": outcome,
        "reason": reason,
        "needsHumanFollowUp": needs_follow_up,
        "priority": priority,
        "endedReason": ended_reason,
        "authenticated": facts["authenticated"],
        "authFailures": facts["authFailures"],
        "answerDelivered": answer_delivered,
        "escalationRequested": escalation_requested,
        "customerName": facts["customerName"],
        "customerId": facts["customerId"],
        "claimId": facts["claimId"],
        "lastCallerUtterance": last_user,
        "turnCount": len(turns),
        "endedAt": ended_at,
    }
