"""Typed, sanitized historical verification, independent of live runtime reachability."""

from math import ceil
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


class GpuTestEvidence(Model):
    provider: Literal["Runpod"]
    gpu_name: str = Field(min_length=1, max_length=100)
    gpu_count: Literal[1]
    gpu_vram_mib: int = Field(gt=0)
    driver_version: str = Field(min_length=1, max_length=50)
    region: str = Field(min_length=1, max_length=50)
    container_image_sha256: PlanId
    container_memory_limit_bytes: int = Field(gt=0)
    allocated_vcpu: int = Field(gt=0, le=256)
    cpu_quota_cores: float = Field(gt=0, le=256)
    sampled_peak_gpu_mib: int = Field(ge=0)
    sampled_peak_container_memory_bytes: int = Field(ge=0)
    sampled_services_rss_kib: int = Field(ge=0)
    resource_sample_count: int = Field(gt=0)
    sample_interval_seconds: float = Field(gt=0, le=60)
    stack_ready_seconds: float = Field(ge=0)
    first_request_ms: float = Field(ge=0, le=240000)
    warm_request_ms: list[float] = Field(min_length=1, max_length=1000)
    warm_passed: int = Field(ge=0)
    warm_p50_ms: float = Field(ge=0, le=240000)
    warm_p95_ms: float = Field(ge=0, le=240000)
    browser_journey_passed: bool
    model_outage_passed: bool
    evidence_expiry_passed: bool
    restart_probe_passed: bool
    operating_snapshot_unchanged: bool
    cleanup_verified: bool
    started_at: AwareDatetime
    terminated_at: AwareDatetime
    billing_status: Literal["pending", "recorded"]
    observed_balance_decrease_usd: float | None = Field(default=None, ge=0)
    provider_charge_usd: float | None = Field(default=None, ge=0)
    usage_ceiling_usd: Literal[5] = 5
    egress_denial: Literal["deferred_unverified"] = "deferred_unverified"

    @model_validator(mode="after")
    def consistent_measurements(self) -> "GpuTestEvidence":
        values = sorted(self.warm_request_ms)
        if any(not 0 <= value <= 240000 for value in values):
            raise ValueError("Invalid latency sample")
        if self.warm_passed > len(values) or (
            self.warm_p50_ms != values[ceil(0.5 * len(values)) - 1]
            or self.warm_p95_ms != values[ceil(0.95 * len(values)) - 1]
        ):
            raise ValueError("Sample counts/nearest-rank percentiles disagree")
        if self.sampled_peak_gpu_mib > self.gpu_vram_mib:
            raise ValueError("GPU peak exceeds recorded device memory")
        if self.terminated_at < self.started_at:
            raise ValueError("Cleanup predates creation")
        if (self.billing_status == "recorded") != (self.provider_charge_usd is not None):
            raise ValueError("A provider charge requires a recorded billing read")
        return self


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
    gpu_test: GpuTestEvidence | None = None

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
    gpu_verification: ArtifactStatus


def load_evidence(directory: Path, *, gpu: bool = False) -> ArtifactStatus:
    path = directory / ("gpu-agent.json" if gpu else "local-agent.json")
    try:
        if not path.exists():
            return ArtifactStatus(status="missing")
        if path.stat().st_size > 262144:
            return ArtifactStatus(status="invalid")
        evidence = VerificationEvidence.model_validate_json(path.read_bytes())
        if gpu and evidence.gpu_test is None:
            return ArtifactStatus(status="invalid")
        return ArtifactStatus(status="recorded", evidence=evidence)
    except (OSError, ValueError, RecursionError):
        return ArtifactStatus(status="invalid")
