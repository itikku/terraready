"""Public assistant contract: checked references, never unvalidated model prose."""

from typing import Literal

from pydantic import AwareDatetime, Field

from terraready.models import Identifier, Model, PlanId

Focus = Literal["overview", "reroute", "redeploy", "blocked"]


class AssistRequest(Model):
    question: str = Field(min_length=1, max_length=500)
    as_of: AwareDatetime | None = None


class CandidateIds(Model):
    candidate_ids: list[Identifier] = Field(min_length=1, max_length=4)


class EvidenceArgs(Model):
    zone_id: Identifier


class ShiftArgs(Model):
    focus: Focus


class FinishArgs(Model):
    focus: Focus
    candidate_ids: list[Identifier] = Field(max_length=4)
    held_task_ids: list[Identifier] = Field(max_length=8)


class ToolTrace(Model):
    step: int = Field(ge=1, le=5)
    tool: str = Field(max_length=40)
    outcome: Literal["ok", "rejected"]
    reference_ids: list[Identifier]
    evidence_ids: list[Identifier]
    elapsed_ms: int = Field(ge=0)
    inference_ms: int = Field(ge=0)
    completion_tokens: int = Field(ge=0, le=192)


class AssistFact(Model):
    task_id: Identifier
    candidate_id: Identifier | None
    text: str
    evidence_ids: list[Identifier]


class AssistRun(Model):
    id: Identifier
    scenario_id: Identifier
    source_plan_id: PlanId
    evaluated_at: AwareDatetime
    created_at: AwareDatetime
    mode: Literal["local_model", "test_stub", "deterministic_fallback"]
    model_id: str
    agent_version: Literal["assist-v1"] = "assist-v1"
    focus: Focus
    candidate_ids: list[Identifier]
    held_task_ids: list[Identifier]
    facts: list[AssistFact]
    trace: list[ToolTrace]
    elapsed_ms: int = Field(ge=0)
    completion_tokens: int = Field(ge=0)
    fallback_reason: Literal["unavailable", "timeout", "invalid_output", "budget", "busy"] | None
    saved_locally: bool = False
    requires_approval: Literal[True] = True
