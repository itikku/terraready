from pathlib import Path

import pytest
from terraready.models import SiteSnapshot
from terraready.seed import load_docket

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = PROJECT_ROOT / "data/fixtures/post-rain.json"


@pytest.fixture
def fixture_path() -> Path:
    return FIXTURE_PATH


@pytest.fixture
def snapshot() -> SiteSnapshot:
    return SiteSnapshot.model_validate_json(FIXTURE_PATH.read_text())


@pytest.fixture
def docket(snapshot) -> SiteSnapshot:
    return load_docket(snapshot, PROJECT_ROOT / "data/fixtures/shift-docket.json")
