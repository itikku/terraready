from datetime import timedelta

import pytest
from pydantic import ValidationError
from terraready.models import SiteSnapshot, Task
from terraready.seed import load_docket, main
from terraready.storage import SiteStore


def test_docket_is_explicit_and_round_trips_typed_records(tmp_path, docket):
    assert docket.scenario.schema_version == 2
    assert len(docket.tasks) == 7
    store = SiteStore(tmp_path / "db")
    assert store.seed(docket)["routes"] == 4
    assert store.load() == docket
    table = store.connection.open_table("tasks")
    assert table.schema.field("prerequisite_ids").type.value_type == table.schema.field("id").type
    assert table.schema.field("completed_at").type.tz == "UTC"
    assert next(t for t in docket.tasks if t.id == "east-batch-ready").remaining_hours == 0


@pytest.mark.parametrize(
    "updates",
    [
        {"prerequisite_ids": ["east-haul", "east-haul"]},
        {"progress_fraction": 0.5},
        {"completed_at": "2026-10-23T14:00:00Z"},
        {"estimated_remaining_hours": 0},
        {"state": "completed"},
        {
            "state": "completed",
            "progress_fraction": 1,
            "completed_at": "2026-10-23T14:00:00Z",
            "estimated_remaining_hours": 1,
        },
        {"state": "in_progress", "progress_fraction": 0.5},
        {"state": "in_progress", "progress_fraction": 1, "estimated_remaining_hours": 2},
        {"bucket": "prior"},
        {"estimated_remaining_hours": float("inf")},
    ],
)
def test_inconsistent_task_progress_is_rejected(docket, updates):
    with pytest.raises(ValidationError):
        Task.model_validate(docket.tasks[0].model_dump() | updates)


@pytest.mark.parametrize("case", ["unknown", "self", "cycle", "future-completion"])
def test_invalid_dependency_graph_or_completion_is_rejected(docket, case):
    data = docket.model_dump(mode="json")
    match case:
        case "unknown":
            data["tasks"][0]["prerequisite_ids"] = ["missing"]
        case "self":
            data["tasks"][0]["prerequisite_ids"] = ["east-haul"]
        case "cycle":
            data["tasks"][0]["prerequisite_ids"] = ["east-excavation"]
            data["tasks"][1]["prerequisite_ids"] = ["east-haul"]
        case "future-completion":
            data["tasks"][3]["completed_at"] = (
                docket.scenario.as_of + timedelta(minutes=1)
            ).isoformat()
    with pytest.raises(ValidationError):
        SiteSnapshot.model_validate(data)


def test_bad_docket_capacity_does_not_change_database(
    tmp_path, fixture_path, snapshot, monkeypatch
):
    from terraready.models import WorkDocket

    store = SiteStore(tmp_path / "db")
    store.seed(snapshot)
    invalid = WorkDocket(available_hours={"unknown-machine": 8}, tasks=snapshot.tasks)
    monkeypatch.setattr(WorkDocket, "model_validate_json", lambda *args: invalid)
    with pytest.raises(ValueError, match="every known machine"):
        load_docket(snapshot, fixture_path)
    assert store.load() == snapshot


def test_docket_seed_cli_is_repeatable(tmp_path, fixture_path, monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.argv",
        [
            "terraready-seed",
            "--fixture",
            str(fixture_path),
            "--docket",
            str(fixture_path.with_name("shift-docket.json")),
            "--db",
            str(tmp_path / "db"),
        ],
    )
    main()
    main()
    assert '"tasks": 7' in capsys.readouterr().out
    assert len(SiteStore(tmp_path / "db").load().tasks) == 7


def test_legacy_physical_tables_remain_readable_without_silent_upgrade(tmp_path, snapshot):
    store = SiteStore(tmp_path / "db")
    store.seed(snapshot)
    machine_table = store.connection.open_table("machines").to_arrow().drop(["available_hours"])
    task_table = (
        store.connection.open_table("tasks")
        .to_arrow()
        .drop(
            [
                "bucket",
                "state",
                "prerequisite_ids",
                "progress_fraction",
                "estimated_remaining_hours",
                "completed_at",
            ]
        )
    )
    store.connection.create_table("machines", machine_table, mode="overwrite")
    store.connection.create_table("tasks", task_table, mode="overwrite")
    assert store.load() == snapshot
    assert "available_hours" not in store.connection.open_table("machines").schema.names
