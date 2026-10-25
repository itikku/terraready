from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from terraready.main import create_app
from terraready.models import Approval
from terraready.planner import build_plan, make_approval
from terraready.storage import ApprovalUnavailable, SiteStore


@pytest.fixture
def store(tmp_path, snapshot):
    store = SiteStore(tmp_path / "db")
    store.seed(snapshot)
    return store


def test_approval_is_typed_durable_idempotent_and_retained_on_reseed(tmp_path, snapshot):
    path = tmp_path / "db"
    store = SiteStore(path)
    store.seed(snapshot)
    assert store.approval("0" * 64) is None
    record = make_approval(snapshot, build_plan(snapshot), datetime.now(UTC))
    assert store.save_approval(record) == record
    duplicate = record.model_copy(update={"approved_at": record.approved_at + timedelta(minutes=5)})
    assert SiteStore(path).save_approval(duplicate) == record
    store.seed(snapshot)
    assert SiteStore(path).approval(record.plan_id) == record
    assert store.approval("0" * 64) is None
    table = store.connection.open_table("approvals")
    assert table.count_rows() == 1
    assert table.schema.field("work").type.value_type.num_fields == 5


def test_concurrent_local_approvals_create_one_record(store, snapshot):
    record = make_approval(snapshot, build_plan(snapshot), datetime.now(UTC))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(store.save_approval, [record, record]))
    assert results == [record, record]
    assert store.connection.open_table("approvals").count_rows() == 1


def test_plan_and_approval_api_survive_app_restart(tmp_path, snapshot):
    path = tmp_path / "db"
    SiteStore(path).seed(snapshot)
    with TestClient(create_app(path)) as client:
        proposal = client.get("/api/scenarios/post-rain/plan").json()
        assert proposal["approval"] is None
        result = client.post("/api/scenarios/post-rain/approvals", json={"plan_id": proposal["id"]})
        assert result.status_code == 200
        record = Approval.model_validate(result.json())
        assert record.plan_id == proposal["id"]
        again = client.post("/api/scenarios/post-rain/approvals", json={"plan_id": proposal["id"]})
        assert again.json() == result.json()
    with TestClient(create_app(path)) as client:
        assert client.get("/api/scenarios/post-rain/plan").json()["approval"] == result.json()
        expired = client.get(
            "/api/scenarios/post-rain/plan", params={"as_of": "2026-10-24T12:00:00-07:00"}
        ).json()
        assert expired["approval"] is None
        assert expired["proposed_eligible_count"] == 0


def test_stale_or_changed_proposals_and_all_held_cannot_be_approved(tmp_path, snapshot):
    path = tmp_path / "db"
    store = SiteStore(path)
    store.seed(snapshot)
    with TestClient(create_app(path)) as client:
        plan = client.get("/api/scenarios/post-rain/plan").json()
        assert (
            client.post(
                "/api/scenarios/post-rain/approvals", json={"plan_id": "0" * 64}
            ).status_code
            == 409
        )
        expired_clock = "2026-10-24T12:00:00-07:00"
        expired = client.get(
            "/api/scenarios/post-rain/plan", params={"as_of": expired_clock}
        ).json()
        assert (
            client.post(
                "/api/scenarios/post-rain/approvals",
                json={"plan_id": expired["id"], "as_of": expired_clock},
            ).status_code
            == 409
        )
        # Simulate an out-of-band fixture change, not an exposed mutation endpoint.
        snapshot.observations[0].note = "Evidence changed after review"
        store.seed(snapshot)
        assert (
            client.post(
                "/api/scenarios/post-rain/approvals", json={"plan_id": plan["id"]}
            ).status_code
            == 409
        )
        assert "approvals" not in store.connection.list_tables().tables


@pytest.mark.parametrize(
    "payload",
    [
        {"plan_id": "bad"},
        {"plan_id": "0" * 64, "as_of": "2026-10-24T07:00:00"},
        {"plan_id": "0" * 64, "as_of": "2026-10-24T01:00:00Z"},
        {"plan_id": "0" * 64, "approved_by": "Real user"},
        {"plan_id": "0" * 64, "work": []},
    ],
)
def test_approval_rejects_untrusted_input(tmp_path, snapshot, payload):
    path = tmp_path / "db"
    SiteStore(path).seed(snapshot)
    with TestClient(create_app(path)) as client:
        assert client.post("/api/scenarios/post-rain/approvals", json=payload).status_code == 422
        assert (
            client.get(
                "/api/scenarios/post-rain/plan", params={"as_of": "2026-10-24T01:00:00Z"}
            ).status_code
            == 422
        )
        assert client.get("/api/scenarios/missing/plan").status_code == 404
        assert client.post("/api/scenarios/missing/approvals", json=payload).status_code in (
            404,
            422,
        )


def test_persistence_failures_do_not_claim_success_or_leak_paths(tmp_path, snapshot, monkeypatch):
    path = tmp_path / "private-db"
    SiteStore(path).seed(snapshot)
    with TestClient(create_app(path)) as client:
        plan = client.get("/api/scenarios/post-rain/plan").json()

        def fail(*args):
            raise ApprovalUnavailable(str(path))

        monkeypatch.setattr(SiteStore, "save_approval", fail)
        response = client.post("/api/scenarios/post-rain/approvals", json={"plan_id": plan["id"]})
        assert response.status_code == 503
        assert str(path) not in response.text
        assert "nothing was dispatched" in response.json()["detail"]


def test_corrupt_approval_is_not_silently_treated_as_unapproved(store, snapshot):
    record = make_approval(snapshot, build_plan(snapshot), datetime.now(UTC))
    store.save_approval(record)
    store.connection.open_table("approvals").update(values={"approved_by": "invalid"})
    with pytest.raises(ApprovalUnavailable):
        store.approval(record.plan_id)
    with pytest.raises(ApprovalUnavailable):
        store.save_approval(record)
