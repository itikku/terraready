"""Real CPU solver checks over explicit source fixtures; no services or operating database."""

from datetime import timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError
from terraready.engine import InvalidEvaluation, UnknownEntity
from terraready.models import RecoveryRequest, Task
from terraready.recovery import build_recovery
from terraready.seed import load_docket, load_fixture
from terraready.solver import (
    StaleSuggestion,
    load_production_assumptions,
    solve_suggestion,
    suggestion_source,
    verify_schedule,
)
from terraready.solver_models import (
    ProductionAssumptions,
    SuggestionIntent,
    WorkSuggestionRequest,
)

ROOT = Path(__file__).resolve().parents[2]


def request(**changes):
    return WorkSuggestionRequest.model_validate(
        {"task_id": "east-haul", "suggestion": "Move 320 bank m3 with two trucks and no overtime."}
        | changes
    )


@pytest.fixture(scope="module")
def production_result():
    site = load_docket(
        load_fixture(ROOT / "data/fixtures/post-rain.json"),
        ROOT / "data/fixtures/shift-docket.json",
    )
    before = site.model_dump_json()
    result = solve_suggestion(site, request(), SuggestionIntent())
    assert site.model_dump_json() == before
    return result


def test_coupled_production_conflict_and_checked_alternatives(production_result):
    result = production_result
    assert result.verdict == "NO_GO" and result.ground_status == "GO"
    assert result.requested.status == "infeasible"
    assert result.requested.solver_status == "INFEASIBLE"
    assert any("Fleet cap: 2" in item for item in result.requested.conflicts)
    assert any("320 bank m3" in item for item in result.requested.conflicts)
    assert result.inputs.preparation_minutes == 180
    assert result.inputs.drainage_minutes == 120
    assert result.inputs.production.payload_loose_m3 == 20
    assert result.inputs.production.swell_factor == 1.25
    assert result.inputs.production.bank_m3_per_load == 16
    minimum_fleet, minimum_overtime, maximum_volume = result.alternatives
    assert minimum_fleet.fleet == 3
    assert minimum_fleet.additional_resources_required == 2
    assert minimum_overtime.fleet == 2
    assert minimum_overtime.finish_minutes == 492
    assert minimum_overtime.overtime_minutes == 12
    assert maximum_volume.delivered_bank_m3 == 288
    for case in result.alternatives:
        assert case.solver_status == "OPTIMAL"
        assert case.objective_value == case.objective_bound
        assert case.verified
        verify_schedule(result.inputs, result.task_id, case)
    assert result.read_only
    assert any("does not certify conditions" in text for text in result.assumptions)
    assert result.review_by.isoformat() == "2026-10-24T10:15:00-07:00"


def test_actual_haul_batch_has_no_invented_preparation_precedence(production_result):
    schedule = production_result.alternatives[1]
    preparation = next(a for a in schedule.schedule if a.kind == "preparation")
    assert schedule.trips[0].start_minutes < preparation.end_minutes
    assert sum(trip.bank_m3 for trip in schedule.trips) == 320


def test_feasible_witness_can_be_valid_without_claiming_optimality(production_result):
    case = production_result.alternatives[1].model_copy(deep=True)
    case.solver_status = "FEASIBLE"
    case.objective_bound = 490
    verify_schedule(production_result.inputs, production_result.task_id, case)
    assert case.solver_status == "FEASIBLE"
    assert case.objective_value == 492 and case.objective_bound == 490


def test_identical_solver_problem_and_complete_results_repeat(docket, production_result):
    again = solve_suggestion(docket, request(), SuggestionIntent())
    assert again == production_result
    assert again.id == production_result.id


@pytest.mark.parametrize(
    ("intent", "verdict"),
    [
        (SuggestionIntent(target_bank_m3=96), "GO"),
        (SuggestionIntent(max_trucks=3), "GO"),
        (SuggestionIntent(max_overtime_minutes=12), "GO"),
        (SuggestionIntent(max_overtime_minutes=11), "NO_GO"),
        (SuggestionIntent(keep_other_work=False), "GO"),
    ],
)
def test_materially_different_intents_change_real_problems(
    docket, production_result, intent, verdict
):
    result = solve_suggestion(docket, request(), intent)
    assert result.verdict == verdict
    assert result.id != production_result.id
    assert result.inputs != production_result.inputs
    if verdict == "GO":
        assert result.requested.verified
        verify_schedule(result.inputs, result.task_id, result.requested)
    if intent.keep_other_work is False:
        assert result.inputs.jobs == []
        assert not any(a.kind in {"preparation", "drainage"} for a in result.requested.schedule)


