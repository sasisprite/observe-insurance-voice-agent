"""Outcome classification, anchored on transcripts from real calls.

The completion record used to be written only by the browser, so a page crash, closed
tab, or lost network left an authenticated caller with no record at all. These cases
come from two real calls in this project: one that succeeded and one that dropped
mid-answer when the page reloaded.
"""

import pytest

from app.call_outcome import classify_call, summarize_tool_activity

TENANT = "observe-insurance"

VERIFY_SUCCESS = {
    "toolName": "verify_tenant_record",
    "result": {
        "status": "success",
        "authenticated": True,
        "customerName": "Eleanor Vance",
        "customerId": "CUST-10042",
        "claims": [{"claimId": "CLM-55412", "status": "Under Review"}],
    },
}
VERIFY_FAILURE = {"toolName": "verify_tenant_record", "result": {"status": "auth_failure", "authenticated": False}}
LOOKUP_OK = {"toolName": "begin_tenant_lookup", "result": {"status": "verification_required", "customerName": "Eleanor Vance"}}
AGENT_WRAP_UP = {"toolName": "log_interaction", "result": {"logged": True}}


def bot(text):
    return {"role": "bot", "message": text}


def user(text):
    return {"role": "user", "message": text}


TOOL = {"role": "tool_calls", "message": ""}
TOOL_RESULT = {"role": "tool_call_result", "message": ""}


# The successful call: status delivered, follow-up questions answered, agent wrapped up.
COMPLETED_TRANSCRIPT = [
    bot("Hi. You've reached Observe Insurance. I'm Sarah."),
    user("Our phone number is plus 1 triple 5 2 3 4 5 6 7 8. Can you check my recent claim status?"),
    bot("Thanks, Eleanor Vance. Could you please verify your date of birth?"),
    TOOL, TOOL_RESULT,
    user("I think it's November 20 19 88."),
    bot("Your claim is currently under review. The next step is to submit the signed repair estimate."),
    user("Where do I submit this?"),
    bot("You can submit through our online portal or email your adjuster, Marcus Brody."),
    user("I think that's pretty much it for now."),
    bot("Got it all logged. Thanks for calling, Eleanor. Have a great day."),
    TOOL, TOOL_RESULT,
]

# The dropped call: verified, then the page reloaded mid-sentence.
DROPPED_TRANSCRIPT = [
    bot("Hi. You've reached Observe Insurance. I'm Sarah."),
    user("Can you check my latest client status?"),
    bot("Sure thing. Could you please provide your phone number or account ID?"),
    user("Phone number is plus 1 triple 5 2 3 4 5 6 7 8."),
    bot("Thanks, Eleanor Vance. Could you please verify your date of birth?"),
    TOOL, TOOL_RESULT,
    user("Date of birth is November 20 19 88."),
    bot("1"),
    TOOL, TOOL_RESULT,
]


def test_satisfied_caller_is_not_queued_for_follow_up():
    """Ends on silence-timed-out because they stopped talking after goodbye — not a drop."""
    outcome = classify_call(
        "c1", TENANT, "silence-timed-out", COMPLETED_TRANSCRIPT,
        [LOOKUP_OK, VERIFY_SUCCESS, AGENT_WRAP_UP],
    )
    assert outcome["outcome"] == "completed"
    assert outcome["needsHumanFollowUp"] is False
    assert outcome["priority"] == "none"


def test_authenticated_caller_cut_off_mid_answer_is_high_priority():
    outcome = classify_call(
        "c2", TENANT, "customer-ended-call", DROPPED_TRANSCRIPT, [LOOKUP_OK, VERIFY_SUCCESS],
    )
    assert outcome["outcome"] == "dropped_after_auth"
    assert outcome["needsHumanFollowUp"] is True
    assert outcome["priority"] == "high"
    # The human picking this up needs to know who to call back and about what.
    assert outcome["customerName"] == "Eleanor Vance"
    assert outcome["claimId"] == "CLM-55412"
    assert outcome["lastCallerUtterance"] == "Date of birth is November 20 19 88."


def test_a_clean_hangup_after_the_answer_still_counts_as_complete():
    outcome = classify_call(
        "c3", TENANT, "customer-ended-call", COMPLETED_TRANSCRIPT,
        [LOOKUP_OK, VERIFY_SUCCESS, AGENT_WRAP_UP],
    )
    assert outcome["outcome"] == "completed"


def test_repeated_verification_failure_is_flagged():
    outcome = classify_call(
        "c4", TENANT, "customer-ended-call",
        [bot("Could you verify your date of birth?"), user("nineteen eighty"), bot("That did not match.")],
        [LOOKUP_OK, VERIFY_FAILURE, VERIFY_FAILURE],
    )
    assert outcome["outcome"] == "auth_failed"
    assert outcome["needsHumanFollowUp"] is True


def test_explicit_request_for_a_human_is_high_priority():
    outcome = classify_call(
        "c5", TENANT, "customer-ended-call",
        [bot("How can I help?"), user("Just get me a representative please"), bot("Connecting you now.")],
        [],
    )
    assert outcome["outcome"] == "escalation_requested"
    assert outcome["priority"] == "high"


@pytest.mark.parametrize(
    "ended_reason",
    ["pipeline-error-openai-llm-failed", "call.start.error-subscription-insufficient-credits", "11labs-quota-exceeded"],
)
def test_platform_faults_are_never_blamed_on_the_caller(ended_reason):
    outcome = classify_call("c6", TENANT, ended_reason, [bot("Hi.")], [])
    assert outcome["outcome"] == "system_failure"
    assert outcome["priority"] == "high"


def test_caller_who_went_silent_before_verifying_is_queued_normally():
    outcome = classify_call(
        "c7", TENANT, "silence-timed-out",
        [bot("Hi."), user("I need my claim status"), bot("What is your phone number?")],
        [],
    )
    assert outcome["outcome"] == "abandoned_before_auth"
    assert outcome["needsHumanFollowUp"] is True
    assert outcome["priority"] == "normal"


def test_immediate_hangup_is_recorded_but_low_signal():
    outcome = classify_call("c8", TENANT, "customer-ended-call", [bot("Hi. I'm Sarah.")], [])
    assert outcome["outcome"] == "abandoned_before_auth"
    assert outcome["authenticated"] is False


def test_tool_summary_extracts_the_callback_details():
    facts = summarize_tool_activity([LOOKUP_OK, VERIFY_SUCCESS, AGENT_WRAP_UP])
    assert facts["authenticated"] is True
    assert facts["agentLogged"] is True
    assert facts["customerId"] == "CUST-10042"
    assert facts["claimId"] == "CLM-55412"


def test_every_call_produces_a_record_even_when_unrecognised():
    outcome = classify_call("c9", TENANT, "some-new-vapi-reason", [bot("Hi.")], [])
    assert outcome["callId"] == "c9"
    assert outcome["needsHumanFollowUp"] is True
