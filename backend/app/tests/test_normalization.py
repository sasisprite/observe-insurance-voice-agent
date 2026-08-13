"""Regression tests for the speech-to-canonical layer the tool contract depends on."""

import pytest

from app.normalization import (
    format_us_phone,
    identifier_candidates,
    normalize_customer_id,
    normalize_date,
    normalize_identifier,
    spoken_digits,
)
from app.repository import DatabaseRepository
from app.tools import execute_tool, looks_like_schema_echo

TENANT = "observe-insurance"


@pytest.mark.parametrize(
    "spoken,expected",
    [
        ("plus one triple five two three four five six seven eight", "15552345678"),
        ("double four double two", "4422"),
        ("five five five, nine eight seven, six five four three", "5559876543"),
        ("555 987 6543", "5559876543"),
    ],
)
def test_spoken_digit_runs_collapse_to_digits(spoken, expected):
    assert spoken_digits(spoken) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("plus one triple five two three four five six seven eight", "+1 (555) 234-5678"),
        ("+15552345678", "+1 (555) 234-5678"),
        ("+1 (555) 234-5678", "+1 (555) 234-5678"),
        ("555-987-6543", "+1 (555) 987-6543"),
    ],
)
def test_phone_identifiers_reach_the_canonical_wire_format(raw, expected):
    result = normalize_identifier(raw)
    assert result["ok"] is True
    assert result["type"] == "phone"
    assert result["normalizedIdentifier"] == expected


@pytest.mark.parametrize(
    "raw",
    [
        "c u s t hyphen one zero zero four two",
        "CUST-10042",
        "cust10042",
        "my customer id is cust 10042",
        "account id cust dash one zero zero four two",
    ],
)
def test_customer_ids_survive_spelling_and_casing_variants(raw):
    assert normalize_customer_id(raw) == "cust-10042"


def test_short_digit_runs_are_rejected_rather_than_guessed():
    result = normalize_identifier("five five five two three")
    assert result["ok"] is False
    assert result["type"] == "partialPhone"


def test_unreadable_identifier_asks_for_a_repeat():
    result = normalize_identifier("umm I am not sure")
    assert result["ok"] is False
    assert result["normalizedIdentifier"] == ""


@pytest.mark.parametrize(
    "spoken,expected",
    [
        ("November twentieth nineteen eighty eight", "1988-11-20"),
        ("the twelfth of April nineteen seventy five", "1975-04-12"),
        ("twentieth of November nineteen eighty eight", "1988-11-20"),
        ("November 20th, 1988", "1988-11-20"),
        ("Nov 20 1988", "1988-11-20"),
        ("1988-11-20", "1988-11-20"),
        ("11/20/1988", "1988-11-20"),
        ("one nine eight eight one one two zero", "1988-11-20"),
        ("my date of birth is November 20 1988", "1988-11-20"),
    ],
)
def test_spoken_dates_normalize_to_iso(spoken, expected):
    assert normalize_date(spoken) == expected


@pytest.mark.parametrize(
    "transcribed,expected",
    [
        ("November 20 19 88", "1988-11-20"),
        ("november 20 19 88", "1988-11-20"),
        ("It is November 20 19 88", "1988-11-20"),
        ("April 12 19 75", "1975-04-12"),
        ("November twentieth 19 88", "1988-11-20"),
        ("March 3 20 05", "2005-03-03"),
    ],
)
def test_year_split_into_two_numbers_by_the_transcriber(transcribed, expected):
    """Regression from a live call: the caller said "November twentieth nineteen
    eighty-eight" and Deepgram returned "November 20 19 88". The split-numeric year
    parsed as unreadable, so verification looped and the caller could never
    authenticate even though they had answered correctly."""
    assert normalize_date(transcribed) == expected


def test_a_bare_two_number_pair_is_not_treated_as_a_year_on_its_own():
    # "nineteen 88" alone is too ambiguous to accept as a standalone date.
    assert normalize_date("nineteen 88") is None