def test_current_draft_deferred_work_is_not_silently_reintroduced(docket):
    default = build_recovery(docket)
    ids = [
        c.id
        for c in default.candidates
        if c.id in default.selected_candidate_ids and c.task_id != "yard-drainage"
    ]
    draft = build_recovery(docket, RecoveryRequest(candidate_ids=ids))
    result = solve_suggestion(
        docket,
        request(source_plan_id=draft.id, current_candidate_ids=ids),
        SuggestionIntent(),
    )
    assert result.source_plan_id == draft.id
    assert "yard-drainage" not in result.inputs.retained_task_ids
    assert result.inputs.drainage_minutes == 0
    assert result.verdict == "GO"


def test_review_deadline_includes_every_retained_jobs_selected_route(docket):
    north = next(obs for obs in docket.observations if obs.id == "north-morning")
    north.observed_at -= timedelta(minutes=15)
    preparation = next(task for task in docket.tasks if task.id == "east-excavation")
    preparation.route_id = "south-to-east"
    default = build_recovery(docket)
    selected = [
        candidate.id
        for candidate in default.candidates
        if candidate.id in default.selected_candidate_ids and candidate.task_id != preparation.id
    ]
    selected.append(
        next(
            candidate.id
            for candidate in default.candidates
            if candidate.task_id == preparation.id
            and candidate.machine_id == preparation.assigned_machine_id
            and candidate.route_id == "north-to-east"
        )
    )
    draft = build_recovery(docket, RecoveryRequest(candidate_ids=selected))
    result = solve_suggestion(
        docket,
        request(source_plan_id=draft.id, current_candidate_ids=selected),
        SuggestionIntent(),
    )
    assert preparation.id in result.inputs.retained_task_ids
    assert result.review_by == north.observed_at + timedelta(hours=4)
    assert result.review_by.isoformat() == "2026-10-24T10:05:00-07:00"


def test_scoped_deadline_constrains_item_not_arbitrary_model_text(docket):
    result = solve_suggestion(
        docket,
        request(task_id="east-excavation"),
        SuggestionIntent(deadline_minutes=120),
    )
    assert result.verdict == "NO_GO"
    assert all(case.status == "infeasible" for case in result.alternatives)
    assert result.inputs.preparation_minutes == 180


@pytest.mark.parametrize("task_id", ["west-inspection", "west-followup"])
def test_ground_or_actual_prerequisite_hold_never_reaches_solver(docket, monkeypatch, task_id):
    def forbidden(*args):
        raise AssertionError("The solver must not run through an operational hold.")

    monkeypatch.setattr("terraready.solver._solve_case", forbidden)
    result = solve_suggestion(docket, request(task_id=task_id), SuggestionIntent())
    assert result.verdict == "INSPECT"
    assert result.requested.solver_status == "NOT_RUN"
    assert result.requested.status == "unknown"
    assert not result.requested.verified
    assert result.alternatives == []


def test_expired_evidence_and_closure_cannot_be_relaxed_by_overtime(docket):
    expired = solve_suggestion(
        docket,
        request(as_of=docket.scenario.as_of + timedelta(hours=5)),
        SuggestionIntent(max_trucks=3, max_overtime_minutes=120),
    )
    assert expired.verdict == "INSPECT"
    assert expired.requested.solver_status == "NOT_RUN"
    east = next(zone for zone in docket.zones if zone.id == "east-cut")
    east.closure_reason = "Site restriction"
    east.closed = True
    closed = solve_suggestion(docket, request(), SuggestionIntent(max_trucks=3))
    assert closed.verdict == "NO_GO" and closed.ground_status == "NO_GO"
    assert closed.requested.solver_status == "NOT_RUN"


def test_snapshot_clock_and_selection_are_bound_to_source(docket):
    plan = build_recovery(docket)
    assert suggestion_source(docket, request(source_plan_id=plan.id)).id == plan.id
    with pytest.raises(StaleSuggestion, match="changed"):
        suggestion_source(docket, request(source_plan_id="0" * 64))
    with pytest.raises(StaleSuggestion, match="changed"):
        suggestion_source(
            docket,
            request(source_plan_id=plan.id, current_candidate_ids=plan.selected_candidate_ids[:1]),
        )
    with pytest.raises(StaleSuggestion, match="changed"):
        suggestion_source(
            docket,
            request(source_plan_id=plan.id, as_of=docket.scenario.as_of + timedelta(minutes=1)),
        )


def test_unknown_task_and_invalid_precision_are_explicit(docket):
    with pytest.raises(UnknownEntity, match="Unknown suggestion"):
        solve_suggestion(docket, request(task_id="unknown"), SuggestionIntent())
    excavation = next(task for task in docket.tasks if task.id == "east-excavation")
    excavation.duration_hours = 3.333
    with pytest.raises(InvalidEvaluation, match="whole-minute"):
        solve_suggestion(docket, request(), SuggestionIntent())


