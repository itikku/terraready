"""Local LanceDB persistence for the single-site demo snapshot."""

from collections.abc import Sequence
from pathlib import Path
from typing import TypeVar

import lancedb
import pyarrow as pa

from terraready.models import (
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
            ("synthetic", pa.bool_()),
        ]
    ),
}


class DataUnavailable(RuntimeError):
    """The demo has not been seeded or the stored snapshot is incomplete."""


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
