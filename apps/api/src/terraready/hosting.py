"""Opt-in shared origin. No unauthenticated route or original database access."""

import asyncio
import hashlib
import hmac
import json
import re
import sqlite3
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from threading import Lock
from time import time

from fastapi import FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse, JSONResponse
from starlette.staticfiles import StaticFiles
from starlette.types import Message, Receive, Scope, Send

from terraready.agent import ModelClient, assist
from terraready.agent_models import AssistRequest, AssistRun
from terraready.assist_queue import AssistQueue, QueueUnavailable
from terraready.main import create_app
from terraready.models import SiteSnapshot
from terraready.solver_models import WorkSuggestionRequest, WorkSuggestionResponse
from terraready.storage import SiteStore
from terraready.work_suggestions import suggest_work

HEX64 = re.compile(r"^[a-f0-9]{64}$")
HEX32 = re.compile(r"^[a-f0-9]{32}$")
MAX_BODY = 16_384
BODY_SECONDS = 5
MAX_VISITORS = 32
SIGNATURE_SECONDS = 30
HEADERS = (b"x-tr-visitor", b"x-tr-time", b"x-tr-nonce", b"x-tr-signature")


class HostedOrigin:
    def __init__(
        self,
        root: Path,
        secret: str,
        fixture: SiteSnapshot,
        model: ModelClient,
        *,
        clock: Callable[[], float] = time,
        web_root: Path | None = None,
        startup_file: Path | None = None,
    ) -> None:
        if not HEX64.fullmatch(secret):
            raise ValueError("A new 32-byte hex gateway secret is required.")
        if root.is_symlink():
            raise ValueError("Hosted storage must be a dedicated directory.")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        marker = root / ".terraready-hosted"
        if not marker.exists():
            if any(root.iterdir()):
                raise ValueError("Refusing to initialize a nonempty storage directory.")
            marker.write_text("hosted-v1\n")
        if marker.is_symlink() or marker.read_text() != "hosted-v1\n":
            raise ValueError("Invalid hosted storage marker.")
        nonce_file = ".gateway-nonces.sqlite3"
        names = [
            p.name
            for p in root.iterdir()
            if p.name not in {marker.name, nonce_file, nonce_file + "-journal"}
        ]
        if len(names) > MAX_VISITORS or any(not HEX64.fullmatch(n) for n in names):
            raise ValueError("Invalid hosted workspace registry.")
        self.root = root
        self._secret = secret.encode("ascii")
        self._fixture = fixture
        self._model = model
        self._clock = clock
        self._web_root = web_root
        self._startup_file = startup_file
        if web_root is not None and (
            web_root.is_symlink()
            or not (web_root / "index.html").is_file()
            or any(not (web_root / name).is_dir() for name in ("assets", "imagery", "licenses"))
            or any(p.is_symlink() for p in web_root.rglob("*"))
        ):
            raise ValueError("A complete, clean frontend build is required.")
        self._apps: dict[str, FastAPI] = {}
        self._visitors = set(names)
        self._nonce_db = root / nonce_file
        if self._nonce_db.is_symlink():
            raise ValueError("Invalid ingress storage.")
        with closing(sqlite3.connect(self._nonce_db)) as connection, connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS nonces (id TEXT PRIMARY KEY, expires REAL)"
            )
        self._lock = Lock()
        self.queue = AssistQueue()

    def _accept_nonce(self, nonce: str, now: float, expires: float) -> int:
        with self._lock, closing(sqlite3.connect(self._nonce_db)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM nonces WHERE expires < ?", (now,))
            if connection.execute("SELECT 1 FROM nonces WHERE id=?", (nonce,)).fetchone():
                return 401
            if connection.execute("SELECT COUNT(*) FROM nonces").fetchone()[0] >= 4096:
                return 503
            connection.execute("INSERT INTO nonces VALUES (?, ?)", (nonce, expires))
        return 0

    def _workspace(self, visitor: str) -> FastAPI:
        with self._lock:
            if visitor in self._apps:
                return self._apps[visitor]
            path = self.root / visitor
            if path.is_symlink():
                raise ValueError("Invalid workspace.")
            complete = path / ".seeded"
            if visitor not in self._visitors:
                if len(self._visitors) >= MAX_VISITORS:
                    raise ValueError("Workspace capacity reached.")
                # Reserve before seeding; a partial seed must never be overwritten.
                self._visitors.add(visitor)
                path.mkdir(mode=0o700)
                SiteStore(path).seed(self._fixture)
                complete.write_text("synthetic-v1\n")
            if complete.is_symlink() or complete.read_text() != "synthetic-v1\n":
                raise ValueError("Workspace unavailable.")

            def run(site: SiteSnapshot, body: AssistRequest, model: ModelClient) -> AssistRun:
                try:
                    with self.queue.admit(visitor):
                        return assist(site, body, model)
                except QueueUnavailable as exc:
                    raise HTTPException(
                        status_code=429, detail=str(exc), headers={"Retry-After": "10"}
                    ) from exc

            def run_suggestion(
                site: SiteSnapshot, body: WorkSuggestionRequest, model: ModelClient
            ) -> WorkSuggestionResponse:
                try:
                    with self.queue.admit(visitor):
                        return suggest_work(site, body, model)
                except QueueUnavailable as exc:
                    raise HTTPException(
                        status_code=429, detail=str(exc), headers={"Retry-After": "10"}
                    ) from exc

            api = create_app(path, self._model, assist_runner=run, suggestion_runner=run_suggestion)

            if self._web_root is not None:
                web = self._web_root

                @api.get("/", include_in_schema=False)
                @api.get("/system", include_in_schema=False)
                def workspace_page() -> FileResponse:
                    return FileResponse(web / "index.html", media_type="text/html")

                # Only public build directories, never the source/storage root.
                for name in ("assets", "imagery", "licenses"):
                    api.mount("/" + name, StaticFiles(directory=web / name), name=name)

            @api.get("/api/hosting")
            def hosting_status() -> dict[str, object]:
                return {"mode": "shared_demo", "queue": self.queue.status()}

            self._apps[visitor] = api
            return api

    async def _error(self, scope: Scope, receive: Receive, send: Send, status: int) -> None:
        detail = {
            401: "Authenticated demo gateway access is required.",
            408: "Request body did not arrive in time.",
            413: "Request is too large.",
            503: "Shared demo unavailable. Please retry later.",
        }[status]
        await JSONResponse(
            {"detail": detail}, status_code=status, headers={"Cache-Control": "no-store"}
        )(scope, receive, send)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            await send({"type": "websocket.close", "code": 1008})
            return
        values: list[str] = []
        try:
            for name in HEADERS:
                matches = [v for k, v in scope["headers"] if k.lower() == name]
                if len(matches) != 1:
                    raise ValueError("Invalid gateway envelope.")
                values.append(matches[0].decode("ascii"))
            visitor, stamp, nonce, signature = values
            now = self._clock()
            if (
                not HEX64.fullmatch(visitor)
                or not re.fullmatch(r"[0-9]{10}", stamp)
                or not HEX32.fullmatch(nonce)
                or not HEX64.fullmatch(signature)
                or not -5 <= now - int(stamp) <= SIGNATURE_SECONDS
            ):
                raise ValueError("Invalid gateway envelope.")
        except (ValueError, UnicodeError):
            await self._error(scope, receive, send, 401)
            return
        body = bytearray()
        try:
            async with asyncio.timeout(BODY_SECONDS):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > MAX_BODY:
                        await self._error(scope, receive, send, 413)
                        return
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            await self._error(scope, receive, send, 408)
            return
        target = scope["raw_path"] + (
            b"?" + scope["query_string"] if scope["query_string"] else b""
        )
        canonical = b"\n".join(
            [
                b"terraready-origin-v1",
                stamp.encode(),
                nonce.encode(),
                visitor.encode(),
                scope["method"].encode(),
                target,
                hashlib.sha256(body).hexdigest().encode(),
            ]
        )
        expected = hmac.new(self._secret, canonical, hashlib.sha256).hexdigest()
        now = self._clock()
        if not hmac.compare_digest(expected, signature) or not -5 <= now - int(stamp) <= 30:
            await self._error(scope, receive, send, 401)
            return
        try:
            rejected = await run_in_threadpool(
                self._accept_nonce, nonce, now, int(stamp) + SIGNATURE_SECONDS
            )
        except sqlite3.Error:
            rejected = 503
        if rejected:
            await self._error(scope, receive, send, rejected)
            return
        if self._startup_file is not None:
            # Startup status uses the same HMAC, nonce and body limits as every
            # origin request, but never allocates a visitor workspace.
            try:
                path = self._startup_file
                if path.is_symlink() or path.stat().st_size > 512:
                    raise ValueError("Invalid startup status.")
                startup = json.loads(path.read_text())
                if (
                    not isinstance(startup, dict)
                    or set(startup) != {"stage", "changedAt"}
                    or startup["stage"]
                    not in {"loading_model", "checking_workspace", "ready", "failed"}
                    or type(startup["changedAt"]) is not int
                    or not 0 < startup["changedAt"] <= int(self._clock() * 1000) + 30_000
                ):
                    raise ValueError("Invalid startup status.")
            except (OSError, ValueError, TypeError):
                await self._error(scope, receive, send, 503)
                return
            if scope["path"] == "/startup" and scope["method"] == "GET":
                await JSONResponse(startup, headers={"Cache-Control": "no-store"})(
                    scope, receive, send
                )
                return
            if startup["stage"] != "ready" and not (
                scope["path"] == "/ready"
                and scope["method"] == "GET"
                and startup["stage"] == "checking_workspace"
                and self._model.available()
            ):
                await self._error(scope, receive, send, 503)
                return
        try:
            api = await run_in_threadpool(self._workspace, visitor)
        except (OSError, ValueError, RuntimeError):
            await self._error(scope, receive, send, 503)
            return
        delivered = False

        async def replay_body() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        async def no_cache(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers = [(k, v) for k, v in headers if k.lower() != b"cache-control"]
                message["headers"] = headers + [(b"cache-control", b"no-store")]
            await send(message)

        await api(scope, replay_body, no_cache)
