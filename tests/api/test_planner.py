from datetime import UTC, datetime, timedelta

import pytest
from terraready.engine import InvalidEvaluation
from terraready.models import DecisionStatus
from terraready.planner import build_plan, make_approval
from terraready.storage import SiteStore


def test_proposal_preserves_priority_work_and_never_selects_a_held_route(snapshot):
    plan = build_plan(snapshot)
    work = {item.task_id: item for item in plan.items}
    assert plan.baseline_eligible_count == 1
    assert plan.proposed_eligible_count == 2
    assert work["east-haul"].baseline.status == "NO_GO"
    assert work["east-haul"].selected_route_id == "south-to-east"
    assert work["west-inspection"].status == "INSPECT"
    assert work["west-inspection"].selected_route_id is None
    assert [item.task_id for item in plan.items][-1] == "west-inspection"
    for item in plan.items:
        if item.selected_route_id:
            result = next(r for r in item.alternatives if r.route_id == item.selected_route_id)
            assert result.status == DecisionStatus.GO
    assert plan.review_by == datetime.fromisoformat("2026-10-24T10:15:00-07:00")
    assert any("not guaranteed" in text for text in plan.assumptions)


def test_expired_evidence_holds_every_task(snapshot):
    plan = build_plan(snapshot, snapshot.scenario.as_of + timedelta(hours=5))
    assert plan.proposed_eligible_count == 0
    assert plan.review_by is None
    assert all(item.status == "INSPECT" and item.selected_route_id is None for item in plan.items)


def test_closed_routes_are_never_proposed(snapshot):
    snapshot.zones[0].closure_reason = "Demo closure"
    snapshot.zones[0].closed = True
    plan = build_plan(snapshot)
    assert all(item.status == "NO_GO" and item.selected_route_id is None for item in plan.items)


def test_unsupported_operation_stays_held(snapshot):
    snapshot.tasks[0].assigned_machine_id = "utility-rover"
    item = next(item for item in build_plan(snapshot).items if item.task_id == "east-haul")
    assert item.status == "NO_GO"
    assert item.selected_route_id is None


def test_shortest_eligible_route_then_stable_id_breaks_ties(snapshot):
    # The excavator can use both east routes; make the south route shorter.
    south = next(r for r in snapshot.routes if r.id == "south-to-east")
    south.distance_m = 1
    plan = build_plan(snapshot)
    assert (
        next(i for i in plan.items if i.task_id == "east-excavation").selected_route_id == south.id
    )
    copy = south.model_copy(deep=True, update={"id": "alternate-to-east"})
    snapshot.routes.append(copy)
    assert all(
        item.selected_route_id == "alternate-to-east"
        for item in build_plan(snapshot).items
        if item.task_id.startswith("east-")
    )


def test_fingerprint_is_repeatable_and_timezone_normalized(tmp_path, snapshot):
    store = SiteStore(tmp_path / "db")
    store.seed(snapshot)
    assert build_plan(snapshot).id == build_plan(store.load()).id
    assert (
        build_plan(snapshot).id == build_plan(snapshot, snapshot.scenario.as_of.astimezone(UTC)).id
    )


def test_fingerprint_changes_with_evidence_or_clock(snapshot):
    original = build_plan(snapshot).id
    assert build_plan(snapshot, snapshot.scenario.as_of + timedelta(minutes=1)).id != original
    snapshot.observations[0].note = "A revised observation"
    assert build_plan(snapshot).id != original


def test_earlier_clock_is_rejected(snapshot):
    with pytest.raises(InvalidEvaluation):
        build_plan(snapshot, snapshot.scenario.as_of - timedelta(seconds=1))


def test_briefs_keep_holds_and_machine_specific_limits_explicit(snapshot):
    plan = build_plan(snapshot)
    approval = make_approval(snapshot, plan, datetime.now(UTC))
    field, haul = approval.updates
    assert field.role == "Field lead"
    assert "verified safe access only" in field.body
    assert "North access" in field.body
    assert "West stockpile" in field.body
    assert "HOLD" in field.body
    assert "10:15 PDT" in haul.body
    assert "South access" in haul.body
    assert "NO_GO for this machine" in haul.body
    assert "not a real-world safety clearance" in haul.body
    assert approval.work[-1].route_id is None


def test_briefs_without_holds_or_flagged_zones(snapshot):
    for obs in snapshot.observations:
        obs.observed_at = snapshot.scenario.as_of
        obs.moisture_fraction = 0.3
        obs.bearing_capacity_kpa = 250
    plan = build_plan(snapshot)
    approval = make_approval(snapshot, plan, datetime.now(UTC))
    assert "none flagged" in approval.updates[0].body
    assert "No tasks currently held" in approval.updates[1].body