def test_quantity_and_fleet_cannot_be_applied_to_unrelated_task(docket):
    with pytest.raises(InvalidEvaluation, match="only to the modeled haul"):
        solve_suggestion(
            docket, request(task_id="yard-drainage"), SuggestionIntent(target_bank_m3=200)
        )


@pytest.mark.parametrize(
    "body",
    [
        {"target_bank_m3": 321},
        {"target_bank_m3": 3.5},
        {"target_bank_m3": "320"},
        {"max_trucks": 4},
        {"max_trucks": True},
        {"max_overtime_minutes": -1},
        {"max_overtime_minutes": 121},
        {"deadline_minutes": 0},
        {"deadline_minutes": 601},
        {"deadline_minutes": float("inf")},
        {"keep_other_work": "false"},
        {"bearing_capacity_kpa": 900},
        {"code": "run arbitrary code"},
    ],
)
def test_interpreted_units_bounds_and_authority_are_validated(body):
    with pytest.raises(ValidationError):
        SuggestionIntent.model_validate(body)


@pytest.mark.parametrize(
    "updates", [{"swell_factor": 0}, {"swell_factor": float("nan")}, {"bank_m3_per_load": 20}]
)
def test_production_inputs_cannot_invent_units_or_nonfinite_conversion(updates):
    body = load_production_assumptions().model_dump()
    with pytest.raises(ValidationError):
        ProductionAssumptions.model_validate(body | updates)


def test_solver_timeout_is_unknown_not_a_no_go_or_fake_success(docket, monkeypatch):
    monkeypatch.setattr("terraready.solver.SOLVE_SECONDS", 0.0)
    result = solve_suggestion(docket, request(), SuggestionIntent())
    assert result.verdict == "UNKNOWN"
    assert all(case.status == "unknown" for case in [result.requested, *result.alternatives])
    assert not any(case.verified for case in [result.requested, *result.alternatives])
    assert all(not case.schedule for case in [result.requested, *result.alternatives])


def test_verifier_rejection_never_becomes_success(docket, monkeypatch):
    def reject(*args):
        raise ValueError("Rejected synthetic tamper")

    monkeypatch.setattr("terraready.solver.verify_schedule", reject)
    result = solve_suggestion(docket, request(), SuggestionIntent(keep_other_work=False))
    assert result.verdict == "UNKNOWN"
    assert all(case.status == "unknown" for case in [result.requested, *result.alternatives])
    assert not any(case.verified for case in [result.requested, *result.alternatives])


def test_retained_in_progress_work_is_not_preempted_even_when_other_work_is_deferred(docket):
    index = next(i for i, task in enumerate(docket.tasks) if task.id == "east-excavation")
    docket.tasks[index] = Task.model_validate(
        docket.tasks[index].model_dump()
        | {"state": "in_progress", "progress_fraction": 0.5, "estimated_remaining_hours": 2}
    )
    result = solve_suggestion(docket, request(), SuggestionIntent(keep_other_work=False))
    assert result.inputs.jobs[0].in_progress
    assert result.inputs.preparation_minutes == 120
    assert next(a for a in result.requested.schedule if a.kind == "preparation").start_minutes == 0


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_work",
        "overlap",
        "quantity",
        "cycle",
        "objective",
        "bound",
        "fleet",
        "finish",
        "window",
        "deadline",
    ],
)
def test_independent_verifier_rejects_tampered_solver_witness(production_result, mutation):
    inputs = production_result.inputs.model_copy(deep=True)
    case = production_result.alternatives[1].model_copy(deep=True)
    if mutation == "missing_work":
        case.schedule = [a for a in case.schedule if a.kind != "drainage"]
    elif mutation == "overlap":
        preparation = next(a for a in case.schedule if a.kind == "preparation")
        drainage = next(a for a in case.schedule if a.kind == "drainage")
        drainage.start_minutes = preparation.start_minutes
        drainage.end_minutes = preparation.start_minutes + inputs.drainage_minutes
        case.schedule.sort(key=lambda a: (a.start_minutes, a.id))
    elif mutation == "quantity":
        case.delivered_bank_m3 = 319
    elif mutation == "cycle":
        case.trips[0].dump_end_minutes += 1
    elif mutation == "objective":
        case.objective_value = 400
    elif mutation == "bound":
        case.objective_bound = 490
    elif mutation == "fleet":
        case.fleet = 3
    elif mutation == "finish":
        case.finish_minutes = 491
    elif mutation == "window":
        inputs.resource_minutes["tracked-excavator"] = 1
    else:
        inputs.deadline_minutes = 100
    with pytest.raises(ValueError):
        verify_schedule(inputs, production_result.task_id, case)
