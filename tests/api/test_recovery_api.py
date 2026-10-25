import pytest
from fastapi.testclient import TestClient
from terraready.main import create_app
from terraready.models import Approval
from terraready.storage import SiteStore


@pytest.fixture
def client(tmp_path, docket):
    path = tmp_path / "db"
    SiteStore(path).seed(docket)
    with TestClient(create_app(path)) as client:
        yield client


def test_recovery_read_and_evaluation_are_typed_and_do_not_mutate(client):
    before = client.get("/api/scenarios/post-rain").json()
    plan = client.get("/api/scenarios/post-rain/recovery")
    assert plan.status_code == 200
    body = plan.json()
    evaluated = client.post(
        "/api/scenarios/post-rain/recovery/evaluate",
        json={"candidate_ids": body["selected_candidate_ids"]},
    )
    assert evaluated.json() == body
    assert client.get("/api/scenarios/post-rain").json() == before
    assert body["approval"] is None
    assert body["disruption"]["affected_planned_hours"] == 4.5


def test_recovery_approval_is_durable_idempotent_and_never_completes_work(client):
    before = client.get("/api/scenarios/post-rain").json()
    plan = client.get("/api/scenarios/post-rain/recovery").json()
    payload = {"plan_id": plan["id"]}
    approved = client.post("/api/scenarios/post-rain/recovery/approvals", json=payload)
    assert approved.status_code == 200
    record = Approval.model_validate(approved.json())
    assert record.planner_version == "recovery-v1"
    assert (
        client.post("/api/scenarios/post-rain/recovery/approvals", json=payload).json()
        == approved.json()
    )
    assert client.get("/api/scenarios/post-rain/recovery").json()["approval"] == approved.json()
    assert client.get("/api/scenarios/post-rain").json() == before
    assert {item["role"] for item in approved.json()["updates"]} == {
        "Field lead",
        "Haul coordinator",
    }
    assert client.get("/api/scenarios/post-rain/plan").json()["approval"] is None


def test_custom_selection_is_bound_to_approval_and_legacy_plan_cannot_approve_it(client):
    base = "/api/scenarios/post-rain"
    full = client.get(base + "/recovery").json()
    chosen = full["selected_candidate_ids"][:1]
    custom = client.post(base + "/recovery/evaluate", json={"candidate_ids": chosen}).json()
    assert custom["id"] != full["id"]
    assert (
        client.post(
            base + "/recovery/approvals", json={"plan_id": custom["id"], "candidate_ids": chosen}
        ).status_code
        == 200
    )
    assert (
        client.post(
            base + "/recovery/approvals", json={"plan_id": full["id"], "candidate_ids": chosen}
        ).status_code
        == 409
    )
    assert client.post(base + "/approvals", json={"plan_id": full["id"]}).status_code == 409
    legacy = client.get(base + "/plan").json()
    assert (
        client.post(base + "/recovery/approvals", json={"plan_id": legacy["id"]}).status_code == 409
    )


def test_empty_and_expired_work_cannot_be_approved(client):
    base = "/api/scenarios/post-rain/recovery"
    empty = client.post(base + "/evaluate", json={"candidate_ids": []}).json()
    assert (
        client.post(
            base + "/approvals", json={"plan_id": empty["id"], "candidate_ids": []}
        ).status_code
        == 409
    )
    clock = "2026-10-24T12:00:00-07:00"
    expired = client.get(base, params={"as_of": clock}).json()
    assert expired["approval"] is None
    assert (
        client.post(
            base + "/approvals", json={"plan_id": expired["id"], "as_of": clock}
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "body",
    [
        {"candidate_ids": ["unknown"]},
        {"candidate_ids": ["../invalid"]},
        {"candidate_ids": [], "completed": True},
        {"as_of": "2026-10-24T07:00:00"},
        {"as_of": "2026-10-24T01:00:00Z"},
    ],
)
def test_invalid_recovery_input_is_rejected(client, body):
    assert client.post("/api/scenarios/post-rain/recovery/evaluate", json=body).status_code == 422
    assert (
        client.post(
            "/api/scenarios/post-rain/recovery/approvals", json={"plan_id": "0" * 64, **body}
        ).status_code
        == 422
    )


def test_unknown_scenario_and_legacy_docket_have_explicit_errors(client, tmp_path, snapshot):
    assert client.get("/api/scenarios/missing/recovery").status_code == 404
    assert (
        client.post(
            "/api/scenarios/missing/recovery/approvals", json={"plan_id": "0" * 64}
        ).status_code
        == 404
    )
    path = tmp_path / "legacy"
    SiteStore(path).seed(snapshot)
    with TestClient(create_app(path)) as legacy:
        assert legacy.get("/ready").status_code == 200
        result = legacy.get("/api/scenarios/post-rain/recovery")
        assert result.status_code == 422
        assert "make seed" in result.json()["detail"]
        assert legacy.get("/api/scenarios/post-rain/plan").status_code == 200


def test_snapshot_change_invalidates_reviewed_recovery_plan(tmp_path, docket):
    path = tmp_path / "db"
    store = SiteStore(path)
    store.seed(docket)
    with TestClient(create_app(path)) as client:
        proposal = client.get("/api/scenarios/post-rain/recovery").json()
        docket.tasks[0].prerequisite_ids = ["west-inspection"]
        store.seed(docket)
        assert (
            client.post(
                "/api/scenarios/post-rain/recovery/approvals", json={"plan_id": proposal["id"]}
            ).status_code
            == 409
        )
