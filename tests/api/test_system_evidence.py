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
        assert body["gpu_verification"] == {"status": "missing", "evidence": None}


def gpu_evidence():
    """Synthetic GPU contract data; never promoted as measured evidence."""
    body = evidence()
    body["gpu_test"] = {
        "provider": "Runpod",
        "gpu_name": "TEST GPU ONLY",
        "gpu_count": 1,
        "gpu_vram_mib": 1000,
        "driver_version": "test",
        "region": "TEST",
        "container_image_sha256": "f" * 64,
        "container_memory_limit_bytes": 1000000,
        "allocated_vcpu": 2,
        "cpu_quota_cores": 1.5,
        "sampled_peak_gpu_mib": 100,
        "sampled_peak_container_memory_bytes": 1000,
        "sampled_services_rss_kib": 10,
        "resource_sample_count": 10,
        "sample_interval_seconds": 1,
        "stack_ready_seconds": 1,
        "first_request_ms": 1,
        "warm_request_ms": [1, 2, 3, 4],
        "warm_passed": 4,
        "warm_p50_ms": 2,
        "warm_p95_ms": 4,
        "browser_journey_passed": True,
        "model_outage_passed": True,
        "evidence_expiry_passed": True,
        "restart_probe_passed": True,
        "operating_snapshot_unchanged": True,
        "cleanup_verified": True,
        "started_at": "2026-10-25T14:00:00Z",
        "terminated_at": "2026-10-25T14:01:00Z",
        "billing_status": "pending",
    }
    return body


def test_native_and_gpu_artifacts_remain_independent(tmp_path, docket):
    (tmp_path / "local-agent.json").write_text(json.dumps(evidence()))
    (tmp_path / "gpu-agent.json").write_text(json.dumps(gpu_evidence()))
    assert load_evidence(tmp_path).evidence.gpu_test is None
    assert load_evidence(tmp_path, gpu=True).evidence.gpu_test.billing_status == "pending"
    db = tmp_path / "db"
    SiteStore(db).seed(docket)
    with TestClient(create_app(db, Probe(False), tmp_path)) as client:
        body = client.get("/api/system").json()
    assert body["verification"]["evidence"]["gpu_test"] is None
    assert body["gpu_verification"]["evidence"]["gpu_test"]["warm_request_ms"] == [1, 2, 3, 4]
    assert body["runtime"]["reachable"] is False


@pytest.mark.parametrize(
    "fault",
    [
        "native_only",
        "latency",
        "percentile",
        "count",
        "memory",
        "time",
        "pending_cost",
        "missing_cost",
    ],
)
def test_inconsistent_gpu_measurements_are_not_published(tmp_path, fault):
    body = gpu_evidence()
    gpu = body["gpu_test"]
    if fault == "native_only":
        body.pop("gpu_test")
    elif fault == "latency":
        gpu["warm_request_ms"][0] = -1
    elif fault == "percentile":
        gpu["warm_p95_ms"] = 2
    elif fault == "count":
        gpu["warm_passed"] = 5
    elif fault == "memory":
        gpu["sampled_peak_gpu_mib"] = 1001
    elif fault == "time":
        gpu["terminated_at"] = "2026-10-24T00:00:00Z"
    elif fault == "pending_cost":
        gpu["provider_charge_usd"] = 0
    else:
        gpu["billing_status"] = "recorded"
    (tmp_path / "gpu-agent.json").write_text(json.dumps(body))
    assert load_evidence(tmp_path, gpu=True).status == "invalid"


def test_recorded_provider_charge_is_distinct_from_pending(tmp_path):
    body = gpu_evidence()
    body["gpu_test"].update(billing_status="recorded", provider_charge_usd=0.1234)
    (tmp_path / "gpu-agent.json").write_text(json.dumps(body))
    assert load_evidence(tmp_path, gpu=True).evidence.gpu_test.provider_charge_usd == 0.1234
