from datetime import UTC, datetime, timedelta

import pytest
from terraready.engine import InvalidEvaluation
from terraready.models import RecoveryRequest, Task
from terraready.planner import build_plan
from terraready.recovery import build_recovery, make_recovery_approval
from terraready.storage import SiteStore


def change_task(site, task_id, **updates):
    index = next(i for i, task in enumerate(site.tasks) if task.id == task_id)
    site.tasks[index] = Task.model_validate(site.tasks[index].model_dump() | updates)


def candidate(plan, task_id, machine_id=None, route_id=None):
    return next(
        c
        for c in plan.candidates
        if c.task_id == task_id
        and (machine_id is None or c.machine_id == machine_id)
        and (route_id is None or c.route_id == route_id)
        and c.eligible
    )


def test_default_recovery_reroutes_and_redeploys_without_releasing_successor(docket):
    plan = build_recovery(docket)
    assert len(plan.items) == 7
    impact = plan.disruption
    assert set(impact.affected_original_task_ids) == {"east-haul", "west-inspection"}
    assert impact.affected_planned_hours == 4.5
    assert impact.rerouted_task_ids == ["east-haul"]
    assert set(impact.pulled_forward_task_ids) == {"yard-drainage", "yard-inspection"}
    assert impact.dependency_blocked_task_ids == ["west-followup"]
    assert set(impact.preserved_original_task_ids) == {"east-haul", "east-excavation"}
    assert len(plan.selected_candidate_ids) == 4
    items = {item.task_id: item for item in plan.items}
    assert items["east-batch-ready"].disposition == "completed"
    assert items["west-followup"].blocking_task_ids == ["west-inspection"]
    assert items["west-followup"].disposition == "held"
    assert items["east-excavation"].action == "retain"
    assert plan.review_by == datetime.fromisoformat("2026-10-24T10:15:00-07:00")
    assert any("not measured idle time" in text for text in plan.assumptions)
    for resource in plan.resources:
        assert resource.proposed_hours + resource.unallocated_hours == resource.available_hours


def test_dependency_gate_is_independent_of_ground_gate_and_completion_is_explicit(docket):
    change_task(docket, "west-followup", zone_id="service-yard", route_id="yard-loop")
    plan = build_recovery(docket)
    ground_ready = next(
        c for c in plan.candidates if c.task_id == "west-followup" and c.ground.status == "GO"
    )
    assert not ground_ready.eligible
    assert ground_ready.blocking_task_ids == ["west-inspection"]
    change_task(
        docket,
        "west-inspection",
        state="completed",
        progress_fraction=1,
        completed_at=docket.scenario.as_of,
        estimated_remaining_hours=0,
    )
    ready = candidate(build_recovery(docket), "west-followup")
    assert ready.blocking_task_ids == []


def test_completed_prerequisite_does_not_override_bad_ground(docket):
    change_task(
        docket,
        "west-inspection",
        state="completed",
        progress_fraction=1,
        completed_at=docket.scenario.as_of,
        estimated_remaining_hours=0,
    )
    plan = build_recovery(docket)
    successors = [c for c in plan.candidates if c.task_id == "west-followup"]
    assert all(not c.eligible for c in successors)
    assert all(c.blocking_task_ids == [] for c in successors)


def test_transitive_unfinished_prerequisites_are_reported(docket):
    change_task(docket, "yard-inspection", prerequisite_ids=["west-followup"])
    item = next(i for i in build_recovery(docket).items if i.task_id == "yard-inspection")
    assert item.blocking_task_ids == ["west-followup", "west-inspection"]


def test_resource_reassignment_checks_capability(docket):
    change_task(docket, "east-excavation", assigned_machine_id="loaded-hauler")
    plan = build_recovery(docket)
    assert plan.disruption.reassigned_task_ids == ["east-excavation"]
    selected = candidate(plan, "east-excavation", "tracked-excavator")
    assert selected.id in plan.selected_candidate_ids
    wrong = next(
        c
        for c in plan.candidates
        if c.task_id == "yard-drainage" and c.machine_id == "loaded-hauler"
    )
    assert not wrong.eligible
    with pytest.raises(InvalidEvaluation, match="ineligible"):
        build_recovery(docket, RecoveryRequest(candidate_ids=[wrong.id]))


def test_combined_capacity_is_checked_not_only_individual_fit(docket):
    next(m for m in docket.machines if m.id == "tracked-excavator").available_hours = 4
    plan = build_recovery(docket)
    excavation = candidate(plan, "east-excavation", "tracked-excavator")
    drainage = candidate(plan, "yard-drainage", "tracked-excavator")
    assert excavation.id in plan.selected_candidate_ids
    assert drainage.id not in plan.selected_candidate_ids
    with pytest.raises(InvalidEvaluation, match="capacity"):
        build_recovery(docket, RecoveryRequest(candidate_ids=[excavation.id, drainage.id]))
    assert (
        next(i for i in plan.items if i.task_id == "yard-drainage").reasons[0].code
        == "CAPACITY_RESERVED"
    )


def test_duplicate_or_unknown_candidates_and_double_assigned_work_are_rejected(docket):
    plan = build_recovery(docket)
    options = [c for c in plan.candidates if c.task_id == "east-excavation" and c.eligible]
    with pytest.raises(InvalidEvaluation, match="Duplicate"):
        build_recovery(docket, RecoveryRequest(candidate_ids=[options[0].id, options[0].id]))
    with pytest.raises(InvalidEvaluation, match="twice"):
        build_recovery(docket, RecoveryRequest(candidate_ids=[c.id for c in options]))
    with pytest.raises(InvalidEvaluation, match="unknown"):
        build_recovery(docket, RecoveryRequest(candidate_ids=["unknown"]))


