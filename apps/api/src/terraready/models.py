"""Versioned domain contract. Distances, loads and times carry explicit units."""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,63}$")]
Fraction = Annotated[float, Field(ge=0, le=1)]
Positive = Annotated[float, Field(gt=0)]


class Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid", allow_inf_nan=False, validate_assignment=True, validate_default=True
    )


class DecisionStatus(StrEnum):
    GO = "GO"
    INSPECT = "INSPECT"
    NO_GO = "NO_GO"


class Operation(StrEnum):
    EXCAVATE = "excavate"
    HAUL = "haul"
    INSPECT = "inspect"


class GroundAccess(StrEnum):
    OPEN = "open"
    CLOSED = "closed"
    UNKNOWN = "unknown"


class TaskState(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class WorkBucket(StrEnum):
    TODAY = "today"
    UPCOMING = "upcoming"
    PRIOR = "prior"


class Point(Model):
    """Local site coordinates in meters; geographic mapping belongs to Phase 2."""

    x_m: float
    y_m: float


class Scenario(Model):
    id: Identifier
    schema_version: Literal[1, 2] = 1
    name: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1000)
    as_of: AwareDatetime
    rainfall_24h_mm: float = Field(ge=0)
    rain_ended_at: AwareDatetime
    max_evidence_age_hours: Positive = 4
    min_evidence_confidence: Fraction = 0.8
    synthetic: Literal[True] = True

    @model_validator(mode="after")
    def rain_precedes_clock(self) -> Self:
        if self.rain_ended_at > self.as_of:
            raise ValueError("rain_ended_at must be at or before the scenario clock")
        return self


