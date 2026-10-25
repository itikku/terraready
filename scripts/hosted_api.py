"""Opt-in single-process hosted origin. Never loads the existing local environment."""

import os
from pathlib import Path

from terraready.hosting import HostedOrigin
from terraready.model_client import LocalModel
from terraready.seed import load_docket, load_fixture

ROOT = Path(__file__).resolve().parents[1]


def create() -> HostedOrigin:
    # New deployment values only. Do not fall back to the local database path.
    secret = os.environ.get("TR_ORIGIN_SECRET", "")
    storage = ROOT / ".data/hosted"
    fixture = load_docket(
        load_fixture(ROOT / "data/fixtures/post-rain.json"),
        ROOT / "data/fixtures/shift-docket.json",
    )
    return HostedOrigin(
        storage,
        secret,
        fixture,
        LocalModel(ROOT / ".data/runtime/inference.key", seed=None),
        web_root=ROOT / "apps/web/dist",
    )
