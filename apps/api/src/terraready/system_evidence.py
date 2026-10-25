"""Typed, sanitized historical verification, independent of live runtime reachability."""

from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from terraready.models import Identifier, Model, PlanId


class SmokeCase(Model):
    name: Literal["reroute", "redeploy", "blocked"]
    passed: bool
    mode: Literal["local_model"]
    elapsed_ms: int = Field(ge=0, le=240000)
    tools: list[Literal["get_shift", "evaluate_candidates", "get_evidence", "finish_analysis"]] = (
        Field(min_length=1, max_length=5)
    )
    task_ids: list[Identifier] = Field(max_length=8)
    evidence_ids: list[Identifier] = Field(max_length=32)


class ModelEvidence(Model):
    model_id: str = Field(min_length=1, max_length=100)
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    weights_sha256: PlanId
    license: Literal["Apache-2.0"]
    runtime_tag: str = Field(pattern=r"^b[0-9]+$")
    runtime_commit: str = Field(pattern=r"^[a-f0-9]{40}$")


class HardwareEvidence(Model):
    host: str = Field(min_length=1, max_length=150)
    os: str = Field(min_length=1, max_length=200)
    architecture: str = Field(min_length=1, max_length=50)
    host_memory_bytes: int | None = Field(default=None, gt=0)
    gpu_layers_requested: int = Field(ge=0, le=999)
    cpu_threads: int = Field(ge=1, le=256)
    context_size: int = Field(ge=1, le=131072)


class VerificationEvidence(Model):
    schema_version: Literal[1] = 1
    kind: Literal["real_local_model_smoke"]
    recorded_at: AwareDatetime
    source_base_commit: str = Field(pattern=r"^[a-f0-9]{40}$")
    working_tree_dirty: bool
    source_sha256: dict[str, PlanId] = Field(min_length=1, max_length=20)
    dataset_sha256: PlanId
    model: ModelEvidence
    hardware: HardwareEvidence
    cases: list[SmokeCase] = Field(min_length=1, max_length=32)
    completed: Literal[True]
    limitations: list[str] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def complete_case_set(self) -> "VerificationEvidence":
        if len(self.cases) != 3 or {c.name for c in self.cases} != {
            "reroute",
            "redeploy",
            "blocked",
        }:
            raise ValueError("A completed three-case smoke requires distinct named cases")
        for case in self.cases:
            expected = "get_evidence" if case.name == "blocked" else "evaluate_candidates"
            if case.passed and (
                case.tools[0] != "get_shift"
                or case.tools[-1] != "finish_analysis"
                or expected not in case.tools
                or not case.evidence_ids
            ):
                raise ValueError("Passed case lacks required observable tool/evidence facts")
        return self


class ArtifactStatus(Model):
    status: Literal["recorded", "missing", "invalid"]
    evidence: VerificationEvidence | None = None


class RuntimeStatus(Model):
    reachable: bool
    mode: Literal["local_model", "test_stub"]
    model_id: str
    checked_at: AwareDatetime
    meaning: Literal["Authenticated model-list probe only; not an inference or quality test."] = (
        "Authenticated model-list probe only; not an inference or quality test."
    )


class SystemEvidence(Model):
    data_ready: bool
    runtime: RuntimeStatus
    verification: ArtifactStatus


def load_evidence(directory: Path) -> ArtifactStatus:
    path = directory / "local-agent.json"
    try:
        if not path.exists():
            return ArtifactStatus(status="missing")
        if path.stat().st_size > 262144:
            return ArtifactStatus(status="invalid")
        return ArtifactStatus(
            status="recorded", evidence=VerificationEvidence.model_validate_json(path.read_bytes())
        )
    except (OSError, ValueError, RecursionError):
        return ArtifactStatus(status="invalid")
