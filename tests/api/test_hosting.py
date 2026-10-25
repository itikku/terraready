"""Synthetic gateway/protocol tests; no account, credential or model access."""

import asyncio
import hashlib
import hmac
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from time import monotonic, sleep
from typing import Literal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from terraready.assist_queue import AssistQueue, QueueUnavailable
from terraready.hosting import HostedOrigin
from terraready.model_client import InferenceFailure
from terraready.storage import SiteStore

SECRET = "ab" * 32  # Public synthetic test value, never a deployment credential.
ALICE = "a" * 64
BOB = "b" * 64
NOW = 1792944000
BASE = "/api/scenarios/post-rain"


class UnavailableModel:
    mode: Literal["test_stub"] = "test_stub"
    model_id = "hosting-protocol-test-only"

    def available(self):
        return False

    def complete(self, messages, tools, timeout):
        raise InferenceFailure("unavailable")


def signed(method, target, visitor=ALICE, body=b"", stamp=NOW, nonce=None):
    nonce = nonce or uuid4().hex
    canonical = "\n".join(
        [
            "terraready-origin-v1",
            str(stamp),
            nonce,
            visitor,
            method,
            target,
            hashlib.sha256(body).hexdigest(),
        ]
    )
    return {
        "x-tr-visitor": visitor,
        "x-tr-time": str(stamp),
        "x-tr-nonce": nonce,
        "x-tr-signature": hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest(),
        "content-type": "application/json",
    }


def request(client, method, target, visitor=ALICE, payload=None, **kwargs):
    body = json.dumps(payload).encode() if payload is not None else b""
    return client.request(
        method,
        target,
        content=body,
        headers=signed(method, target, visitor, body, **kwargs),
    )


@pytest.fixture
def origin(tmp_path, docket):
    return HostedOrigin(tmp_path / "hosted", SECRET, docket, UnavailableModel(), clock=lambda: NOW)


@pytest.mark.parametrize("target", ["/health", "/ready", "/api/system", BASE, "/docs"])
def test_direct_origin_is_closed_without_creating_a_workspace(origin, target):
    with TestClient(origin) as client:
        result = client.get(
            target, headers={"cf-access-authenticated-user-email": "spoof@example.org"}
        )
    assert result.status_code == 401
    assert result.headers["cache-control"] == "no-store"
    assert not (origin.root / ALICE).exists()