def test_live_call_verification_succeeds_with_the_transcribed_date():
    """The exact end-to-end sequence from the failing call."""
    lookup = execute_tool(TENANT, "begin_tenant_lookup", {"identifier": "+1 (555) 234-5678"})
    assert lookup["status"] == "verification_required"

    verified = execute_tool(TENANT, "verify_tenant_record", {
        "identifier": "+1 (555) 234-5678",
        "verificationFactor": "November 20 19 88",
    })
    assert verified["authenticated"] is True
    assert verified["claims"][0]["claimId"] == "CLM-55412"


def test_unreadable_date_returns_none_instead_of_a_wrong_guess():
    assert normalize_date("sometime in the eighties") is None
    assert normalize_date("") is None


def test_identifier_candidates_bridge_spoken_input_and_stored_format():
    spoken = set(identifier_candidates("plus one triple five two three four five six seven eight"))
    stored = set(identifier_candidates("+15552345678"))
    assert spoken & stored


def test_format_us_phone_passes_through_unusable_lengths():
    assert format_us_phone("123") == "123"


class TestEndToEndToolChain:
    """The three-call sequence Vapi actually performs, driven by raw speech."""

    def test_phone_caller_authenticates(self):
        normalized = execute_tool(TENANT, "normalize_identifier", {
            "rawIdentifier": "plus one triple five two three four five six seven eight",
        })
        assert normalized["ok"] is True

        lookup = execute_tool(TENANT, "begin_tenant_lookup", {
            "identifier": normalized["normalizedIdentifier"],
        })
        assert lookup["status"] == "verification_required"
        assert lookup["customerId"] == "CUST-10042"

        verified = execute_tool(TENANT, "verify_tenant_record", {
            "identifier": normalized["normalizedIdentifier"],
            "verificationFactor": "November twentieth nineteen eighty eight",
        })
        assert verified["authenticated"] is True
        assert verified["claims"][0]["claimId"] == "CLM-55412"

    def test_customer_id_caller_authenticates(self):
        lookup = execute_tool(TENANT, "begin_tenant_lookup", {
            "identifier": "c u s t hyphen one zero zero eight eight",
        })
        assert lookup["customerId"] == "CUST-10088"

        verified = execute_tool(TENANT, "verify_tenant_record", {
            "identifier": "cust-10088",
            "verificationFactor": "April twelfth nineteen seventy five",
        })
        assert verified["authenticated"] is True
        assert verified["claims"][0]["status"] == "Approved"

    def test_verification_accepts_the_legacy_argument_aliases(self):
        """A model that emits verificationValue/dateOfBirth must not silently fail auth."""
        for key in ("verificationValue", "dateOfBirth", "dob"):
            result = execute_tool(TENANT, "verify_tenant_record", {
                "identifier": "+1 (555) 234-5678",
                key: "1988-11-20",
            })
            assert result["authenticated"] is True, key

    def test_wrong_date_of_birth_fails_authentication(self):
        result = execute_tool(TENANT, "verify_tenant_record", {
            "identifier": "+1 (555) 234-5678",
            "verificationFactor": "1990-01-01",
        })
        assert result["status"] == "auth_failure"
        assert result["authenticated"] is False

    def test_unknown_identifier_is_reported_as_not_found(self):
        result = execute_tool(TENANT, "begin_tenant_lookup", {"identifier": "+1 (555) 000-0000"})
        assert result["status"] == "not_found"

    def test_missing_verification_factor_is_an_explicit_contract_error(self):
        result = execute_tool(TENANT, "verify_tenant_record", {"identifier": "+1 (555) 234-5678"})
        assert result["status"] == "invalid_arguments"
        assert "verificationFactor" in result["message"]

    def test_unreadable_date_of_birth_asks_for_a_repeat(self):
        result = execute_tool(TENANT, "verify_tenant_record", {
            "identifier": "+1 (555) 234-5678",
            "verificationFactor": "sometime in the eighties",
        })
        assert result["status"] == "unreadable_verification"
        assert result["authenticated"] is False


def test_verify_matches_on_phone_not_only_customer_id():
    """Regression: verification used to match customerId candidates only, so any
    caller identified by phone fell through to not_found and could never authenticate."""
    repo = DatabaseRepository()
    result = repo.verify_record(TENANT, "+1 (555) 234-5678", "1988-11-20")
    assert result["status"] == "success"
    assert result["authenticated"] is True


