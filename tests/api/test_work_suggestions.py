from typing import Literal

import pytest
from fastapi.testclient import TestClient
from terraready import work_suggestions
from terraready.engine import InvalidEvaluation, UnknownEntity
from terraready.main import create_app
from terraready.models import RecoveryRequest
from terraready.recovery import build_recovery
from terraready.solver_models import (
    SuggestionIntent,
    SuggestionInterpretation,
    WorkSuggestionRequest,
    WorkSuggestionResponse,
)
from terraready.storage import SiteStore
from terraready.work_suggestions import StaleSuggestion, suggest_work


class NoInference:
    mode: Literal["test_stub"] = "test_stub"
    model_id = "suggestion-http-test-only"

    def available(self):
        return False

    def complete(self, messages, tools, timeout):
        raise AssertionError("No model or credential access expected in this test.")


def interpreted(task_id="east-haul", status="clarification", intent=None):
    return SuggestionInterpretation(
        status=status,
        task_id=task_id,
        intent=intent,
        message="Specify the planning assumption to test.",
        model_id="suggestion-http-test-only",
        mode="test_stub",
        elapsed_ms=0,
    )


def test_scoped_endpoint_returns_read_only_result_and_preserves_work(tmp_path, docket):
    path = tmp_path / "suggestions"
    SiteStore(path).seed(docket)
    seen = []

    def runner(site, body, model):
        seen.append(body)
        plan = build_recovery(site, RecoveryRequest())
        return WorkSuggestionResponse(
            task_id=body.task_id,
            source_plan_id=plan.id,
            interpretation=interpreted(body.task_id),
            solver=None,
        )

    with TestClient(create_app(path, NoInference(), suggestion_runner=runner)) as client:
        before = client.get("/api/scenarios/post-rain").json()
        result = client.post(
            "/api/scenarios/post-rain/suggestions",
            json={"task_id": "east-haul", "suggestion": "Can we use two trucks?"},
        )
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        assert result.json()["planning_only"] is True
        assert result.json()["interpretation"]["status"] == "clarification"
        assert "saved_locally" not in result.json()
        assert client.get("/api/scenarios/post-rain").json() == before
        assert client.get("/api/scenarios/post-rain/recovery").json()["approval"] is None
        assert seen[0].task_id == "east-haul"
        assert (
            client.post(
                "/api/scenarios/missing/suggestions",
                json={"task_id": "east-haul", "suggestion": "Use two trucks."},
            ).status_code
            == 404
        )
        assert len(seen) == 1


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (StaleSuggestion("Check again."), 409),
        (UnknownEntity("Unknown work."), 404),
        (InvalidEvaluation("Invalid clock."), 422),
        (ValueError("synthetic-private-value"), 503),
        (RuntimeError("synthetic-private-value"), 503),
    ],
)
def test_endpoint_error_boundaries_do_not_leak_internals(tmp_path, docket, error, status):
    path = tmp_path / "errors"
    SiteStore(path).seed(docket)

    def runner(site, body, model):
        raise error

    with TestClient(create_app(path, NoInference(), suggestion_runner=runner)) as client:
        result = client.post(
            "/api/scenarios/post-rain/suggestions",
            json={"task_id": "east-haul", "suggestion": "Use two trucks."},
        )
        assert result.status_code == status
        assert "synthetic-private-value" not in result.text


def test_request_body_bounds_and_unknown_fields_are_rejected(tmp_path, docket):
    path = tmp_path / "invalid"
    SiteStore(path).seed(docket)
    with TestClient(create_app(path, NoInference())) as client:
        for body in (
            {"task_id": "east-haul", "suggestion": "x" * 501},
            {"task_id": "east-haul", "suggestion": ""},
            {"task_id": "east-haul", "suggestion": "test", "replace_soil": 100},
            {"task_id": "UNKNOWN", "suggestion": "test"},
        ):
            assert client.post("/api/scenarios/post-rain/suggestions", json=body).status_code == 422


def test_stale_draft_and_unknown_work_fail_before_model(docket, monkeypatch):
    monkeypatch.setattr(
        work_suggestions,
        "interpret_suggestion",
        lambda *_: pytest.fail("Invalid context must not invoke the model."),
    )
    with pytest.raises(StaleSuggestion):
        suggest_work(
            docket,
            WorkSuggestionRequest(
                task_id="east-haul", suggestion="Two trucks.", source_plan_id="0" * 64
            ),
            NoInference(),
        )
    with pytest.raises(UnknownEntity):
        suggest_work(
            docket, WorkSuggestionRequest(task_id="missing", suggestion="test"), NoInference()
        )


def test_unsupported_intent_never_invokes_solver(docket, monkeypatch):
    monkeypatch.setattr(
        work_suggestions, "interpret_suggestion", lambda *_: interpreted(status="unsupported")
    )
    monkeypatch.setattr(
        work_suggestions, "solve_suggestion", lambda *_: pytest.fail("No solve expected.")
    )
    result = suggest_work(
        docket, WorkSuggestionRequest(task_id="east-haul", suggestion="Change soil."), NoInference()
    )
    assert result.solver is None
    assert result.interpretation.status == "unsupported"


def test_supported_intent_reaches_real_solver_without_mutating_snapshot(docket, monkeypatch):
    before = docket.model_dump_json()
    monkeypatch.setattr(
        work_suggestions,
        "interpret_suggestion",
        lambda *_: interpreted(
            status="interpreted", intent=SuggestionIntent(max_trucks=2, target_bank_m3=288)
        ),
    )
    plan = build_recovery(docket, RecoveryRequest())
    result = suggest_work(
        docket,
        WorkSuggestionRequest(
            task_id="east-haul",
            suggestion="Use two trucks for 288 bank cubic metres.",
            current_candidate_ids=plan.selected_candidate_ids,
            source_plan_id=plan.id,
        ),
        NoInference(),
    )
    assert result.solver is not None
    assert result.solver.inputs.target_bank_m3 == 288
    assert result.solver.inputs.max_trucks == 2
    assert result.solver.source_plan_id == plan.id
    assert docket.model_dump_json() == before
