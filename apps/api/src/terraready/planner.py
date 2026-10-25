"""Deterministic route comparison and local briefs; no dispatch or model calls."""

from datetime import datetime
from zoneinfo import ZoneInfo

from terraready.engine import SEVERITY, evaluate
from terraready.models import (
    Approval,
    ApprovedWork,
    DecisionStatus,
    EvaluationRequest,
    PlanItem,
    ShiftPlan,
    SiteSnapshot,
    TaskState,
    TeamUpdate,
    WorkBucket,
)
from terraready.planning import blocking_tasks, capacity_hours, evidence_review_by, fingerprint


def build_plan(site: SiteSnapshot, as_of: datetime | None = None) -> ShiftPlan:
    clock = as_of or site.scenario.as_of
    items = []
    routes = {route.id: route for route in site.routes}
    capacity = capacity_hours(site, clock)
    reserved = {
        machine.id: sum(
            task.remaining_hours
            for task in site.tasks
            if task.state == TaskState.IN_PROGRESS and task.assigned_machine_id == machine.id
        )
        for machine in site.machines
    }
    remaining = {key: max(0, capacity[key] - reserved[key]) for key in capacity}
    baseline_remaining = remaining.copy()
    original_eligible = 0
    for task in sorted(
        (t for t in site.tasks if t.bucket == WorkBucket.TODAY and t.state != TaskState.COMPLETED),
        key=lambda task: (task.state != TaskState.IN_PROGRESS, task.priority, task.id),
    ):
        candidates = [
            evaluate(
                site,
                EvaluationRequest(
                    task_id=task.id,
                    machine_id=task.assigned_machine_id,
                    route_id=route.id,
                    as_of=clock,
                ),
            )
            for route in sorted(site.routes, key=lambda route: route.id)
            if task.zone_id in route.zone_ids
        ]
        best = min(
            candidates,
            key=lambda result: (
                SEVERITY[result.status],
                routes[result.route_id].distance_m,
                result.route_id,
            ),
        )
        blockers = blocking_tasks(site, task)
        budget = (
            capacity[task.assigned_machine_id]
            - reserved[task.assigned_machine_id]
            + task.remaining_hours
            if task.state == TaskState.IN_PROGRESS
            else remaining[task.assigned_machine_id]
        )
        permitted = not blockers and task.remaining_hours <= budget
        baseline = next(result for result in candidates if result.route_id == task.route_id)
        baseline_budget = (
            budget
            if task.state == TaskState.IN_PROGRESS
            else baseline_remaining[task.assigned_machine_id]
        )
        baseline_permitted = not blockers and task.remaining_hours <= baseline_budget
        if baseline.status == DecisionStatus.GO and baseline_permitted:
            original_eligible += 1
            if task.state != TaskState.IN_PROGRESS:
                baseline_remaining[task.assigned_machine_id] -= task.remaining_hours
        selected = best.route_id if best.status == DecisionStatus.GO and permitted else None
        if selected and task.state != TaskState.IN_PROGRESS:
            remaining[task.assigned_machine_id] -= task.remaining_hours
        items.append(
            PlanItem(
                task_id=task.id,
                baseline=baseline,
                alternatives=candidates,
                selected_route_id=selected,
                status=best.status
                if permitted or best.status == DecisionStatus.NO_GO
                else DecisionStatus.INSPECT,
                blocking_task_ids=blockers,
            )
        )
    selected_results = [
        result
        for item in items
        for result in item.alternatives
        if result.route_id == item.selected_route_id
    ]
    return ShiftPlan(
        id=fingerprint(site, clock, "routes-v2"),
        scenario_id=site.scenario.id,
        as_of=clock,
        review_by=evidence_review_by(site, clock, selected_results),
        items=items,
        baseline_eligible_count=original_eligible,
        proposed_eligible_count=len(selected_results),
        assumptions=[
            "Assigned equipment is fixed. Eligible routes rank by synthetic distance, "
            "then route ID.",
            "Eligibility is assessed now, not guaranteed for the planned duration. Recheck after "
            "conditions change and before the evidence-review deadline.",
            "Targets are not production forecasts. Prerequisites must actually be complete; "
            "approval does not complete work. Resource-hour budgets are synthetic estimates; "
            "travel time and exact shift scheduling are not modeled.",
            "Approval is a local demo record, not a safety clearance or machine dispatch.",
        ],
    )