def test_log_interaction_appends_to_the_existing_call_log_shape(tmp_path):
    """Regression: Python wrote a bare list into a file the Node side had written as
    {"calls": [...]}, so `.append` raised and a bare `except: pass` swallowed it."""
    import json

    from app.config import ROOT_DIR, settings

    call_log = tmp_path / "call-log.json"
    call_log.write_text(json.dumps({"calls": [{"callId": "CALL-EXISTING"}]}), encoding="utf-8")

    db_file = tmp_path / "database.json"
    db_file.write_text(json.dumps({"tenants": {}, "interactions": []}), encoding="utf-8")

    repo_under_test = DatabaseRepository(db_path=str(db_file))
    original = settings.paths.call_log
    try:
        settings.paths.call_log = str(call_log.relative_to(ROOT_DIR)) if call_log.is_relative_to(ROOT_DIR) else str(call_log)
        repo_under_test.log_interaction(TENANT, {
            "callerName": "Browser caller",
            "callSummary": "Checked claim status.",
            "sentiment": "neutral",
            "escalated": False,
            "timestamp": 0,
        })
    finally:
        settings.paths.call_log = original

    written = json.loads(call_log.read_text(encoding="utf-8"))
    assert isinstance(written, dict), "call log must stay a {'calls': [...]} object"
    assert len(written["calls"]) == 2, "the pre-existing entry must survive"
    assert written["calls"][0]["callId"] == "CALL-EXISTING"
    assert written["calls"][1]["callerName"] == "Browser caller"


class TestSchemaEchoArguments:
    """Regression from a live call: llama-3.3-70b sent the JSON-schema text as the
    argument value, so the caller's number never reached the backend and the resulting
    not_found made the agent ask them to repeat a number it had never sent."""

    def test_placeholder_identifier_is_not_reported_as_not_found(self):
        result = execute_tool(TENANT, "begin_tenant_lookup", {
            "identifier": "normalizedIdentifier returned by normalize_identifier",
        })
        assert result["status"] == "invalid_arguments"
        assert result["status"] != "not_found"
        assert "caller's own words" in result["message"]
        assert "Do not ask the caller to repeat" in result["message"]

    def test_placeholder_raw_identifier_is_rejected_distinctly(self):
        result = execute_tool(TENANT, "normalize_identifier", {
            "rawIdentifier": "phone number or account ID",
        })
        assert result["ok"] is False
        assert result["status"] == "invalid_arguments"

    def test_placeholder_verification_factor_is_rejected(self):
        result = execute_tool(TENANT, "verify_tenant_record", {
            "identifier": "+1 (555) 234-5678",
            "verificationFactor": "date of birth (YYYY-MM-DD)",
        })
        assert result["status"] == "invalid_arguments"
        assert result["authenticated"] is False

    def test_real_transcribed_values_still_pass_through(self):
        """The guard must not reject anything a caller could actually say."""
        for spoken in [
            "plus 1 triple 5 2 3 4 5 6 7 8",
            "plus 1 triple 5, 2 3 4 5 6 7 8",
            "+1 (555) 234-5678",
            "cust-10042",
            "c u s t hyphen one zero zero four two",
        ]:
            assert not looks_like_schema_echo(spoken), spoken

    def test_digit_transcription_of_a_spoken_phone_authenticates(self):
        """The exact strings Deepgram produced during the failing call."""
        normalized = execute_tool(TENANT, "normalize_identifier", {
            "rawIdentifier": "plus 1 triple 5 2 3 4 5 6 7 8",
        })
        assert normalized["normalizedIdentifier"] == "+1 (555) 234-5678"

        lookup = execute_tool(TENANT, "begin_tenant_lookup", {
            "identifier": normalized["normalizedIdentifier"],
        })
        assert lookup["status"] == "verification_required"

        verified = execute_tool(TENANT, "verify_tenant_record", {
            "identifier": normalized["normalizedIdentifier"],
            "verificationFactor": "November 20 19 88",
        })
        assert verified["authenticated"] is True
