"""Shared pure planning facts; ground feasibility stays in the decision engine."""

import hashlib
import json
from datetime import UTC, datetime, timedelta

from terraready.models import Evaluation, SiteSnapshot, Task, TaskState


def _canonical_time(value: object) -> str:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    raise TypeError("Unsupported fingerprint value")


def fingerprint(
    site: SiteSnapshot, clock: datetime, version: str, selection: list[str] | None = None
) -> str:
    return hashlib.sha256(
        json.dumps(
            {
                "snapshot": site.model_dump(),
                "as_of": clock,
                "planner_version": version,
                "decision_policy": "demo-v1",
                "selection": sorted(selection) if selection is not None else None,
            },
            sort_keys=True,
            default=_canonical_time,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def blocking_tasks(site: SiteSnapshot, task: Task) -> list[str]:
    tasks = {item.id: item for item in site.tasks}
    pending = list(task.prerequisite_ids)
    blocked: set[str] = set()
    while pending:
        prerequisite = tasks[pending.pop()]
        if prerequisite.state != TaskState.COMPLETED and prerequisite.id not in blocked:
            blocked.add(prerequisite.id)
            pending.extend(prerequisite.prerequisite_ids)
    return sorted(blocked)


def capacity_hours(site: SiteSnapshot, clock: datetime) -> dict[str, float]:
    elapsed = (clock - site.scenario.as_of).total_seconds() / 3600
    return {machine.id: max(0, machine.available_hours - elapsed) for machine in site.machines}


def evidence_review_by(
    site: SiteSnapshot, clock: datetime, evaluations: list[Evaluation]
) -> datetime | None:
    used = {evidence_id for result in evaluations for evidence_id in result.evidence_ids}
    expiries = [
        obs.observed_at + timedelta(hours=site.scenario.max_evidence_age_hours)
        for obs in site.observations
        if obs.id in used
        and site.scenario.rain_ended_at <= obs.observed_at <= clock
        and obs.confidence >= site.scenario.min_evidence_confidence
        and obs.observed_at + timedelta(hours=site.scenario.max_evidence_age_hours) >= clock
    ]
    return min(expiries) if expiries else None