def frontend(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html><h1>Synthetic hosted workspace</h1></html>")
    for name in ("assets", "imagery", "licenses"):
        (web / name).mkdir()
    (web / "assets/app.js").write_text("console.log('public build fixture');")
    (web / "imagery/site.jpg").write_bytes(b"synthetic-public-image")
    (web / ".env.local").write_text("synthetic-forbidden-fixture")
    return web


def test_frontend_requires_the_same_gateway_auth_and_does_not_expose_source(tmp_path, docket):
    origin = HostedOrigin(
        tmp_path / "hosted",
        SECRET,
        docket,
        UnavailableModel(),
        clock=lambda: NOW,
        web_root=frontend(tmp_path),
    )
    with TestClient(origin) as client:
        for target in ["/", "/system", "/assets/app.js", "/imagery/site.jpg"]:
            assert client.get(target).status_code == 401
            result = request(client, "GET", target)
            assert result.status_code == 200
            assert result.headers["cache-control"] == "no-store"
        assert "Synthetic hosted workspace" in request(client, "GET", "/system").text
        for target in ["/.env.local", "/hosting.py", "/assets/../.env.local"]:
            # Signed target itself may be normalized by the HTTP client; either
            # rejection or a missing route is safe, never file contents.
            result = request(client, "GET", target)
            assert result.status_code in (401, 404)
            assert "synthetic-forbidden-fixture" not in result.text


@pytest.mark.parametrize("invalid", ["missing_index", "missing_assets", "symlink"])
def test_invalid_frontend_build_fails_before_serving_any_files(tmp_path, docket, invalid):
    web = frontend(tmp_path)
    if invalid == "missing_index":
        (web / "index.html").unlink()
    elif invalid == "missing_assets":
        (web / "assets/app.js").unlink()
        (web / "assets").rmdir()
    else:
        (web / "assets/leak.txt").symlink_to(web / ".env.local")
    with pytest.raises(ValueError, match="clean frontend"):
        HostedOrigin(tmp_path / "hosted", SECRET, docket, UnavailableModel(), web_root=web)


@pytest.mark.parametrize("mutation", ["visitor", "time", "nonce", "signature", "duplicate"])
def test_invalid_envelope_is_rejected(origin, mutation):
    headers = signed("GET", BASE)
    if mutation == "duplicate":
        headers = [*headers.items(), ("x-tr-visitor", BOB)]
    else:
        headers["x-tr-" + mutation] = "invalid"
    with TestClient(origin) as client:
        assert client.get(BASE, headers=headers).status_code == 401


@pytest.mark.parametrize("offset", [-31, 6])
def test_expired_or_future_requests_fail_closed(origin, offset):
    with TestClient(origin) as client:
        assert request(client, "GET", BASE, stamp=NOW + offset).status_code == 401


@pytest.mark.parametrize("tamper", ["body", "path", "query", "method", "visitor"])
def test_signature_binds_every_part_of_the_request(origin, tamper):
    target = BASE + "/recovery/evaluate"
    body = b'{"candidate_ids":[]}'
    headers = signed("POST", target, body=body)
    method = "POST"
    if tamper == "body":
        body = b"{}"
    elif tamper == "path":
        target = BASE + "/recovery/approvals"
    elif tamper == "query":
        target += "?as_of=2026-10-24T12%3A00%3A00-07%3A00"
    elif tamper == "method":
        method = "PUT"
    else:
        headers["x-tr-visitor"] = BOB
    with TestClient(origin) as client:
        assert client.request(method, target, content=body, headers=headers).status_code == 401


def test_approvals_are_isolated_and_survive_restart_without_reseeding(origin, docket):
    target = BASE + "/recovery"
    with TestClient(origin) as client:
        before = request(client, "GET", BASE).json()
        plan = request(client, "GET", target).json()
        approved = request(client, "POST", target + "/approvals", payload={"plan_id": plan["id"]})
        assert approved.status_code == 200
        assert request(client, "GET", target).json()["approval"] == approved.json()
        assert request(client, "GET", target, BOB).json()["approval"] is None
        assert request(client, "GET", BASE).json() == before
        assert request(client, "GET", BASE, BOB).json() == before
    restarted = HostedOrigin(origin.root, SECRET, docket, UnavailableModel(), clock=lambda: NOW)
    with TestClient(restarted) as client:
        assert request(client, "GET", target).json()["approval"] == approved.json()
        assert request(client, "GET", target, BOB).json()["approval"] is None


def test_nonce_replay_is_rejected_even_after_restart(origin, docket):
    headers = signed("GET", "/health")
    with TestClient(origin) as client:
        assert client.get("/health", headers=headers).status_code == 200
        assert client.get("/health", headers=headers).status_code == 401
    restarted = HostedOrigin(origin.root, SECRET, docket, UnavailableModel(), clock=lambda: NOW)
    with TestClient(restarted) as client:
        assert client.get("/health", headers=headers).status_code == 401


def test_signed_query_and_body_work_without_caching_or_cross_user_audits(origin):
    with TestClient(origin) as client:
        target = BASE + "/readiness?machine_id=hauler-1"
        # Unknown machine is a domain error, not a failed gateway signature.
        assert request(client, "GET", target).status_code == 404
        result = request(client, "POST", BASE + "/assist", payload={"question": "Wet road?"})
        assert result.status_code == 200
        assert result.json()["mode"] == "deterministic_fallback"
        assert result.json()["saved_locally"] is True
        assert result.headers["cache-control"] == "no-store"
        request(client, "GET", "/health", BOB)
        assert "assist_runs" in SiteStore(origin.root / ALICE).connection.list_tables().tables
        assert "assist_runs" not in SiteStore(origin.root / BOB).connection.list_tables().tables
        blocked = request(client, "POST", BASE + "/assist", payload={"question": "Again?"})
        assert blocked.status_code == 429
        assert blocked.headers["retry-after"] == "10"
        assert request(client, "GET", BASE + "/recovery").status_code == 200
        status = request(client, "GET", "/api/hosting").json()
        assert status["queue"]["running"] == 0
        assert "visitor" not in status


def test_oversized_body_and_invalid_domain_input_do_not_run_model(origin):
    with TestClient(origin) as client:
        body = b"x" * 16_385
        response = client.post(BASE, content=body, headers=signed("POST", BASE, body=body))
        assert response.status_code == 413
        result = request(client, "POST", BASE + "/assist", payload={"question": "x" * 501})
        assert result.status_code == 422
        assert origin.queue.status()["running"] == 0


def test_unknown_or_partial_storage_is_never_reset(tmp_path, docket):
    root = tmp_path / "unrelated"
    root.mkdir()
    (root / "keep.txt").write_text("preserve")
    with pytest.raises(ValueError, match="nonempty"):
        HostedOrigin(root, SECRET, docket, UnavailableModel())
    assert (root / "keep.txt").read_text() == "preserve"
    origin = HostedOrigin(tmp_path / "new", SECRET, docket, UnavailableModel(), clock=lambda: NOW)
    (origin.root / ALICE).mkdir()
    with TestClient(origin) as client:
        assert request(client, "GET", BASE).status_code == 503
    assert not (origin.root / ALICE / ".seeded").exists()


def test_workspace_registry_is_bounded_and_rejects_symlinks(origin, docket, tmp_path):
    # Simulate a full registry without creating 32 real databases.
    origin._visitors = {f"{i:064x}" for i in range(32)}
    with TestClient(origin) as client:
        assert request(client, "GET", BASE).status_code == 503
    outside = tmp_path / "outside"
    outside.mkdir()
    origin._visitors.clear()
    (origin.root / ALICE).symlink_to(outside, target_is_directory=True)
    with TestClient(origin) as client:
        assert request(client, "GET", BASE).status_code == 503
    assert not list(outside.iterdir())
    with pytest.raises(ValueError):
        HostedOrigin(tmp_path / "bad", "short", docket, UnavailableModel())


def test_nonce_capacity_fails_closed_then_expired_nonces_are_reclaimed(origin):
    with sqlite3.connect(origin._nonce_db) as connection:
        connection.executemany(
            "INSERT INTO nonces VALUES (?, ?)", [(f"{i:032x}", NOW + 30) for i in range(4096)]
        )
    with TestClient(origin) as client:
        assert request(client, "GET", "/health").status_code == 503
        origin._clock = lambda: NOW + 31
        assert request(client, "GET", "/health", stamp=NOW + 31).status_code == 200


def test_nonce_storage_failure_cannot_bypass_authentication(origin):
    origin._nonce_db = origin.root  # A directory cannot be opened as a SQLite database.
    with TestClient(origin) as client:
        result = request(client, "GET", "/health")
        assert result.status_code == 503
        assert str(origin.root) not in result.text


def test_duplicate_signed_requests_race_to_exactly_one_acceptance(origin):
    headers = signed("GET", "/health")
    with TestClient(origin) as client, ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(lambda _: client.get("/health", headers=headers), range(10)))
    assert sorted(r.status_code for r in results) == [200] + [401] * 9