def make_approval(site: SiteSnapshot, plan: ShiftPlan, approved_at: datetime) -> Approval:
    """Called only after the API has recomputed and checked the proposal."""
    tasks = {task.id: task for task in site.tasks}
    routes = {route.id: route for route in site.routes}
    machines = {machine.id: machine for machine in site.machines}
    zones = {zone.id: zone for zone in site.zones}
    work = []
    eligible_lines = []
    held_lines = []
    inspection_zones: set[str] = set()
    for item in plan.items:
        task = tasks[item.task_id]
        chosen = next(
            (result for result in item.alternatives if result.route_id == item.selected_route_id),
            None,
        )
        work.append(
            ApprovedWork(
                task_id=task.id,
                machine_id=task.assigned_machine_id,
                route_id=item.selected_route_id,
                status=item.status,
                evidence_ids=chosen.evidence_ids if chosen else item.baseline.evidence_ids,
            )
        )
        for result in [item.baseline, *([chosen] if chosen else [])]:
            inspection_zones.update(
                decision.zone_id
                for decision in result.zone_decisions
                if decision.status != DecisionStatus.GO
            )
        if chosen:
            unit = "m³" if task.quantity_unit == "m3" else task.quantity_unit
            eligible_lines.append(
                f"- {task.name}: {machines[task.assigned_machine_id].name}, "
                f"{routes[chosen.route_id].name}; target {task.target_quantity:g} {unit}."
                + (
                    f" Replaces {routes[item.baseline.route_id].name} "
                    f"({item.baseline.status.value} for this machine)."
                    if chosen.route_id != item.baseline.route_id
                    else " Original route retained."
                )
            )
        else:
            held_lines.append(f"- HOLD {task.name}: {item.status.value}; no route authorized.")

    clock_label = plan.as_of.astimezone(ZoneInfo("America/Los_Angeles")).strftime("%b %d, %H:%M %Z")
    deadline = (
        plan.review_by.astimezone(ZoneInfo("America/Los_Angeles")).strftime("%H:%M %Z")
        if plan.review_by
        else "fresh evidence is available"
    )
    context = (
        f"TerraReady synthetic demo · assessed {clock_label}.\n"
        f"Local superintendent approval · plan {plan.id[:12]}. "
        "Nothing has been sent or dispatched.\n"
    )
    holds = "\n".join(held_lines) or "No tasks currently held."
    field = (
        context
        + "\nInspection / reconciliation needed: "
        + (", ".join(zones[zone_id].name for zone_id in sorted(inspection_zones)) or "none flagged")
        + ". Assess from verified safe access only; this brief does not authorize entry onto "
        "unverified ground. Return timestamped access, moisture and bearing observations.\n\n"
        + holds
        + f"\n\nRecheck eligible work before {deadline}, or immediately if conditions change. "
        "Held work stays held until new evidence is assessed."
    )
    haul = (
        context
        + "\nEligible work at this evidence clock:\n"
        + "\n".join(eligible_lines)
        + "\n\n"
        + holds
        + f"\n\nReview evidence before {deadline}; do not assume eligibility for the whole shift. "
        "Targets are planned, not guaranteed. Coordinate task sequence and shared-resource "
        "constraints separately. Demo approval is not a real-world safety clearance."
    )
    return Approval(
        plan_id=plan.id,
        scenario_id=plan.scenario_id,
        evaluated_at=plan.as_of,
        approved_at=approved_at,
        work=work,
        updates=[
            TeamUpdate(role="Field lead", title="Ground checks & held work", body=field),
            TeamUpdate(role="Haul coordinator", title="Revised access & work targets", body=haul),
        ],
    )
