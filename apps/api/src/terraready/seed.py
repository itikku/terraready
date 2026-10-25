"""Explicit, repeatable demo seeding. Never loads a dotenv file."""

import argparse
import json
import os
from pathlib import Path

from pydantic import ValidationError

from terraready.models import SiteSnapshot, WorkDocket
from terraready.storage import SiteStore


def database_path() -> Path:
    return Path(os.environ.get("TERRAREADY_DB_DIR", ".data/lancedb")).resolve()


def load_fixture(path: Path) -> SiteSnapshot:
    return SiteSnapshot.model_validate_json(path.read_text())


def load_docket(site: SiteSnapshot, path: Path) -> SiteSnapshot:
    docket = WorkDocket.model_validate_json(path.read_text())
    if set(docket.available_hours) != {machine.id for machine in site.machines}:
        raise ValueError("The docket must specify capacity for every known machine, and no others.")
    data = site.model_dump()
    data["scenario"]["schema_version"] = docket.schema_version
    data["tasks"] = [task.model_dump() for task in docket.tasks]
    data["routes"] += [route.model_dump() for route in docket.additional_routes]
    for machine in data["machines"]:
        machine["available_hours"] = docket.available_hours[machine["id"]]
    return SiteSnapshot.model_validate(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset the six local TerraReady demo tables.")
    parser.add_argument("--fixture", type=Path, default=Path("data/fixtures/post-rain.json"))
    parser.add_argument("--db", type=Path, default=database_path())
    parser.add_argument(
        "--docket", type=Path, help="Explicit v2 shift docket layered on the site fixture"
    )
    args = parser.parse_args()
    try:
        snapshot = load_fixture(args.fixture)
        if args.docket:
            snapshot = load_docket(snapshot, args.docket)
    except (OSError, ValueError, ValidationError) as exc:
        parser.exit(2, f"Invalid fixture; database unchanged: {exc}\n")
    counts = SiteStore(args.db).seed(snapshot)
    print(json.dumps({"scenario_id": snapshot.scenario.id, "records": counts}, indent=2))


if __name__ == "__main__":
    main()
