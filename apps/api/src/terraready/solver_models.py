"""Bounded, read-only production what-ifs; user text never becomes executable code."""

from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from terraready.agent_models import ToolTrace
from terraready.models import DecisionStatus, Identifier, Model, PlanId, Reason


class WorkSuggestionRequest(Model):
    task_id: Identifier
    suggestion: str = Field(min_length=1, max_length=500)
    as_of: AwareDatetime | None = None
    source_plan_id: PlanId | None = None
    current_candidate_ids: list[Identifier] | None = Field(default=None, max_length=32)


class SuggestionIntent(Model):
    target_bank_m3: int | None = Field(default=None, strict=True, ge=1, le=320)
    max_trucks: int | None = Field(default=None, strict=True, ge=1, le=3)
    max_overtime_minutes: int | None = Field(default=None, strict=True, ge=0, le=120)
    deadline_minutes: int | None = Field(default=None, strict=True, ge=1, le=600)
    keep_other_work: bool = Field(default=True, strict=True)


class SuggestionInterpretation(Model):
    status: Literal[
        "interpreted", "clarification", "unsupported", "unavailable", "timeout", "invalid_output"
    ]
    task_id: Identifier
    intent: SuggestionIntent | None
    message: str = Field(max_length=500)
    model_id: str = Field(max_length=120)
    mode: Literal["local_model", "test_stub", "deterministic_fallback"]
    elapsed_ms: int = Field(ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    trace: list[ToolTrace] = Field(default_factory=list, max_length=5)


class ProductionAssumptions(Model):
    version: Literal["production-demo-v1"] = "production-demo-v1"
    synthetic: Literal[True] = True
    description: str = Field(max_length=1000)
    haul_task_id: Identifier
    preparation_task_id: Identifier
    drainage_task_id: Identifier
    loader_machine_id: Identifier
    truck_machine_id: Identifier
    route_id: Identifier
    payload_loose_m3: int = Field(strict=True, ge=1, le=100)
    swell_factor: float = Field(gt=0, le=3)
    bank_m3_per_load: int = Field(strict=True, ge=1, le=100)
    load_minutes: int = Field(strict=True, ge=1, le=60)
    loaded_travel_minutes: int = Field(strict=True, ge=1, le=120)
    dump_minutes: int = Field(strict=True, ge=1, le=60)
    return_minutes: int = Field(strict=True, ge=1, le=120)
    shift_minutes: int = Field(strict=True, ge=1, le=480)
    existing_trucks: Literal[1] = 1
    maximum_trucks: Literal[3] = 3
    default_trucks: int = Field(strict=True, ge=1, le=3)
    target_bank_m3: int = Field(strict=True, ge=1, le=320)
    maximum_loads: Literal[20] = 20

    @model_validator(mode="after")
    def volume_basis_is_consistent(self) -> "ProductionAssumptions":
        if self.bank_m3_per_load * self.swell_factor != self.payload_loose_m3:
            raise ValueError("Loose payload / swell must equal the declared bank volume per load.")
        return self


class SolverInputs(Model):
    production: ProductionAssumptions
    target_bank_m3: int = Field(ge=1, le=320)
    max_trucks: int = Field(ge=1, le=3)
    max_overtime_minutes: int = Field(ge=0, le=120)
    deadline_minutes: int | None = Field(default=None, ge=1, le=600)
    keep_other_work: bool
    retained_task_ids: list[Identifier] = Field(max_length=8)
    preparation_minutes: int = Field(ge=0, le=600)
    drainage_minutes: int = Field(ge=0, le=600)
    shift_minutes: int = Field(ge=0, le=480)
    include_haul: bool
    jobs: list["SolverJob"] = Field(max_length=8)
    resource_minutes: dict[Identifier, int]


class SolverJob(Model):
    task_id: Identifier
    machine_id: Identifier
    duration_minutes: int = Field(ge=1, le=600)
    in_progress: bool = False


class ScheduleActivity(Model):
    id: Identifier
    task_id: Identifier
    resource_id: Identifier
    kind: Literal["preparation", "drainage", "retained_work", "loading", "truck_cycle", "dumping"]
    start_minutes: int = Field(ge=0, le=600)
    end_minutes: int = Field(ge=0, le=600)


class TripSchedule(Model):
    index: int = Field(ge=0, lt=20)
    truck: int = Field(ge=1, le=3)
    start_minutes: int = Field(ge=0, le=600)
    load_end_minutes: int = Field(ge=0, le=600)
    dump_start_minutes: int = Field(ge=0, le=600)
    dump_end_minutes: int = Field(ge=0, le=600)
    end_minutes: int = Field(ge=0, le=600)
    bank_m3: int = Field(ge=1, le=100)


class SolverCaseResult(Model):
    case: Literal["requested", "minimum_fleet", "minimum_overtime", "maximum_volume"]
    status: Literal["feasible", "infeasible", "unknown"]
    solver_status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "NOT_RUN"]
    message: str = Field(max_length=1000)
    fleet: int | None = Field(default=None, ge=1, le=3)
    delivered_bank_m3: int | None = Field(default=None, ge=0, le=320)
    finish_minutes: int | None = Field(default=None, ge=0, le=600)
    overtime_minutes: int | None = Field(default=None, ge=0, le=120)
    additional_resources_required: int = Field(default=0, ge=0, le=2)
    objective: str = Field(max_length=120)
    objective_value: float | None = None
    objective_bound: float | None = None
    verified: bool = False
    conflicts: list[str] = Field(default_factory=list, max_length=10)
    trips: list[TripSchedule] = Field(default_factory=list, max_length=20)
    schedule: list[ScheduleActivity] = Field(default_factory=list, max_length=68)


class SuggestionSolverResult(Model):
    id: PlanId
    task_id: Identifier
    source_plan_id: PlanId
    as_of: AwareDatetime
    review_by: AwareDatetime | None
    ground_status: DecisionStatus
    ground_reasons: list[Reason]
    verdict: Literal["GO", "NO_GO", "INSPECT", "UNKNOWN"]
    inputs: SolverInputs
    requested: SolverCaseResult
    alternatives: list[SolverCaseResult] = Field(default_factory=list, max_length=3)
    assumptions: list[str]
    solver: str
    solver_workers: Literal[1] = 1
    read_only: Literal[True] = True


class WorkSuggestionResponse(Model):
    task_id: Identifier
    source_plan_id: PlanId
    interpretation: SuggestionInterpretation
    solver: SuggestionSolverResult | None
    planning_only: Literal[True] = True


PRODUCTION_PATH = Path(__file__).resolve().parents[4] / "data/fixtures/production-demo.json"


def load_production_assumptions(path: Path = PRODUCTION_PATH) -> ProductionAssumptions:
    """Read only the public, versioned fixture; requires no solver or inference runtime."""
    return ProductionAssumptions.model_validate_json(path.read_text())
