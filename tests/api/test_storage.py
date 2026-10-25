import json

import pytest
from terraready.seed import load_fixture, main
from terraready.storage import DataUnavailable, SiteStore


def test_fixture_is_loaded_and_validated(fixture_path):
    assert load_fixture(fixture_path).scenario.id == "post-rain"


def test_round_trip_preserves_typed_domain_records(tmp_path, snapshot):
    store = SiteStore(tmp_path / "lancedb")
    counts = store.seed(snapshot)
    assert counts == {
        "scenarios": 1,
        "zones": 5,
        "machines": 3,
        "routes": 3,
        "tasks": 3,
        "observations": 5,
    }
    assert store.load() == snapshot
    assert store.connection.open_table("observations").schema.field("observed_at").type.tz == "UTC"
    assert (
        store.connection.open_table("zones").schema.field("polygon").type.value_type.num_fields == 2
    )


def test_reseed_is_repeatable_without_duplicates(tmp_path, snapshot):
    store = SiteStore(tmp_path / "lancedb")
    store.seed(snapshot)
    store.seed(snapshot)
    assert store.load() == snapshot
    assert store.connection.open_table("observations").count_rows() == 5


def test_empty_observations_table_retains_schema_and_loads(tmp_path, snapshot):
    snapshot.observations = []
    store = SiteStore(tmp_path / "lancedb")
    store.seed(snapshot)
    assert store.load().observations == []
    assert store.connection.open_table("observations").schema.field("moisture_fraction")


def test_missing_database_is_explicit(tmp_path):
    with pytest.raises(DataUnavailable, match="seed"):
        SiteStore(tmp_path / "unseeded").load()


def test_partial_snapshot_is_unavailable(tmp_path, snapshot):
    store = SiteStore(tmp_path / "lancedb")
    store.seed(snapshot)
    store.connection.drop_table("machines")
    with pytest.raises(DataUnavailable):
        store.load()


def test_corrupt_reference_is_unavailable(tmp_path, snapshot):
    store = SiteStore(tmp_path / "lancedb")
    store.seed(snapshot)
    store.connection.open_table("machines").delete("id = 'loaded-hauler'")
    with pytest.raises(DataUnavailable):
        store.load()


def test_zero_scenarios_is_unavailable(tmp_path, snapshot):
    store = SiteStore(tmp_path / "lancedb")
    store.seed(snapshot)
    store.connection.open_table("scenarios").delete("id = 'post-rain'")
    with pytest.raises(DataUnavailable):
        store.load()


def test_seed_cli_outputs_counts(tmp_path, monkeypatch, capsys, fixture_path):
    monkeypatch.setattr(
        "sys.argv",
        ["terraready-seed", "--fixture", str(fixture_path), "--db", str(tmp_path / "lancedb")],
    )
    main()
    assert json.loads(capsys.readouterr().out)["records"]["zones"] == 5


def test_invalid_fixture_does_not_change_existing_database(tmp_path, snapshot, monkeypatch, capsys):
    store = SiteStore(tmp_path / "lancedb")
    store.seed(snapshot)
    monkeypatch.setattr(
        "sys.argv",
        [
            "terraready-seed",
            "--fixture",
            str(tmp_path / "missing"),
            "--db",
            str(tmp_path / "lancedb"),
        ],
    )
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 2
    assert "database unchanged" in capsys.readouterr().err
    assert store.load() == snapshot
