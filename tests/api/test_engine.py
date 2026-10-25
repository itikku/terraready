from datetime import timedelta

import pytest
from terraready.engine import InvalidEvaluation, UnknownEntity, evaluate, evaluate_zone
from terraready.models import (
    DecisionStatus,
    EvaluationRequest,
    GroundAccess,
    SiteSnapshot,
)


def request(**updates: object) -> EvaluationRequest:
    return EvaluationRequest.model_validate(
        {"task_id": "east-haul", "machine_id": "loaded-hauler", "route_id": "south-to-east"}
        | updates
    )


@pytest.mark.parametrize(
    ("task", "machine", "route", "expected"),
    [
        ("east-haul", "loaded-hauler", "north-to-east", DecisionStatus.NO_GO),
        ("east-haul", "loaded-hauler", "south-to-east", DecisionStatus.GO),
        ("east-excavation", "tracked-excavator", "north-to-east", DecisionStatus.GO),
        ("west-inspection", "utility-rover", "north-to-west", DecisionStatus.INSPECT),
    ],
)
def test_seed_business_outcomes(snapshot, task, machine, route, expected):
    result = evaluate(snapshot, request(task_id=task, machine_id=machine, route_id=route))
    assert result.status == expected
    assert result.as_of == snapshot.scenario.as_of
    assert result.requires_approval is True
    assert result.synthetic is True
    assert result.policy_version == "demo-v1"
    assert result.reasons and result.mitigations
    assert set(result.evidence_ids) <= {o.id for o in snapshot.observations}


def test_route_failure_does_not_hide_green_destination(snapshot):
    result = evaluate(snapshot, request(route_id="north-to-east"))
    by_zone = {d.zone_id: d.status for d in result.zone_decisions}
    assert by_zone["east-cut"] == DecisionStatus.GO
    assert by_zone["north-access"] == DecisionStatus.NO_GO
    assert result.status == DecisionStatus.NO_GO
    assert {"MOISTURE_LIMIT", "BEARING_LIMIT"} <= {r.code for r in result.reasons}
    assert any("65 kPa" in r.message and "85 kPa" in r.message for r in result.reasons)
    assert not any("approve the work plan" in m for m in result.mitigations)


def test_repeated_evaluation_is_identical_and_does_not_mutate(snapshot):
    before = snapshot.model_dump_json()
    assert evaluate(snapshot, request()) == evaluate(snapshot, request())
    assert snapshot.model_dump_json() == before


def test_evidence_expires_with_explicit_clock(snapshot):
    result = evaluate(snapshot, request(as_of=snapshot.scenario.as_of + timedelta(hours=5)))
    assert result.status == DecisionStatus.INSPECT
    assert result.confidence is None
    assert {r.code for r in result.reasons} == {"EVIDENCE_REQUIRED"}


@pytest.mark.parametrize("field", ["task_id", "machine_id", "route_id"])
def test_unknown_entity_is_explicit(snapshot, field):
    with pytest.raises(UnknownEntity, match="Unknown"):
        evaluate(snapshot, request(**{field: "nonexistent"}))


def test_route_must_reach_destination(snapshot):
    with pytest.raises(InvalidEvaluation, match="does not reach"):
        evaluate(snapshot, request(route_id="north-to-west"))


def test_time_cannot_precede_snapshot(snapshot):
    with pytest.raises(InvalidEvaluation, match="cannot precede"):
        evaluate(snapshot, request(as_of=snapshot.scenario.as_of - timedelta(hours=1)))


def test_machine_must_support_operation(snapshot):
    result = evaluate(snapshot, request(machine_id="utility-rover"))
    assert result.status == DecisionStatus.NO_GO
    assert "UNSUPPORTED_OPERATION" in {r.code for r in result.reasons}


def zone_evaluation(snapshot: SiteSnapshot):
    return evaluate_zone(
        snapshot.zones[3],
        snapshot.machines[1],
        snapshot.observations,
        snapshot.scenario,
        snapshot.scenario.as_of,
    )


