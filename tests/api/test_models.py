import pytest
from pydantic import ValidationError
from terraready.models import EvaluationRequest, SiteSnapshot


@pytest.mark.parametrize(
    "changes",
    [
        {"machine_id": "' OR 1=1 --"},
        {"task_id": "../arbitrary-file"},
        {"route_id": "north", "unexpected": True},
        {"as_of": "2026-10-24T07:00:00"},
    ],
)
def test_invalid_requests_fail_at_boundary(changes):
    with pytest.raises(ValidationError):
        EvaluationRequest.model_validate(
            {"task_id": "east-haul", "machine_id": "loaded-hauler", "route_id": "south-to-east"}
            | changes
        )


@pytest.mark.parametrize(
    "case",
    [
        "duplicate",
        "unknown-route-zone",
        "unknown-task-zone",
        "unknown-task-machine",
        "unreachable-task",
        "unknown-observation-zone",
        "moisture-range",
        "nan",
        "negative-load",
        "naive-time",
        "unsupported-version",
        "closure-without-reason",
        "future-rain",
        "nonsynthetic",
    ],
)
def test_fixture_rejects_invalid_data(snapshot, case):
    data = snapshot.model_dump(mode="json")
    match case:
        case "duplicate":
            data["zones"].append(data["zones"][0])
        case "unknown-route-zone":
            data["routes"][0]["zone_ids"].append("missing")
        case "unknown-task-zone":
            data["tasks"][0]["zone_id"] = "missing"
        case "unknown-task-machine":
            data["tasks"][0]["assigned_machine_id"] = "missing"
        case "unreachable-task":
            data["tasks"][0]["route_id"] = "north-to-west"
        case "unknown-observation-zone":
            data["observations"][0]["zone_id"] = "missing"
        case "moisture-range":
            data["observations"][0]["moisture_fraction"] = 1.5
        case "nan":
            data["observations"][0]["moisture_fraction"] = float("nan")
        case "negative-load":
            data["machines"][0]["operating_mass_t"] = -3
        case "naive-time":
            data["scenario"]["as_of"] = "2026-10-24T07:00:00"
        case "unsupported-version":
            data["scenario"]["schema_version"] = 2
        case "closure-without-reason":
            data["zones"][0]["closed"] = True
        case "future-rain":
            data["scenario"]["rain_ended_at"] = "2026-10-25T07:00:00Z"
        case "nonsynthetic":
            data["observations"][0]["synthetic"] = False
    with pytest.raises(ValidationError):
        SiteSnapshot.model_validate(data)
