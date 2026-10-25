"""Local LanceDB persistence for the single-site demo snapshot."""

from collections.abc import Sequence
from pathlib import Path
from threading import Lock
from typing import TypeVar

import lancedb
import pyarrow as pa

from terraready.models import (
    Approval,
    Machine,
    Model,
    Observation,
    Route,
    Scenario,
    SiteSnapshot,
    Task,
    Zone,
)

Record = TypeVar("Record", bound=Model)
POINT = pa.struct([("x_m", pa.float64()), ("y_m", pa.float64())])
UTC_TIME = pa.timestamp("us", tz="UTC")
APPROVAL_LOCK = Lock()
APPROVAL_SCHEMA = pa.schema(
    [
        ("plan_id", pa.string()),
        ("scenario_id", pa.string()),
        ("evaluated_at", UTC_TIME),
        ("approved_at", UTC_TIME),
        ("approved_by", pa.string()),
        ("planner_version", pa.string()),
        ("synthetic", pa.bool_()),
        (
            "work",
            pa.list_(
                pa.struct(
                    [
                        ("task_id", pa.string()),
                        ("machine_id", pa.string()),
                        ("route_id", pa.string()),
                        ("status", pa.string()),
                        ("evidence_ids", pa.list_(pa.string())),
                    ]
                )
            ),
        ),
        (
            "updates",
            pa.list_(
                pa.struct([("role", pa.string()), ("title", pa.string()), ("body", pa.string())])
            ),
        ),
    ]
)
# Explicit Arrow schemas support literal/enum fields without weakening the domain contract.
SCHEMAS = {
    "scenarios": pa.schema(
        [
            ("id", pa.string()),
            ("schema_version", pa.int64()),
            ("name", pa.string()),
            ("summary", pa.string()),
            ("as_of", UTC_TIME),
            ("rainfall_24h_mm", pa.float64()),
            ("rain_ended_at", UTC_TIME),
            ("max_evidence_age_hours", pa.float64()),
            ("min_evidence_confidence", pa.float64()),
            ("synthetic", pa.bool_()),
        ]
    ),
    "zones": pa.schema(
        [
            ("id", pa.string()),
            ("name", pa.string()),
            ("polygon", pa.list_(POINT)),
            ("slope_deg", pa.float64()),
            ("closed", pa.bool_()),
            ("closure_reason", pa.string()),
        ]
    ),
    "machines": pa.schema(
        [
            ("id", pa.string()),
            ("name", pa.string()),
            ("operating_mass_t", pa.float64()),
            ("ground_pressure_kpa", pa.float64()),
            ("max_slope_deg", pa.float64()),
            ("max_moisture_fraction", pa.float64()),
            ("operations", pa.list_(pa.string())),
            ("available_hours", pa.float64()),
        ]
    ),
    "routes": pa.schema(
        [
            ("id", pa.string()),
            ("name", pa.string()),
            ("zone_ids", pa.list_(pa.string())),
            ("path", pa.list_(POINT)),
            ("distance_m", pa.float64()),
        ]
    ),
    "tasks": pa.schema(
        [
            ("id", pa.string()),
            ("name", pa.string()),
            ("zone_id", pa.string()),
            ("operation", pa.string()),
            ("priority", pa.int64()),
            ("duration_hours", pa.float64()),
            ("target_quantity", pa.float64()),
            ("quantity_unit", pa.string()),
            ("assigned_machine_id", pa.string()),
            ("route_id", pa.string()),
            ("bucket", pa.string()),
            ("state", pa.string()),
            ("prerequisite_ids", pa.list_(pa.string())),
            ("progress_fraction", pa.float64()),
            ("estimated_remaining_hours", pa.float64()),
            ("completed_at", UTC_TIME),
        ]
    ),
    "observations": pa.schema(
        [
            ("id", pa.string()),
            ("zone_id", pa.string()),
            ("observed_at", UTC_TIME),
            ("source", pa.string()),
            ("note", pa.string()),
            ("confidence", pa.float64()),
            ("access", pa.string()),
            ("moisture_fraction", pa.float64()),
            ("bearing_capacity_kpa", pa.float64()),
            ("image_path", pa.string()),
            ("image_caption", pa.string()),
            ("synthetic", pa.bool_()),
        ]
    ),
}


class DataUnavailable(RuntimeError):
    """The demo has not been seeded or the stored snapshot is incomplete."""


class ApprovalUnavailable(RuntimeError):
    """Approval persistence failed; never imply success or disclose local paths."""


class SiteStore:
    def __init__(self, path: Path):
        self.connection = lancedb.connect(str(path))

    def seed(self, snapshot: SiteSnapshot) -> dict[str, int]:
        """Reset only the named demo tables; callers must stop the API first."""
        collections: dict[str, Sequence[Model]] = {
            "scenarios": [snapshot.scenario],
            "zones": snapshot.zones,
            "machines": snapshot.machines,
            "routes": snapshot.routes,
            "tasks": snapshot.tasks,
            "observations": snapshot.observations,
        }
        # Build every Arrow table before any persistent write.
        tables = {
            name: pa.Table.from_pylist(
                [record.model_dump() for record in records], schema=SCHEMAS[name]
            )
            for name, records in collections.items()
        }
        for name, table in tables.items():
            self.connection.create_table(name, data=table, mode="overwrite")
        return {name: len(records) for name, records in collections.items()}

    def _read(self, table: str, model: type[Record]) -> list[Record]:
        records = self.connection.open_table(table).to_arrow().to_pylist()
        return [model.model_validate(record) for record in records]

    def load(self) -> SiteSnapshot:
        try:
            scenarios = self._read("scenarios", Scenario)
            if len(scenarios) != 1:
                raise ValueError("The demo requires exactly one scenario.")
            return SiteSnapshot(
                scenario=scenarios[0],
                zones=self._read("zones", Zone),
                machines=self._read("machines", Machine),
                routes=self._read("routes", Route),
                tasks=self._read("tasks", Task),
                observations=self._read("observations", Observation),
            )
        except (ValueError, OSError, RuntimeError, pa.ArrowException) as exc:
            raise DataUnavailable(
                "Demo data unavailable. Stop the API and run the seed command."
            ) from exc

    def approval(self, plan_id: str) -> Approval | None:
        try:
            if "approvals" not in self.connection.list_tables().tables:
                return None
            matches = [
                record for record in self._read("approvals", Approval) if record.plan_id == plan_id
            ]
            if len(matches) > 1:
                raise ValueError("Duplicate approvals")
            return matches[0] if matches else None
        except (ValueError, OSError, RuntimeError, pa.ArrowException) as exc:
            raise ApprovalUnavailable("Local approval unavailable. Please retry.") from exc

    def save_approval(self, approval: Approval) -> Approval:
        # Serialize local request threads; multiple API processes are outside this POC's scope.
        with APPROVAL_LOCK:
            try:
                existing = self.approval(approval.plan_id)
                if existing:
                    return existing
                table = self.connection.create_table(
                    "approvals", schema=APPROVAL_SCHEMA, exist_ok=True
                )
                rows = pa.Table.from_pylist([approval.model_dump()], schema=APPROVAL_SCHEMA)
                table.merge_insert("plan_id").when_not_matched_insert_all().execute(rows)
                saved = self.approval(approval.plan_id)
                if saved is None:
                    raise ValueError("Approval was not persisted")
                return saved
            except (ValueError, OSError, RuntimeError, pa.ArrowException) as exc:
                raise ApprovalUnavailable(
                    "Local approval could not be saved. Please retry."
                ) from exc
