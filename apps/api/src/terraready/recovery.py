"""Bounded work recovery: explicit prerequisites and serial resource-hour budgets."""

import hashlib
from datetime import datetime

from terraready.engine import InvalidEvaluation, evaluate
from terraready.models import (
    Approval,
    ApprovedWork,
    DecisionStatus,
    Disruption,
    EvaluationRequest,
    Reason,
    RecoveryAction,
    RecoveryCandidate,
    RecoveryDisposition,
    RecoveryItem,
    RecoveryPlan,
    RecoveryRequest,
    ResourceCapacity,
    SiteSnapshot,
    Task,
    TaskState,
    TeamUpdate,
    WorkBucket,
)
from terraready.planning import blocking_tasks, capacity_hours, evidence_review_by, fingerprint


def _candidate_id(task_id: str, machine_id: str, route_id: str) -> str:
    return "c-" + hashlib.sha256(f"{task_id}/{machine_id}/{route_id}".encode()).hexdigest()[:24]


def _ordered_tasks(site: SiteSnapshot) -> list[Task]:
    return sorted(
        site.tasks,
        key=lambda t: (
            t.state != TaskState.IN_PROGRESS,
            t.bucket != WorkBucket.TODAY,
            t.priority,
            t.id,
        ),
    )


def build_recovery(site: SiteSnapshot, request: RecoveryRequest | None = None) -> RecoveryPlan:
    request = request or RecoveryRequest()
    clock = request.as_of or site.scenario.as_of
    if clock < site.scenario.as_of:
        raise InvalidEvaluation("Clock cannot precede the scenario snapshot.")
    if site.scenario.schema_version != 2:
        raise InvalidEvaluation(
            "Recovery needs the v2 work docket. Stop the API and run make seed."
        )
    tasks = {task.id: task for task in site.tasks}
    ordered = _ordered_tasks(site)
    capacity = capacity_hours(site, clock)
    reserved = {
        machine.id: sum(
            t.remaining_hours
            for t in site.tasks
            if t.state == TaskState.IN_PROGRESS and t.assigned_machine_id == machine.id
        )
        for machine in site.machines
    }
    candidates = []
    for task in ordered:
        if task.state == TaskState.COMPLETED:
            continue
        blockers = blocking_tasks(site, task)
        for machine in sorted(site.machines, key=lambda m: m.id):
            for route in sorted(site.routes, key=lambda r: r.id):
                if task.zone_id not in route.zone_ids:
                    continue
                ground = evaluate(
                    site,
                    EvaluationRequest(
                        task_id=task.id, machine_id=machine.id, route_id=route.id, as_of=clock
                    ),
                )
                own_reservation = (
                    task.remaining_hours
                    if task.state == TaskState.IN_PROGRESS
                    and task.assigned_machine_id == machine.id
                    else 0
                )
                available = max(0, capacity[machine.id] - reserved[machine.id] + own_reservation)
                reasons = []
                if ground.status != DecisionStatus.GO:
                    reasons.append(
                        Reason(
                            code="GROUND_OR_CAPABILITY",
                            message=f"Ground/capability assessment is {ground.status.value}.",
                            evidence_ids=ground.evidence_ids,
                        )
                    )
                if blockers:
                    reasons.append(
                        Reason(
                            code="UNFINISHED_PREREQUISITES",
                            message="Actual completion required: " + ", ".join(blockers),
                        )
                    )
                if task.state == TaskState.IN_PROGRESS and machine.id != task.assigned_machine_id:
                    reasons.append(
                        Reason(
                            code="IN_PROGRESS_LOCK",
                            message="In-progress work stays with its current paired resource; "
                            "no automatic preemption.",
                        )
                    )
                if task.remaining_hours > available:
                    reasons.append(
                        Reason(
                            code="CAPACITY_LIMIT",
                            message=f"Requires {task.remaining_hours:g} planned hours; "
                            f"{available:g} available.",
                        )
                    )
                candidates.append(
                    RecoveryCandidate(
                        id=_candidate_id(task.id, machine.id, route.id),
                        task_id=task.id,
                        machine_id=machine.id,
                        route_id=route.id,
                        ground=ground,
                        blocking_task_ids=blockers,
                        required_hours=task.remaining_hours,
                        available_hours=available,
                        eligible=not reasons,
                        reasons=reasons,
                    )
                )
    by_id = {candidate.id: candidate for candidate in candidates}
    by_task = {task.id: [c for c in candidates if c.task_id == task.id] for task in ordered}
    baseline_ids: dict[str, str] = {}
    baseline_ok: set[str] = set()
    baseline_budget = {key: max(0, capacity[key] - reserved[key]) for key in capacity}
    budget = baseline_budget.copy()
    automatic: list[str] = []
    distances = {route.id: route.distance_m for route in site.routes}
    for task in ordered:
        if task.state == TaskState.COMPLETED:
            continue
        baseline = by_id[_candidate_id(task.id, task.assigned_machine_id, task.route_id)]
        baseline_ids[task.id] = baseline.id
        if (
            task.bucket == WorkBucket.TODAY
            and baseline.eligible
            and (
                task.state == TaskState.IN_PROGRESS
                or baseline.required_hours <= baseline_budget[baseline.machine_id]
            )
        ):
            baseline_ok.add(task.id)
            if task.state != TaskState.IN_PROGRESS:
                baseline_budget[baseline.machine_id] -= baseline.required_hours
        available_candidates = [
            c
            for c in by_task[task.id]
            if c.eligible
            and (task.state == TaskState.IN_PROGRESS or c.required_hours <= budget[c.machine_id])
        ]
        if available_candidates:
            best = min(
                available_candidates,
                key=lambda c: (
                    c.machine_id != task.assigned_machine_id,
                    c.route_id != task.route_id,
                    distances[c.route_id],
                    c.id,
                ),
            )
            automatic.append(best.id)
            if task.state != TaskState.IN_PROGRESS:
                budget[best.machine_id] -= best.required_hours
    selection = automatic if request.candidate_ids is None else request.candidate_ids
    if len(set(selection)) != len(selection):
        raise InvalidEvaluation("Duplicate candidate IDs are not allowed.")
    selected = []
    selected_tasks: set[str] = set()
    extra_hours = {key: 0.0 for key in capacity}
    for candidate_id in selection:
        candidate = by_id.get(candidate_id)
        if candidate is None or not candidate.eligible:
            raise InvalidEvaluation("Selection contains an unknown or ineligible candidate.")
        if candidate.task_id in selected_tasks:
            raise InvalidEvaluation("A work package cannot be assigned twice.")
        selected_tasks.add(candidate.task_id)
        selected.append(candidate)
        if tasks[candidate.task_id].state != TaskState.IN_PROGRESS:
            extra_hours[candidate.machine_id] += candidate.required_hours
    if any(extra_hours[key] > max(0, capacity[key] - reserved[key]) for key in capacity):
        raise InvalidEvaluation("Selected work exceeds a paired resource's remaining capacity.")
    selected.sort(key=lambda c: next(i for i, task in enumerate(ordered) if task.id == c.task_id))
    chosen = {candidate.task_id: candidate for candidate in selected}
    items = []
    for task in ordered:
        candidate = chosen.get(task.id)
        blockers = blocking_tasks(site, task) if task.state != TaskState.COMPLETED else []
        action: RecoveryAction | None = None
        disposition: RecoveryDisposition
        reasons = []
        if task.state == TaskState.COMPLETED:
            disposition = "completed"
        elif candidate:
            disposition = "ready"
            action = (
                "pull_forward"
                if task.bucket == WorkBucket.UPCOMING
                else "reassign"
                if candidate.machine_id != task.assigned_machine_id
                else "reroute"
                if candidate.route_id != task.route_id
                else "retain"
            )
        else:
            feasible = [c for c in by_task[task.id] if c.eligible]
            fits = any(
                c.required_hours
                <= max(
                    0, capacity[c.machine_id] - reserved[c.machine_id] - extra_hours[c.machine_id]
                )
                for c in feasible
            )
            disposition = "deferred" if fits else "held"
            reasons = (
                by_id[baseline_ids[task.id]].reasons
                if not feasible
                else [
                    Reason(
                        code="NOT_SELECTED" if fits else "CAPACITY_RESERVED",
                        message="Not selected for this proposal."
                        if fits
                        else "Remaining paired-resource capacity is reserved by the selected work.",
                    )
                ]
            )
        items.append(
            RecoveryItem(
                task_id=task.id,
                state=task.state,
                bucket=task.bucket,
                baseline_candidate_id=baseline_ids.get(task.id),
                selected_candidate_id=candidate.id if candidate else None,
                blocking_task_ids=blockers,
                disposition=disposition,
                action=action,
                reasons=reasons,
            )
        )
    original = [
        t for t in ordered if t.bucket == WorkBucket.TODAY and t.state != TaskState.COMPLETED
    ]
    affected = [t for t in original if t.id not in baseline_ok]
    return RecoveryPlan(
        id=fingerprint(site, clock, "recovery-v1", [c.id for c in selected]),
        scenario_id=site.scenario.id,
        as_of=clock,
        review_by=evidence_review_by(site, clock, [c.ground for c in selected]),
        items=items,
        candidates=candidates,
        selected_candidate_ids=[c.id for c in selected],
        resources=[
            ResourceCapacity(
                machine_id=key,
                available_hours=capacity[key],
                reserved_in_progress_hours=reserved[key],
                original_planned_hours=sum(
                    t.remaining_hours for t in original if t.assigned_machine_id == key
                ),
                proposed_hours=sum(c.required_hours for c in selected if c.machine_id == key),
                unallocated_hours=max(0, capacity[key] - reserved[key] - extra_hours[key]),
            )
            for key in sorted(capacity)
        ],
        disruption=Disruption(
            original_task_ids=[t.id for t in original],
            affected_original_task_ids=[t.id for t in affected],
            dependency_blocked_task_ids=[i.task_id for i in items if i.blocking_task_ids],
            affected_planned_hours=sum(t.remaining_hours for t in affected),
            rerouted_task_ids=[
                c.task_id for c in selected if c.route_id != tasks[c.task_id].route_id
            ],
            reassigned_task_ids=[
                c.task_id for c in selected if c.machine_id != tasks[c.task_id].assigned_machine_id
            ],
            pulled_forward_task_ids=[
                c.task_id for c in selected if tasks[c.task_id].bucket == WorkBucket.UPCOMING
            ],
            preserved_original_task_ids=[t.id for t in original if t.id in chosen],
        ),
        assumptions=[
            "One equipment/operator pair per resource; capacities and remaining effort "
            "are synthetic estimates.",
            "Selected tasks use serial resource-hour budgets, not a timed or optimal schedule; "
            "travel is not modeled.",
            "Only actual fixture completion satisfies prerequisites. "
            "Approval never marks work completed.",
            "In-progress effort remains reserved even when held; stopping or preempting it "
            "needs a new reviewed snapshot.",
            "Eligibility applies at this evidence clock, not throughout planned durations; "
            "recheck before the deadline or when conditions change.",
            "Affected/allocated hours are planned effort, not measured idle time, "
            "guaranteed production or savings.",
        ],
    )


