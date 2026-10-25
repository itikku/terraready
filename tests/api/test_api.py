import pytest
from fastapi.testclient import TestClient
from terraready.main import create_app
from terraready.models import Evaluation
from terraready.storage import SiteStore


@pytest.fixture
def client(tmp_path, snapshot):
    path = tmp_path / "lancedb"
    SiteStore(path).seed(snapshot)
    with TestClient(create_app(path)) as client:
        yield client


def body(**changes):
    return {
        "task_id": "east-haul",
        "machine_id": "loaded-hauler",
        "route_id": "south-to-east",
    } | changes


def test_liveness_and_readiness(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json() == {"status": "ready"}


def test_unseeded_api_helps_user_recover_without_leaking_paths(tmp_path):
    with TestClient(create_app(tmp_path / "private-location")) as client:
        assert client.get("/health").status_code == 200
        for url in ("/ready", "/api/scenarios", "/api/scenarios/post-rain"):
            result = client.get(url)
            assert result.status_code == 503
            assert "seed command" in result.json()["detail"]
            assert str(tmp_path) not in result.text


def test_scenario_round_trip_and_read_only_evaluation(client, snapshot):
    before = client.get("/api/scenarios/post-rain").json()
    assert client.get("/api/scenarios").json()[0]["id"] == "post-rain"
    assert len(before["observations"]) == 5
    result = client.post("/api/scenarios/post-rain/evaluate", json=body())
    assert result.status_code == 200
    decision = Evaluation.model_validate(result.json())
    assert decision.status == "GO"
    assert decision.confidence == 0.9
    assert decision.as_of == snapshot.scenario.as_of
    assert client.get("/api/scenarios/post-rain").json() == before


def test_blocked_route_response_is_explainable(client):
    response = client.post("/api/scenarios/post-rain/evaluate", json=body(route_id="north-to-east"))
    assert response.status_code == 200
    decision = Evaluation.model_validate(response.json())
    assert decision.status == "NO_GO"
    assert "north-morning" in decision.evidence_ids
    assert decision.mitigations and decision.requires_approval


def test_stale_clock_returns_inspection(client):
    response = client.post(
        "/api/scenarios/post-rain/evaluate", json=body(as_of="2026-10-24T12:00:00-07:00")
    )
    assert response.status_code == 200
    assert response.json()["status"] == "INSPECT"


def test_unknown_scenario(client):
    assert client.get("/api/scenarios/missing").status_code == 404
    assert client.post("/api/scenarios/missing/evaluate", json=body()).status_code == 404


def test_unknown_machine(client):
    response = client.post("/api/scenarios/post-rain/evaluate", json=body(machine_id="missing"))
    assert response.status_code == 404


@pytest.mark.parametrize(
    "changes",
    [
        {"route_id": "north-to-west"},
        {"as_of": "2026-10-24T01:00:00-07:00"},
        {"as_of": "2026-10-24T07:00:00"},
        {"machine_id": "' OR 1=1 --"},
        {"unexpected": "field"},
        {"route_id": None},
    ],
)
def test_invalid_evaluation_returns_validation_error(client, changes):
    response = client.post("/api/scenarios/post-rain/evaluate", json=body(**changes))
    assert response.status_code == 422


def test_api_exposes_typed_contract(client):
    schema = client.get("/openapi.json").json()
    operation = schema["paths"]["/api/scenarios/{scenario_id}/evaluate"]["post"]
    assert "Evaluation" in str(operation["responses"]["200"])
    assert set(schema["components"]["schemas"]["DecisionStatus"]["enum"]) == {
        "GO",
        "INSPECT",
        "NO_GO",
    }


def test_api_has_no_mutating_or_seed_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    for path, methods in paths.items():
        assert set(methods) <= ({"post"} if path.endswith("/evaluate") else {"get"})
