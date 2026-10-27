"""Evaluation-harness contracts use synthetic HTTP bodies, never live model claims."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "evaluate_suggestions_test", ROOT / "scripts/evaluate_suggestions.py"
)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def golden():
    return {
        "id": "synthetic-case",
        "task_id": "east-haul",
        "suggestion": "SYNTHETIC COMMENT NOT FOR REPORTS",
        "expected": {
            "status": "interpreted",
            "intent": {"target_bank_m3": 16},
            "solver_verdicts": ["GO"],
        },
    }


def response(mode="local_model"):
    return {
        "task_id": "east-haul",
        "source_plan_id": "a" * 64,
        "planning_only": True,
        "interpretation": {
            "task_id": "east-haul",
            "status": "interpreted",
            "intent": {"target_bank_m3": 16},
            "mode": mode,
            "model_id": "synthetic-eval-model",
            "elapsed_ms": 123,
            "message": "NEVER RETAIN MODEL WORDING",
            "trace": [{"tool": "interpret_suggestion"}],
        },
        "solver": {
            "task_id": "east-haul",
            "source_plan_id": "a" * 64,
            "read_only": True,
            "solver_workers": 1,
            "verdict": "GO",
            "ground_status": "GO",
            "requested": {"status": "feasible", "solver_status": "OPTIMAL", "verified": True},
            "alternatives": [],
        },
    }


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "https://example.com",
        "http://localhost:8004/private",
        "http://user:secret@localhost:8004",
        "http://localhost:8004?secret=private",
        "http://localhost:8004#private",
    ],
)
def test_evaluator_refuses_original_services_and_unapproved_destinations(url):
    with pytest.raises(ValueError):
        evaluation.permitted_base(url)


def test_explicit_isolated_origin_and_approved_public_origin_are_allowed():
    assert evaluation.permitted_base("http://localhost:8004/") == "http://localhost:8004"
    assert evaluation.permitted_base("https://terraready-controller.terraready-itikku.workers.dev")


def test_real_model_evaluation_rejects_stub_and_incorrect_intent():
    assert evaluation.assess(golden(), response(), "local_model")[0]
    assert not evaluation.assess(golden(), response("test_stub"), "local_model")[0]
    assert evaluation.assess(golden(), response("test_stub"), "test_stub")[0]
    body = response()
    body["interpretation"]["intent"] = {"target_bank_m3": 32}
    assert not evaluation.assess(golden(), body, "local_model")[0]


@pytest.mark.parametrize("fault", ["ground", "unverified", "unknown", "wrong_item", "approval"])
def test_correct_intent_cannot_hide_a_broken_solver_gate(fault):
    body = response()
    if fault == "ground":
        body["solver"]["ground_status"] = "INSPECT"
    elif fault == "unverified":
        body["solver"]["requested"]["verified"] = False
    elif fault == "unknown":
        body["solver"]["requested"]["solver_status"] = "UNKNOWN"
    elif fault == "wrong_item":
        body["solver"]["task_id"] = "west-followup"
    elif fault == "approval":
        body["planning_only"] = False
    assert not evaluation.assess(golden(), body, "local_model")[0]


def test_clarification_must_not_include_a_solver_result():
    case = golden()
    case["expected"] = {"status": "clarification", "intent": None}
    body = response()
    body["interpretation"].update(status="clarification", intent=None)
    passed, actual = evaluation.assess(case, body, "local_model")
    assert not passed
    assert actual["solver"]["verdict"] == "GO"  # Retain failure severity, not just expected status.
    body["solver"] = None
    assert evaluation.assess(case, body, "local_model")[0]


def test_report_is_explicitly_protocol_only_without_raw_comment_or_model_prose(
    tmp_path, monkeypatch
):
    calls = []

    def request(opener, url, body=None):
        calls.append((url, body))
        if url.endswith("/recovery"):
            return {"id": "a" * 64, "selected_candidate_ids": ["c-example"]}
        return response("test_stub")

    monkeypatch.setattr(evaluation, "request_json", request)
    output = tmp_path / "protocol.json"
    report = evaluation.evaluate("http://localhost:8004", [golden()], output, protocol_only=True)
    assert report["kind"] == "protocol_stub_evaluation"
    assert report["completed"] and report["passed"] == report["total"] == 1
    assert len(calls) == 2
    assert calls[1][1]["source_plan_id"] == "a" * 64
    assert calls[1][1]["current_candidate_ids"] == ["c-example"]
    text = output.read_text()
    assert "SYNTHETIC COMMENT NOT FOR REPORTS" not in text
    assert "NEVER RETAIN MODEL WORDING" not in text
    with pytest.raises(FileExistsError):
        evaluation.evaluate("http://localhost:8004", [golden()], output, protocol_only=True)


def test_golden_dataset_has_balanced_contexts_and_full_intents():
    data = json.loads((ROOT / "data/evals/work-suggestions.json").read_text())
    cases = data["cases"]
    assert len(cases) >= 24 and len({case["id"] for case in cases}) == len(cases)
    assert {case["expected"]["status"] for case in cases} == {
        "interpreted",
        "clarification",
        "unsupported",
    }
    assert {"west-inspection", "west-followup", "east-batch-ready"} <= {
        case["task_id"] for case in cases
    }
    for case in cases:
        if case["expected"]["status"] == "interpreted":
            assert set(case["expected"]["intent"]) == {
                "target_bank_m3",
                "max_trucks",
                "max_overtime_minutes",
                "deadline_minutes",
                "keep_other_work",
            }