def make_recovery_approval(
    site: SiteSnapshot, plan: RecoveryPlan, approved_at: datetime
) -> Approval:
    tasks = {task.id: task for task in site.tasks}
    machines = {machine.id: machine for machine in site.machines}
    routes = {route.id: route for route in site.routes}
    selected = {c.id: c for c in plan.candidates if c.id in plan.selected_candidate_ids}
    work = []
    eligible_lines = []
    hold_lines = []
    for item in plan.items:
        if item.state == TaskState.COMPLETED:
            continue
        task = tasks[item.task_id]
        candidate = selected.get(item.selected_candidate_id or "")
        work.append(
            ApprovedWork(
                task_id=task.id,
                machine_id=candidate.machine_id if candidate else task.assigned_machine_id,
                route_id=candidate.route_id if candidate else None,
                status=DecisionStatus.GO if candidate else DecisionStatus.INSPECT,
                evidence_ids=candidate.ground.evidence_ids if candidate else [],
            )
        )
        if candidate:
            eligible_lines.append(
                f"- {task.name}: {machines[candidate.machine_id].name}; "
                f"{routes[candidate.route_id].name}; {candidate.required_hours:g}h planned "
                f"({item.action})."
            )
        else:
            hold_lines.append(f"- HOLD {task.name}: " + "; ".join(r.message for r in item.reasons))
    context = (
        f"TerraReady synthetic demo · assessed {plan.as_of.isoformat()} · "
        f"local plan {plan.id[:12]}. Nothing sent or dispatched.\n\n"
    )
    holds = "\n".join(hold_lines) or "No work held."
    deadline = plan.review_by.isoformat() if plan.review_by else "fresh checks required"
    return Approval(
        plan_id=plan.id,
        scenario_id=plan.scenario_id,
        evaluated_at=plan.as_of,
        approved_at=approved_at,
        planner_version="recovery-v1",
        work=work,
        updates=[
            TeamUpdate(
                role="Field lead",
                title="Ground checks, prerequisites & holds",
                body=context
                + holds
                + "\n\nInspect from verified safe access only; no entry onto unverified ground "
                "is authorized. Return timestamped ground evidence. Actual completion must "
                "be recorded before dependent work can proceed. "
                "This approval does not complete any work.",
            ),
            TeamUpdate(
                role="Haul coordinator",
                title="Recovered work & resource assignments",
                body=context
                + "\n".join(eligible_lines)
                + "\n\n"
                + holds
                + f"\n\nEvidence review: {deadline}, or sooner if conditions change. "
                "Serial planned hours are not a timed schedule or guaranteed savings. "
                "This is not a real-world safety clearance.",
            ),
        ],
    )