def test_corrupt_registry_and_markers_fail_closed(tmp_path, docket):
    root = tmp_path / "hosted"
    origin = HostedOrigin(root, SECRET, docket, UnavailableModel(), clock=lambda: NOW)
    (root / ".terraready-hosted").write_text("unrecognized")
    with pytest.raises(ValueError, match="marker"):
        HostedOrigin(root, SECRET, docket, UnavailableModel())
    (root / ".terraready-hosted").write_text("hosted-v1\n")
    (root / "invalid-entry").mkdir()
    with pytest.raises(ValueError, match="registry"):
        HostedOrigin(root, SECRET, docket, UnavailableModel())
    (root / "invalid-entry").rmdir()
    with TestClient(origin) as client:
        assert request(client, "GET", "/health").status_code == 200
    (root / ALICE / ".seeded").write_text("incomplete")
    restarted = HostedOrigin(root, SECRET, docket, UnavailableModel(), clock=lambda: NOW)
    with TestClient(restarted) as client:
        assert request(client, "GET", BASE).status_code == 503


def test_asgi_disconnect_websocket_chunked_body_and_body_deadline(origin, monkeypatch):
    async def invoke(kind="http", chunks=None, stalled=False):
        target = "/health"
        headers = signed("GET", target)
        scope = {
            "type": kind,
            "method": "GET",
            "path": target,
            "raw_path": target.encode(),
            "query_string": b"",
            "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
            "scheme": "http",
            "http_version": "1.1",
            "server": ("localhost", 80),
            "client": ("127.0.0.1", 1),
        }
        incoming = iter(chunks or [{"type": "http.disconnect"}])
        sent = []

        async def receive():
            if stalled:
                await asyncio.Event().wait()
            return next(incoming)

        async def send(message):
            sent.append(message)

        await origin(scope, receive, send)
        return sent

    assert asyncio.run(invoke()) == []
    assert asyncio.run(invoke("websocket")) == [{"type": "websocket.close", "code": 1008}]
    chunked = [
        {"type": "http.request", "body": b"", "more_body": True},
        {"type": "http.request", "body": b"", "more_body": False},
    ]
    assert asyncio.run(invoke(chunks=chunked))[0]["status"] == 200
    monkeypatch.setattr("terraready.hosting.BODY_SECONDS", 0.01)
    assert asyncio.run(invoke(stalled=True))[0]["status"] == 408