class Zone(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    polygon: list[Point] = Field(min_length=3)
    slope_deg: float = Field(ge=0, lt=90)
    closed: bool = False
    closure_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def closure_has_reason(self) -> Self:
        if self.closed and not self.closure_reason:
            raise ValueError("a closed zone requires closure_reason")
        return self


class Machine(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    operating_mass_t: Positive
    ground_pressure_kpa: Positive
    max_slope_deg: float = Field(gt=0, lt=90)
    max_moisture_fraction: Fraction
    operations: list[Operation] = Field(min_length=1)
    available_hours: float = Field(default=8, ge=0, le=24)


class Route(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    zone_ids: list[Identifier] = Field(min_length=1)
    path: list[Point] = Field(min_length=2)
    distance_m: Positive


class Task(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=120)
    zone_id: Identifier
    operation: Operation
    priority: int = Field(ge=1, le=3)
    duration_hours: Positive
    target_quantity: Positive
    quantity_unit: Literal["m3", "inspection"]
    assigned_machine_id: Identifier
    route_id: Identifier
    bucket: WorkBucket = WorkBucket.TODAY
    state: TaskState = TaskState.NOT_STARTED
    prerequisite_ids: list[Identifier] = Field(default_factory=list)
    progress_fraction: Fraction = 0
    estimated_remaining_hours: float | None = Field(default=None, ge=0, le=24)
    completed_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def consistent_progress(self) -> Self:
        if len(set(self.prerequisite_ids)) != len(self.prerequisite_ids):
            raise ValueError("duplicate task prerequisites")
        if self.state == TaskState.COMPLETED:
            if self.progress_fraction != 1 or self.completed_at is None:
                raise ValueError("completed work requires full progress and a completion timestamp")
            if self.estimated_remaining_hours not in (None, 0):
                raise ValueError("completed work cannot have remaining hours")
        else:
            if self.completed_at is not None or self.estimated_remaining_hours == 0:
                raise ValueError(
                    "unfinished work needs remaining effort and no completion timestamp"
                )
            if self.state == TaskState.NOT_STARTED and self.progress_fraction != 0:
                raise ValueError("not-started work cannot claim progress")
            if self.state == TaskState.IN_PROGRESS and (
                not 0 < self.progress_fraction < 1
                or self.estimated_remaining_hours is None
                or self.bucket != WorkBucket.TODAY
            ):
                raise ValueError(
                    "in-progress work requires partial progress and a remaining estimate"
                )
        if self.bucket == WorkBucket.PRIOR and self.state != TaskState.COMPLETED:
            raise ValueError("prior work must be completed")
        return self

    @property
    def remaining_hours(self) -> float:
        if self.state == TaskState.COMPLETED:
            return 0
        return (
            self.estimated_remaining_hours
            if self.estimated_remaining_hours is not None
            else self.duration_hours
        )


class WorkDocket(Model):
    schema_version: Literal[2] = 2
    available_hours: dict[Identifier, Annotated[float, Field(ge=0, le=24)]]
    tasks: list[Task] = Field(min_length=1)
    additional_routes: list[Route] = Field(default_factory=list)


class Observation(Model):
    id: Identifier
    zone_id: Identifier
    observed_at: AwareDatetime
    source: str = Field(min_length=1, max_length=120)
    note: str = Field(min_length=1, max_length=1000)
    confidence: Fraction
    access: GroundAccess
    moisture_fraction: Fraction | None = None
    bearing_capacity_kpa: Positive | None = None
    image_path: str | None = Field(default=None, pattern=r"^/imagery/[a-z0-9-]+\.(jpg|png|webp)$")
    image_caption: str | None = Field(default=None, max_length=500)
    synthetic: Literal[True] = True


class SiteSnapshot(Model):
    scenario: Scenario
    zones: list[Zone] = Field(min_length=1)
    machines: list[Machine] = Field(min_length=1)
    routes: list[Route] = Field(min_length=1)
    tasks: list[Task] = Field(min_length=1)
    observations: list[Observation]

    @model_validator(mode="after")
    def validate_references(self) -> Self:
        for records in (self.zones, self.machines, self.routes, self.tasks, self.observations):
            ids = [record.id for record in records]
            if len(set(ids)) != len(ids):
                raise ValueError("duplicate IDs in a record collection")
        zones = {zone.id for zone in self.zones}
        machines = {machine.id for machine in self.machines}
        routes = {route.id: route for route in self.routes}
        task_ids = {task.id for task in self.tasks}
        for route in self.routes:
            if not set(route.zone_ids) <= zones:
                raise ValueError(f"route {route.id} references an unknown zone")
        for task in self.tasks:
            if task.zone_id not in zones or task.assigned_machine_id not in machines:
                raise ValueError(f"task {task.id} references an unknown zone or machine")
            if task.route_id not in routes or task.zone_id not in routes[task.route_id].zone_ids:
                raise ValueError(f"task {task.id} needs a route that reaches its zone")
            if task.id in task.prerequisite_ids or not set(task.prerequisite_ids) <= task_ids:
                raise ValueError(f"task {task.id} has a self-reference or unknown prerequisite")
            if task.completed_at is not None and task.completed_at > self.scenario.as_of:
                raise ValueError("completion cannot be in the future of the snapshot")
        pending = {task.id: set(task.prerequisite_ids) for task in self.tasks}
        while pending:
            roots = {task_id for task_id, prerequisites in pending.items() if not prerequisites}
            if not roots:
                raise ValueError("task prerequisites contain a cycle")
            pending = {
                task_id: prerequisites - roots
                for task_id, prerequisites in pending.items()
                if task_id not in roots
            }
        for observation in self.observations:
            if observation.zone_id not in zones:
                raise ValueError(f"observation {observation.id} references an unknown zone")
        return self


class EvaluationRequest(Model):
    task_id: Identifier
    machine_id: Identifier
    route_id: Identifier
    as_of: AwareDatetime | None = None


class Reason(Model):
    code: str
    message: str
    evidence_ids: list[Identifier] = Field(default_factory=list)


class Calculation(Model):
    """Inspectable operands for demo rules; a passing check is not a work release."""

    code: Literal["SLOPE", "EVIDENCE_AGE", "POST_RAIN", "CONFIDENCE", "BEARING", "MOISTURE"]
    label: str = Field(min_length=1, max_length=80)
    observed: float | None
    limit: float
    headroom: float | None
    unit: Literal["degrees", "hours", "fraction", "kPa"]
    outcome: Literal["pass", "inspect", "blocked", "unavailable"]
    evidence_id: Identifier | None = None
    applicable: bool = True
    caution_limit: float | None = None


class ZoneDecision(Model):
    zone_id: Identifier
    status: DecisionStatus
    reasons: list[Reason]
    confidence: Fraction | None
    evidence_ids: list[Identifier]
    mitigations: list[str]
    calculations: list[Calculation] = Field(default_factory=list)


class Evaluation(Model):
    scenario_id: Identifier
    task_id: Identifier
    machine_id: Identifier
    route_id: Identifier
    as_of: AwareDatetime
    status: DecisionStatus
    reasons: list[Reason]
    zone_decisions: list[ZoneDecision]
    evidence_ids: list[Identifier]
    confidence: Fraction | None
    mitigations: list[str]
    policy_version: Literal["demo-v1"] = "demo-v1"
    requires_approval: Literal[True] = True
    synthetic: Literal[True] = True


class Readiness(Model):
    scenario_id: Identifier
    machine_id: Identifier
    as_of: AwareDatetime
    zones: list[ZoneDecision]


PlanId = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class PlanItem(Model):
    task_id: Identifier
    baseline: Evaluation
    alternatives: list[Evaluation] = Field(min_length=1)
    selected_route_id: Identifier | None
    status: DecisionStatus
    blocking_task_ids: list[Identifier] = Field(default_factory=list)


class ApprovedWork(Model):
    task_id: Identifier
    machine_id: Identifier
    route_id: Identifier | None
    status: DecisionStatus
    evidence_ids: list[Identifier]


class TeamUpdate(Model):
    role: Literal["Field lead", "Haul coordinator"]
    title: str
    body: str


class Approval(Model):
    plan_id: PlanId
    scenario_id: Identifier
    evaluated_at: AwareDatetime
    approved_at: AwareDatetime
    approved_by: Literal["Demo superintendent"] = "Demo superintendent"
    planner_version: Literal["routes-v1", "routes-v2", "recovery-v1"] = "routes-v2"
    work: list[ApprovedWork]
    updates: list[TeamUpdate]
    synthetic: Literal[True] = True


class ShiftPlan(Model):
    id: PlanId
    scenario_id: Identifier
    as_of: AwareDatetime
    review_by: AwareDatetime | None
    items: list[PlanItem]
    baseline_eligible_count: int = Field(ge=0)
    proposed_eligible_count: int = Field(ge=0)
    assumptions: list[str]
    planner_version: Literal["routes-v2"] = "routes-v2"
    approval: Approval | None = None


class ApprovalRequest(Model):
    plan_id: PlanId
    as_of: AwareDatetime | None = None


class RecoveryCandidate(Model):
    id: Identifier
    task_id: Identifier
    machine_id: Identifier
    route_id: Identifier
    ground: Evaluation
    blocking_task_ids: list[Identifier]
    required_hours: Positive
    available_hours: float = Field(ge=0)
    eligible: bool
    reasons: list[Reason]


RecoveryDisposition = Literal["completed", "ready", "held", "deferred"]
RecoveryAction = Literal["retain", "reroute", "reassign", "pull_forward"]


class RecoveryItem(Model):
    task_id: Identifier
    state: TaskState
    bucket: WorkBucket
    baseline_candidate_id: Identifier | None
    selected_candidate_id: Identifier | None
    blocking_task_ids: list[Identifier]
    disposition: RecoveryDisposition
    action: RecoveryAction | None
    reasons: list[Reason]


class ResourceCapacity(Model):
    machine_id: Identifier
    available_hours: float = Field(ge=0)
    reserved_in_progress_hours: float = Field(ge=0)
    original_planned_hours: float = Field(ge=0)
    proposed_hours: float = Field(ge=0)
    unallocated_hours: float = Field(ge=0)


class Disruption(Model):
    original_task_ids: list[Identifier]
    affected_original_task_ids: list[Identifier]
    dependency_blocked_task_ids: list[Identifier]
    affected_planned_hours: float = Field(ge=0)
    rerouted_task_ids: list[Identifier]
    reassigned_task_ids: list[Identifier]
    pulled_forward_task_ids: list[Identifier]
    preserved_original_task_ids: list[Identifier]


class RecoveryPlan(Model):
    id: PlanId
    scenario_id: Identifier
    as_of: AwareDatetime
    review_by: AwareDatetime | None
    planner_version: Literal["recovery-v1"] = "recovery-v1"
    items: list[RecoveryItem]
    candidates: list[RecoveryCandidate]
    selected_candidate_ids: list[Identifier]
    resources: list[ResourceCapacity]
    disruption: Disruption
    assumptions: list[str]
    approval: Approval | None = None


class RecoveryRequest(Model):
    as_of: AwareDatetime | None = None
    candidate_ids: list[Identifier] | None = Field(default=None, max_length=32)


class RecoveryApprovalRequest(RecoveryRequest):
    plan_id: PlanId
