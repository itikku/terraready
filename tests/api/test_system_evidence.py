import json

import pytest
from fastapi.testclient import TestClient
from terraready.main import create_app
from terraready.storage import SiteStore
from terraready.system_evidence import VerificationEvidence, load_evidence


def evidence():
    """Deliberately synthetic contract fixture, never a real measurement artifact."""
    return {
        "kind": "real_local_model_smoke",
        "recorded_at": "2026-10-24T23:00:00-07:00",
        "source_base_commit": "a" * 40,
        "working_tree_dirty": True,
        "source_sha256": {"test-fixture-only.py": "b" * 64},
        "dataset_sha256": "c" * 64,
        "model": {
            "model_id": "test-contract-only",
            "revision": "d" * 40,
            "weights_sha256": "e" * 64,
            "license": "Apache-2.0",
            "runtime_tag": "b1",
            "runtime_commit": "f" * 40,
        },
        "hardware": {
            "host": "TEST FIXTURE ONLY",
            "os": "test",
            "architecture": "test",
            "gpu_layers_requested": 0,
            "cpu_threads": 1,
            "context_size": 512,
        },
        "cases": [
            {
                "name": name,
                "passed": True,
                "mode": "local_model",
                "elapsed_ms": 1,
                "tools": [
                    "get_shift",
                    "get_evidence" if name == "blocked" else "evaluate_candidates",
                    "finish_analysis",
                ],
                "task_ids": ["test-task"],
                "evidence_ids": ["test-evidence"],
            }
            for name in ["reroute", "redeploy", "blocked"]
        ],
        "completed": True,
        "limitations": ["TEST FIXTURE ONLY, not measurements."],
    }


def test_validated_artifact_roundtrip(tmp_path):
    expected = VerificationEvidence.model_validate(evidence())
    (tmp_path / "local-agent.json").write_text(expected.model_dump_json())
    result = load_evidence(tmp_path)
    assert result.status == "recorded" and result.evidence == expected


@pytest.mark.parametrize(
    "fault",
    [
        "invalid_json",
        "oversized",
        "negative_time",
        "stub",
        "incomplete",
        "unknown_field",
        "duplicate_case",
        "missing_tool",
        "missing_evidence",
        "invalid_hash",
    ],
)
def test_untrusted_or_incomplete_artifacts_do_not_become_measurements(tmp_path, fault):
    body = evidence()
    if fault == "negative_time":
        body["cases"][0]["elapsed_ms"] = -1
    elif fault == "stub":
        body["cases"][0]["mode"] = "test_stub"
    elif fault == "incomplete":
        body["completed"] = False
    elif fault == "unknown_field":
        body["credential"] = "must not be exposed"
    elif fault == "duplicate_case":
        body["cases"][1]["name"] = "reroute"
    elif fault == "missing_tool":
        body["cases"][0]["tools"] = ["get_shift"]
    elif fault == "missing_evidence":
        body["cases"][0]["evidence_ids"] = []
    elif fault == "invalid_hash":
        body["model"]["weights_sha256"] = "bad"
    text = (
        "{"
        if fault == "invalid_json"
        else "x" * 262145
        if fault == "oversized"
        else json.dumps(body)
    )
    (tmp_path / "local-agent.json").write_text(text)
    result = load_evidence(tmp_path)
    assert result.status == "invalid" and result.evidence is None
    assert "credential" not in result.model_dump_json()


def test_missing_or_unreadable_is_not_measured(tmp_path, monkeypatch):
    assert load_evidence(tmp_path).status == "missing"
    (tmp_path / "local-agent.json").mkdir()
    assert load_evidence(tmp_path).status == "invalid"


class Probe:
    mode = "test_stub"
    model_id = "protocol-test-only"

    def __init__(self, reachable):
        self.reachable = reachable

    def available(self):
        return self.reachable

    def complete(self, *args):
        raise AssertionError("System page must never run inference")


@pytest.mark.parametrize("reachable", [True, False])
def test_system_keeps_historical_evidence_separate_from_current_reachability(
    tmp_path, docket, reachable
):
    db = tmp_path / "db"
    SiteStore(db).seed(docket)
    folder = tmp_path / "verification"
    folder.mkdir()
    (folder / "local-agent.json").write_text(json.dumps(evidence()))
    with TestClient(create_app(db, Probe(reachable), folder)) as client:
        result = client.get("/api/system")
        assert result.status_code == 200
        body = result.json()
        assert body["data_ready"]
        assert body["runtime"]["reachable"] == reachable
        assert body["runtime"]["mode"] == "test_stub"
        assert "not an inference" in body["runtime"]["meaning"]
        assert body["verification"]["status"] == "recorded"
        assert len(body["verification"]["evidence"]["cases"]) == 3


def test_system_is_available_when_site_data_and_reports_are_missing(tmp_path):
    with TestClient(create_app(tmp_path / "db", Probe(False), tmp_path)) as client:
        body = client.get("/api/system").json()
        assert body["data_ready"] is False
        assert body["verification"] == {"status": "missing", "evidence": None}
        assert body["runtime"]["reachable"] is False
