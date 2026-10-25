"""Explicit, repeatable demo seeding. Never loads a dotenv file."""

import argparse
import json
import os
from pathlib import Path

from pydantic import ValidationError

from terraready.models import SiteSnapshot
from terraready.storage import SiteStore


def database_path() -> Path:
    return Path(os.environ.get("TERRAREADY_DB_DIR", ".data/lancedb")).resolve()


def load_fixture(path: Path) -> SiteSnapshot:
    return SiteSnapshot.model_validate_json(path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset the six local TerraReady demo tables.")
    parser.add_argument("--fixture", type=Path, default=Path("data/fixtures/post-rain.json"))
    parser.add_argument("--db", type=Path, default=database_path())
    args = parser.parse_args()
    try:
        snapshot = load_fixture(args.fixture)
    except (OSError, ValidationError) as exc:
        parser.exit(2, f"Invalid fixture; database unchanged: {exc}\n")
    counts = SiteStore(args.db).seed(snapshot)
    print(json.dumps({"scenario_id": snapshot.scenario.id, "records": counts}, indent=2))


if __name__ == "__main__":
    main()