def wait_for(predicate):
    deadline = monotonic() + 5
    while not predicate():
        assert monotonic() < deadline, "Concurrent test did not reach the expected state."
        sleep(0.005)


def test_ten_visitors_are_fifo_with_one_running_and_no_tab_bypass():
    queue = AssistQueue(cooldown_seconds=0)
    entered = []
    release = [Event() for _ in range(10)]

    def work(index):
        with queue.admit(str(index)):
            entered.append(index)
            assert release[index].wait(5)

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = []
        for index in range(10):
            futures.append(pool.submit(work, index))
            wait_for(
                lambda index=index: (
                    queue.status()["waiting"] + queue.status()["running"] == index + 1
                )
            )
        assert entered == [0]
        with pytest.raises(QueueUnavailable, match="already"), queue.admit("0"):
            pytest.fail("Duplicate tab admitted")
        with pytest.raises(QueueUnavailable, match="full"), queue.admit("overflow"):
            pytest.fail("Queue limit bypassed")
        for index in range(10):
            wait_for(lambda index=index: entered == list(range(index + 1)))
            release[index].set()
        for future in futures:
            future.result()
    assert queue.status()["running"] == queue.status()["waiting"] == 0


def test_queue_timeout_cooldown_and_failure_release():
    queue = AssistQueue(wait_seconds=0.03, cooldown_seconds=10)
    with queue.admit("first"), ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lambda: queue.admit("second").__enter__())
        with pytest.raises(QueueUnavailable, match="busy"):
            future.result()
        assert queue.status()["waiting"] == 0
    with pytest.raises(RuntimeError), queue.admit("failure"):
        raise RuntimeError("Synthetic failure")
    with pytest.raises(QueueUnavailable, match="seconds"), queue.admit("failure"):
        pytest.fail("Cooldown bypassed")
    with queue.admit("next"):
        assert queue.status()["running"] == 1
    with pytest.raises(ValueError):
        AssistQueue(capacity=11)


def test_ten_signed_http_clients_share_one_loop_and_keep_audits_separate(origin):
    entered = []
    mutex = Lock()
    release = Event()

    class BlockingModel(UnavailableModel):
        def complete(self, messages, tools, timeout):
            with mutex:
                entered.append(messages[-1]["content"])
            assert release.wait(10)
            raise InferenceFailure("unavailable")

    origin._model = BlockingModel()
    visitors = [f"{i:064x}" for i in range(10)]
    # Preinitialize workspaces so admission order is independent of disk speed.
    with TestClient(origin) as client:
        for visitor in visitors:
            assert request(client, "GET", "/health", visitor).status_code == 200

        def analyze(visitor):
            return request(client, "POST", BASE + "/assist", visitor, payload={"question": visitor})

        with ThreadPoolExecutor(max_workers=10) as pool:
            first = pool.submit(analyze, visitors[0])
            wait_for(lambda: origin.queue.status()["running"] == 1)
            others = [pool.submit(analyze, visitor) for visitor in visitors[1:]]
            wait_for(lambda: origin.queue.status()["waiting"] == 9)
            assert entered == [visitors[0]]
            # Planning stays available while the sole model slot is occupied.
            assert request(client, "GET", BASE + "/recovery", visitors[1]).status_code == 200
            release.set()
            results = [future.result() for future in [first, *others]]
    assert all(result.status_code == 200 for result in results)
    assert all(result.json()["fallback_reason"] == "unavailable" for result in results)
    assert set(entered) == set(visitors)
    assert len({result.json()["id"] for result in results}) == 10
    for visitor, result in zip(visitors, results, strict=True):
        table = SiteStore(origin.root / visitor).connection.open_table("assist_runs")
        assert table.to_arrow().to_pylist()[0]["id"] == result.json()["id"]