def test_expiry_and_exhausted_capacity_hold_work(docket):
    expired = build_recovery(
        docket, RecoveryRequest(as_of=docket.scenario.as_of + timedelta(hours=5))
    )
    assert expired.selected_candidate_ids == []
    assert expired.review_by is None
    for machine in docket.machines:
        machine.available_hours = 0
    assert build_recovery(docket).selected_candidate_ids == []
    assert build_plan(docket).proposed_eligible_count == 0


def test_later_clock_reduces_budget_without_inventing_task_progress(docket):
    plan = build_recovery(
        docket, RecoveryRequest(as_of=docket.scenario.as_of + timedelta(minutes=30))
    )
    assert all(r.available_hours == 7.5 for r in plan.resources)
    assert next(t for t in docket.tasks if t.id == "east-haul").progress_fraction == 0


def test_in_progress_work_is_reserved_and_not_automatically_reassigned(docket):
    change_task(
        docket,
        "east-excavation",
        state="in_progress",
        progress_fraction=0.5,
        estimated_remaining_hours=2,
    )
    next(m for m in docket.machines if m.id == "tracked-excavator").available_hours = 3
    plan = build_recovery(docket)
    resource = next(r for r in plan.resources if r.machine_id == "tracked-excavator")
    assert resource.reserved_in_progress_hours == 2
    assert resource.proposed_hours == 2
    assert resource.unallocated_hours == 1
    assert candidate(plan, "east-excavation").required_hours == 2
    assert any(
        r.code == "IN_PROGRESS_LOCK"
        for c in plan.candidates
        if c.task_id == "east-excavation" and c.machine_id != "tracked-excavator"
        for r in c.reasons
    )
    east = next(z for z in docket.zones if z.id == "east-cut")
    east.closure_reason = "Demo workface closure"
    east.closed = True
    held = build_recovery(docket)
    resource = next(r for r in held.resources if r.machine_id == "tracked-excavator")
    assert resource.reserved_in_progress_hours == 2
    assert resource.unallocated_hours == 1
    assert next(i for i in held.items if i.task_id == "east-excavation").disposition == "held"
    assert build_plan(docket).proposed_eligible_count == 0


def test_selection_fingerprint_binds_policy_snapshot_and_exact_work(tmp_path, docket):
    original = build_recovery(docket)
    reverse = build_recovery(
        docket, RecoveryRequest(candidate_ids=original.selected_candidate_ids[::-1])
    )
    assert reverse.id == original.id
    empty = build_recovery(docket, RecoveryRequest(candidate_ids=[]))
    assert empty.id != original.id
    assert any(i.disposition == "deferred" for i in empty.items)
    assert build_plan(docket).id != original.id
    store = SiteStore(tmp_path / "db")
    store.seed(docket)
    assert build_recovery(store.load()).id == original.id
    docket.tasks[0].priority = 2
    assert build_recovery(docket).id != original.id


def test_legacy_snapshot_and_earlier_clock_are_rejected(snapshot, docket):
    with pytest.raises(InvalidEvaluation, match="v2 work docket"):
        build_recovery(snapshot)
    with pytest.raises(InvalidEvaluation, match="precede"):
        build_recovery(docket, RecoveryRequest(as_of=docket.scenario.as_of - timedelta(seconds=1)))


def test_legacy_plan_cannot_bypass_dependency_gate(docket):
    change_task(docket, "east-excavation", prerequisite_ids=["west-inspection"])
    item = next(i for i in build_plan(docket).items if i.task_id == "east-excavation")
    assert item.status == "INSPECT"
    assert item.selected_route_id is None
    assert item.blocking_task_ids == ["west-inspection"]


def test_briefs_persist_choices_and_holds_without_marking_any_task_completed(docket):
    before = docket.model_dump()
    plan = build_recovery(docket)
    record = make_recovery_approval(docket, plan, datetime.now(UTC))
    assert record.planner_version == "recovery-v1"
    assert sum(work.route_id is not None for work in record.work) == 4
    assert "west-inspection" not in [work.task_id for work in record.work if work.route_id]
    assert "does not complete" in record.updates[0].body
    assert "pull_forward" in record.updates[1].body
    assert docket.model_dump() == before


@pytest.mark.parametrize("hours", [0, 0.5, 2, 4, 8])
@pytest.mark.parametrize("elapsed", [0, 0.5, 5])
def test_feasibility_and_resource_invariants_across_capacity_and_clock(docket, hours, elapsed):
    for machine in docket.machines:
        machine.available_hours = hours
    plan = build_recovery(
        docket, RecoveryRequest(as_of=docket.scenario.as_of + timedelta(hours=elapsed))
    )
    selected = [c for c in plan.candidates if c.id in plan.selected_candidate_ids]
    assert len({c.task_id for c in selected}) == len(selected)
    for candidate in selected:
        assert candidate.eligible and candidate.ground.status == "GO"
        assert candidate.blocking_task_ids == []
        assert next(t for t in docket.tasks if t.id == candidate.task_id).state != "completed"
    for resource in plan.resources:
        assert resource.proposed_hours <= resource.available_hours
        assert resource.unallocated_hours >= 0