@pytest.mark.parametrize(
    "updates",
    [
        {"confidence": 0.79},
        {"observed_at": "2026-10-24T08:00:00-07:00"},
        {"observed_at": "2026-10-24T03:59:00-07:00"},
    ],
)
def test_untrusted_future_or_pre_rain_evidence_never_releases_work(snapshot, updates):
    original = snapshot.observations[3].model_dump(mode="json")
    snapshot.observations[3] = type(snapshot.observations[3]).model_validate(original | updates)
    result = zone_evaluation(snapshot)
    assert result.status == DecisionStatus.INSPECT
    assert result.confidence is None
    if "observed_at" in updates and "08:00" in updates["observed_at"]:
        assert result.evidence_ids == []


def test_no_observations_never_releases_work(snapshot):
    snapshot.observations = []
    assert zone_evaluation(snapshot).status == DecisionStatus.INSPECT


@pytest.mark.parametrize("field", ["moisture_fraction", "bearing_capacity_kpa"])
def test_missing_required_measurement_requires_inspection(snapshot, field):
    setattr(snapshot.observations[3], field, None)
    assert zone_evaluation(snapshot).status == DecisionStatus.INSPECT


def test_unknown_access_requires_inspection(snapshot):
    snapshot.observations[3].access = GroundAccess.UNKNOWN
    assert zone_evaluation(snapshot).status == DecisionStatus.INSPECT


def test_closed_access_blocks_machine(snapshot):
    snapshot.observations[3].access = GroundAccess.CLOSED
    result = zone_evaluation(snapshot)
    assert result.status == DecisionStatus.NO_GO
    assert result.reasons[0].code == "ACCESS_CLOSED"


@pytest.mark.parametrize("field,value", [("moisture_fraction", 0.65), ("bearing_capacity_kpa", 85)])
def test_limit_equality_is_conservative(snapshot, field, value):
    setattr(snapshot.observations[3], field, value)
    assert zone_evaluation(snapshot).status == DecisionStatus.NO_GO


def test_near_moisture_limit_is_marginal(snapshot):
    snapshot.observations[3].moisture_fraction = 0.62
    assert zone_evaluation(snapshot).status == DecisionStatus.INSPECT


@pytest.mark.parametrize("missing_evidence", [False, True])
def test_site_closure_cannot_be_overridden_by_good_or_missing_evidence(snapshot, missing_evidence):
    snapshot.zones[3].closure_reason = "Supervisor restriction"
    snapshot.zones[3].closed = True
    if missing_evidence:
        snapshot.observations = []
    result = zone_evaluation(snapshot)
    assert result.status == DecisionStatus.NO_GO
    assert "ZONE_CLOSED" in {r.code for r in result.reasons}


def test_slope_at_limit_blocks_machine(snapshot):
    snapshot.zones[3].slope_deg = snapshot.machines[1].max_slope_deg
    result = zone_evaluation(snapshot)
    assert result.status == DecisionStatus.NO_GO
    assert "SLOPE_LIMIT" in {r.code for r in result.reasons}


def test_contradictory_current_observations_require_reconciliation(snapshot):
    conflicting = snapshot.observations[3].model_copy(
        update={"id": "east-conflicting", "moisture_fraction": 0.9}
    )
    snapshot.observations.append(conflicting)
    result = zone_evaluation(snapshot)
    assert result.status == DecisionStatus.INSPECT
    assert result.reasons[0].code == "CONFLICTING_EVIDENCE"
    assert set(result.reasons[0].evidence_ids) == {"east-morning", "east-conflicting"}


def test_multiple_agreeing_observations_use_minimum_source_confidence(snapshot):
    snapshot.observations.append(
        snapshot.observations[3].model_copy(update={"id": "east-second", "confidence": 0.83})
    )
    result = zone_evaluation(snapshot)
    assert result.status == DecisionStatus.GO
    assert result.confidence == 0.83


def test_conflicting_evidence_cannot_remove_site_closure(snapshot):
    snapshot.zones[3].closure_reason = "Supervisor restriction"
    snapshot.zones[3].closed = True
    snapshot.observations.append(
        snapshot.observations[3].model_copy(
            update={"id": "east-conflicting", "moisture_fraction": 0.9}
        )
    )
    assert zone_evaluation(snapshot).status == DecisionStatus.NO_GO
