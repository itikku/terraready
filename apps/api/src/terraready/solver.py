"""CPU CP-SAT what-ifs over explicit synthetic production assumptions.

Ground evidence and actual prerequisites remain authoritative outside the solver.
The returned schedule is independently checked and is never an approval or dispatch.
"""

import hashlib
import json
from collections import defaultdict
from decimal import ROUND_FLOOR, Decimal
from importlib.metadata import version
from typing import Literal

from ortools.sat.python import cp_model

from terraready.engine import SEVERITY, InvalidEvaluation, UnknownEntity, evaluate, evaluate_zone
from terraready.models import (
    DecisionStatus,
    Evaluation,
    EvaluationRequest,
    Reason,
    RecoveryPlan,
    RecoveryRequest,
    SiteSnapshot,
    Task,
)
from terraready.planning import blocking_tasks, capacity_hours, evidence_review_by
from terraready.recovery import build_recovery
from terraready.solver_models import (
    ProductionAssumptions,
    ScheduleActivity,
    SolverCaseResult,
    SolverInputs,
    SolverJob,
    SuggestionIntent,
    SuggestionSolverResult,
    TripSchedule,
    WorkSuggestionRequest,
)
from terraready.solver_models import (
    load_production_assumptions as load_production_assumptions,
)

Case = Literal["requested", "minimum_fleet", "minimum_overtime", "maximum_volume"]
MAX_OVERTIME_MINUTES = 120
SOLVE_SECONDS = 2.0
SOLVE_DETERMINISTIC_SECONDS = 0.5


class StaleSuggestion(InvalidEvaluation):
    """A suggestion belongs to a different snapshot, clock or selected draft."""


def suggestion_source(site: SiteSnapshot, request: WorkSuggestionRequest) -> RecoveryPlan:
    """Bind the exact editable draft before interpreting or solving its suggestion."""
    plan = build_recovery(
        site,
        RecoveryRequest(as_of=request.as_of, candidate_ids=request.current_candidate_ids),
    )
    if request.source_plan_id is not None and request.source_plan_id != plan.id:
        raise StaleSuggestion("The work, evidence clock or selected draft changed. Check it again.")
    return plan


def _duration_minutes(hours: float) -> int:
    minutes = Decimal(str(hours)) * 60
    if minutes != minutes.to_integral_value() or not 0 < minutes <= 600:
        raise InvalidEvaluation(
            "Production what-ifs require whole-minute remaining task estimates."
        )
    return int(minutes)


def _inputs(
    site: SiteSnapshot,
    plan: RecoveryPlan,
    task: Task,
    intent: SuggestionIntent,
    profile: ProductionAssumptions,
) -> SolverInputs:
    tasks = {item.id: item for item in site.tasks}
    if (
        not {
            profile.haul_task_id,
            profile.preparation_task_id,
            profile.drainage_task_id,
        }
        <= tasks.keys()
    ):
        raise InvalidEvaluation("This site does not match the synthetic production profile.")
    if task.id != profile.haul_task_id and (
        intent.target_bank_m3 is not None or intent.max_trucks is not None
    ):
        raise InvalidEvaluation("Quantity and fleet changes apply only to the modeled haul item.")
    selected = [c for c in plan.candidates if c.id in plan.selected_candidate_ids]
    included = {
        c.task_id: c.machine_id for c in selected if intent.keep_other_work or c.task_id == task.id
    }
    included.update(
        {item.id: item.assigned_machine_id for item in site.tasks if item.state == "in_progress"}
    )
    included.setdefault(task.id, task.assigned_machine_id)
    if tasks[profile.haul_task_id].state == "in_progress" and profile.haul_task_id in included:
        raise InvalidEvaluation(
            "An ongoing haul needs explicit remaining volume; this what-if "
            "does not invent progress or preempt it."
        )
    jobs = [
        SolverJob(
            task_id=task_id,
            machine_id=machine_id,
            duration_minutes=_duration_minutes(tasks[task_id].remaining_hours),
            in_progress=tasks[task_id].state == "in_progress",
        )
        for task_id, machine_id in sorted(included.items())
        if task_id != profile.haul_task_id and tasks[task_id].state != "completed"
    ]
    capacities = capacity_hours(site, plan.as_of)
    resource_minutes = {
        key: int((Decimal(str(value)) * 60).to_integral_value(rounding=ROUND_FLOOR))
        for key, value in capacities.items()
    }
    elapsed = Decimal(str((plan.as_of - site.scenario.as_of).total_seconds())) / 60
    remaining_shift = max(
        0, int((profile.shift_minutes - elapsed).to_integral_value(rounding=ROUND_FLOOR))
    )
    return SolverInputs(
        production=profile,
        target_bank_m3=intent.target_bank_m3 or profile.target_bank_m3,
        max_trucks=intent.max_trucks or profile.default_trucks,
        max_overtime_minutes=intent.max_overtime_minutes or 0,
        deadline_minutes=intent.deadline_minutes,
        keep_other_work=intent.keep_other_work,
        retained_task_ids=[job.task_id for job in jobs],
        preparation_minutes=next(
            (job.duration_minutes for job in jobs if job.task_id == profile.preparation_task_id), 0
        ),
        drainage_minutes=next(
            (job.duration_minutes for job in jobs if job.task_id == profile.drainage_task_id), 0
        ),
        shift_minutes=remaining_shift,
        include_haul=profile.haul_task_id in included,
        jobs=jobs,
        resource_minutes=resource_minutes,
    )


def _case_limits(inputs: SolverInputs, case: Case) -> tuple[int, int]:
    fleet = inputs.production.maximum_trucks if case == "minimum_fleet" else inputs.max_trucks
    overtime = MAX_OVERTIME_MINUTES if case == "minimum_overtime" else inputs.max_overtime_minutes
    return fleet, overtime


def _activities(
    inputs: SolverInputs, job_starts: dict[str, int], trips: list[TripSchedule]
) -> list[ScheduleActivity]:
    result = []
    profile = inputs.production
    for job in inputs.jobs:
        job_kind: Literal["preparation", "drainage", "retained_work"] = (
            "preparation"
            if job.task_id == profile.preparation_task_id
            else "drainage"
            if job.task_id == profile.drainage_task_id
            else "retained_work"
        )
        result.append(
            ScheduleActivity(
                id=f"work-{job.task_id}",
                task_id=job.task_id,
                resource_id=job.machine_id,
                kind=job_kind,
                start_minutes=job_starts[job.task_id],
                end_minutes=job_starts[job.task_id] + job.duration_minutes,
            )
        )
    for trip in trips:
        truck_id = (
            profile.truck_machine_id if trip.truck == 1 else f"additional-hauler-{trip.truck}"
        )
        activities: list[tuple[Literal["loading", "truck_cycle", "dumping"], str, int, int]] = [
            ("loading", profile.loader_machine_id, trip.start_minutes, trip.load_end_minutes),
            ("truck_cycle", truck_id, trip.start_minutes, trip.end_minutes),
            ("dumping", "shared-dump", trip.dump_start_minutes, trip.dump_end_minutes),
        ]
        for kind, resource, start, end in activities:
            result.append(
                ScheduleActivity(
                    id=f"trip-{trip.index}-{kind.replace('_', '-')}",
                    task_id=profile.haul_task_id,
                    resource_id=resource,
                    kind=kind,
                    start_minutes=start,
                    end_minutes=end,
                )
            )
    return sorted(result, key=lambda activity: (activity.start_minutes, activity.id))


def verify_schedule(inputs: SolverInputs, task_id: str, result: SolverCaseResult) -> None:
    """Independent arithmetic and interval checks; never invokes the solver."""
    if result.status != "feasible" or result.fleet is None:
        raise ValueError("Only a feasible schedule can be independently verified.")
    profile = inputs.production
    fleet_cap, overtime_cap = _case_limits(inputs, result.case)
    if result.fleet > fleet_cap:
        raise ValueError("Schedule exceeds its fleet allowance.")
    if result.additional_resources_required != max(0, result.fleet - profile.existing_trucks):
        raise ValueError("Additional truck/operator requirements are inconsistent.")
    if [trip.index for trip in result.trips] != list(range(len(result.trips))):
        raise ValueError("Trip identities must be ordered and unique.")
    for trip in result.trips:
        if (
            trip.truck > result.fleet
            or trip.bank_m3 != profile.bank_m3_per_load
            or trip.load_end_minutes != trip.start_minutes + profile.load_minutes
            or trip.dump_start_minutes != trip.load_end_minutes + profile.loaded_travel_minutes
            or trip.dump_end_minutes != trip.dump_start_minutes + profile.dump_minutes
            or trip.end_minutes != trip.dump_end_minutes + profile.return_minutes
        ):
            raise ValueError("Trip timing or quantity conservation failed.")
    job_starts = {
        activity.task_id: activity.start_minutes
        for activity in result.schedule
        if activity.kind in {"preparation", "drainage", "retained_work"}
    }
    if set(job_starts) != {job.task_id for job in inputs.jobs}:
        raise ValueError("Retained work is missing or invented.")
    if any(job.in_progress and job_starts[job.task_id] != 0 for job in inputs.jobs):
        raise ValueError("In-progress work cannot be postponed or preempted.")
    if result.schedule != _activities(inputs, job_starts, result.trips):
        raise ValueError("Activity records do not match the verified cycles and retained work.")
    resources: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for activity in result.schedule:
        resources[activity.resource_id].append((activity.start_minutes, activity.end_minutes))
        if activity.end_minutes > inputs.shift_minutes + overtime_cap:
            raise ValueError("An activity exceeds the shift/overtime window.")
        base_resource = (
            profile.truck_machine_id if activity.kind == "truck_cycle" else activity.resource_id
        )
        if base_resource in inputs.resource_minutes and (
            activity.end_minutes > inputs.resource_minutes[base_resource] + overtime_cap
        ):
            raise ValueError("An activity exceeds its resource availability window.")
    for intervals in resources.values():
        ordered = sorted(intervals)
        if any(a[1] > b[0] for a, b in zip(ordered, ordered[1:], strict=False)):
            raise ValueError("A resource is double-booked.")
    quantity = sum(trip.bank_m3 for trip in result.trips)
    if result.delivered_bank_m3 != quantity or (
        inputs.include_haul and result.case != "maximum_volume" and quantity < inputs.target_bank_m3
    ):
        raise ValueError("The delivered quantity does not meet the modeled target.")
    if not inputs.include_haul and result.trips:
        raise ValueError("Unselected hauling was invented.")
    finish = max((activity.end_minutes for activity in result.schedule), default=0)
    if result.finish_minutes != finish or result.overtime_minutes != max(
        0, finish - inputs.shift_minutes
    ):
        raise ValueError("Finish time or overtime arithmetic failed.")
    target_finish = max(
        (activity.end_minutes for activity in result.schedule if activity.task_id == task_id),
        default=0,
    )
    if inputs.deadline_minutes is not None and target_finish > inputs.deadline_minutes:
        raise ValueError("The scoped item's deadline was exceeded.")
    if result.objective_value is None or result.objective_bound is None:
        raise ValueError("Solver objective evidence is missing.")
    expected_objective = (
        result.fleet
        if result.case == "minimum_fleet"
        else quantity
        if result.case == "maximum_volume"
        else finish
    )
    if result.objective_value != expected_objective:
        raise ValueError("The objective does not match the actual schedule.")
    if (result.case == "maximum_volume" and result.objective_bound < result.objective_value) or (
        result.case != "maximum_volume" and result.objective_bound > result.objective_value
    ):
        raise ValueError("The reported bound cannot bound this feasible schedule.")
    if result.solver_status == "OPTIMAL" and result.objective_value != result.objective_bound:
        raise ValueError("Optimality was claimed without a matching bound.")


def _solve_case(inputs: SolverInputs, task_id: str, case: Case) -> SolverCaseResult:
    profile = inputs.production
    model = cp_model.CpModel()
    fleet = model.new_int_var(1, profile.maximum_trucks, "truck_operator_pairs")
    finish = model.new_int_var(0, 600, "finish_minutes")
    fleet_cap, overtime_cap = _case_limits(inputs, case)
    assumptions: dict[int, str] = {}

    def assume(name: str) -> cp_model.IntVar:
        literal = model.new_bool_var(name)
        assumptions[literal.index] = name
        model.add_assumption(literal)
        return literal

    model.add(fleet <= fleet_cap).only_enforce_if(
        assume(f"Fleet cap: {fleet_cap} truck/operator pairs")
    )
    model.add(finish <= inputs.shift_minutes + overtime_cap).only_enforce_if(
        assume(f"Shift window: {inputs.shift_minutes} minutes + {overtime_cap} overtime")
    )
    deadline_literal = (
        assume(f"Item deadline: {inputs.deadline_minutes} minutes from the evidence clock")
        if inputs.deadline_minutes is not None
        else None
    )
    machine_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    jobs: dict[str, cp_model.IntVar] = {}
    target_ends: list[cp_model.LinearExpr] = []
    for job in inputs.jobs:
        start = model.new_int_var(0, 600 - job.duration_minutes, f"start_{job.task_id}")
        interval = model.new_fixed_size_interval_var(start, job.duration_minutes, job.task_id)
        machine_intervals[job.machine_id].append(interval)
        jobs[job.task_id] = start
        if job.in_progress:
            model.add(start == 0)
        model.add(finish >= start + job.duration_minutes)
        model.add(
            start + job.duration_minutes <= inputs.resource_minutes[job.machine_id] + overtime_cap
        )
        if job.task_id == task_id:
            target_ends.append(start + job.duration_minutes)
    starts, present, truck_intervals, dump_intervals = [], [], [], []
    cycle = (
        profile.load_minutes
        + profile.loaded_travel_minutes
        + profile.dump_minutes
        + profile.return_minutes
    )
    for index in range(profile.maximum_loads if inputs.include_haul else 0):
        start = model.new_int_var(0, 600 - cycle, f"trip_{index}_start")
        use = model.new_bool_var(f"trip_{index}_present")
        starts.append(start)
        present.append(use)
        machine_intervals[profile.loader_machine_id].append(
            model.new_optional_fixed_size_interval_var(
                start, profile.load_minutes, use, f"load_{index}"
            )
        )
        truck_intervals.append(
            model.new_optional_fixed_size_interval_var(start, cycle, use, f"truck_{index}")
        )
        dump_start = start + profile.load_minutes + profile.loaded_travel_minutes
        dump_intervals.append(
            model.new_optional_fixed_size_interval_var(
                dump_start, profile.dump_minutes, use, f"dump_{index}"
            )
        )
        model.add(finish >= start + cycle).only_enforce_if(use)
        model.add(
            start + cycle <= inputs.resource_minutes[profile.truck_machine_id] + overtime_cap
        ).only_enforce_if(use)
        model.add(
            start + profile.load_minutes
            <= inputs.resource_minutes[profile.loader_machine_id] + overtime_cap
        ).only_enforce_if(use)
        if task_id == profile.haul_task_id and deadline_literal is not None:
            model.add(start + cycle <= inputs.deadline_minutes).only_enforce_if(
                [use, deadline_literal]
            )
        if index:
            model.add(present[index - 1] >= use)
            model.add(start >= starts[index - 1]).only_enforce_if(use)
    for intervals in machine_intervals.values():
        model.add_no_overlap(intervals)
    model.add_no_overlap(dump_intervals)
    model.add_cumulative(truck_intervals, [1] * len(truck_intervals), fleet)
    if deadline_literal is not None:
        for target_end in target_ends:
            model.add(target_end <= inputs.deadline_minutes).only_enforce_if(deadline_literal)
    volume = profile.bank_m3_per_load * sum(present)
    if inputs.include_haul and case != "maximum_volume":
        model.add(volume >= inputs.target_bank_m3).only_enforce_if(
            assume(f"Target: at least {inputs.target_bank_m3} bank m3 in completed cycles")
        )
    objective = "minimum finish minutes"
    if case == "minimum_fleet":
        model.minimize(fleet)
        objective = "minimum truck/operator pairs"
    elif case == "maximum_volume":
        model.maximize(volume)
        objective = "maximum delivered bank m3"
    else:
        model.minimize(finish)
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.max_time_in_seconds = SOLVE_SECONDS
    solver.parameters.max_deterministic_time = SOLVE_DETERMINISTIC_SECONDS
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        conflicts = (
            [
                assumptions[index]
                for index in solver.sufficient_assumptions_for_infeasibility()
                if index in assumptions
            ]
            if status == cp_model.INFEASIBLE
            else []
        )
        return SolverCaseResult(
            case=case,
            status="infeasible" if status == cp_model.INFEASIBLE else "unknown",
            solver_status="INFEASIBLE" if status == cp_model.INFEASIBLE else "UNKNOWN",
            message="No schedule satisfies these modeled constraints."
            if status == cp_model.INFEASIBLE
            else "The bounded solver did not establish a result. This is not a NO_GO finding.",
            objective=objective,
            conflicts=conflicts
            or (
                ["Retained work, resource windows and requested constraints cannot fit together."]
                if status == cp_model.INFEASIBLE
                else []
            ),
        )
    trip_starts = [
        solver.value(start) for start, use in zip(starts, present, strict=True) if solver.value(use)
    ]
    used = peak = 0
    for _, change in sorted(
        [(start, 1) for start in trip_starts] + [(start + cycle, -1) for start in trip_starts]
    ):
        used += change
        peak = max(peak, used)
    fleet_count = max(1, peak)
    truck_free = [0] * fleet_count
    trips = []
    for index, (start, use) in enumerate(zip(starts, present, strict=True)):
        if not solver.value(use):
            continue
        beginning = solver.value(start)
        truck = next(i for i, free in enumerate(truck_free) if free <= beginning)
        end = beginning + cycle
        truck_free[truck] = end
        trips.append(
            TripSchedule(
                index=index,
                truck=truck + 1,
                start_minutes=beginning,
                load_end_minutes=beginning + profile.load_minutes,
                dump_start_minutes=beginning + profile.load_minutes + profile.loaded_travel_minutes,
                dump_end_minutes=end - profile.return_minutes,
                end_minutes=end,
                bank_m3=profile.bank_m3_per_load,
            )
        )
    schedule = _activities(inputs, {key: solver.value(value) for key, value in jobs.items()}, trips)
    actual_finish = max((activity.end_minutes for activity in schedule), default=0)
    additional = max(0, fleet_count - profile.existing_trucks)
    result = SolverCaseResult(
        case=case,
        status="feasible",
        solver_status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        message="A checked schedule exists under the stated synthetic assumptions."
        + (
            f" Conditional on obtaining {additional} additional truck/operator pair(s); "
            "they are not current inventory."
            if additional
            else ""
        ),
        fleet=fleet_count,
        delivered_bank_m3=sum(trip.bank_m3 for trip in trips),
        finish_minutes=actual_finish,
        overtime_minutes=max(0, actual_finish - inputs.shift_minutes),
        additional_resources_required=additional,
        objective=objective,
        objective_value=fleet_count
        if case == "minimum_fleet"
        else sum(trip.bank_m3 for trip in trips)
        if case == "maximum_volume"
        else actual_finish,
        objective_bound=solver.best_objective_bound,
        trips=trips,
        schedule=schedule,
    )
    try:
        verify_schedule(inputs, task_id, result)
    except ValueError:
        return SolverCaseResult(
            case=case,
            status="unknown",
            solver_status="UNKNOWN",
            message="Independent verification rejected the solver witness. "
            "No release is established.",
            objective=objective,
        )
    result.verified = True
    return result


def solve_suggestion(
    site: SiteSnapshot, request: WorkSuggestionRequest, intent: SuggestionIntent
) -> SuggestionSolverResult:
    plan = suggestion_source(site, request)
    task = next((task for task in site.tasks if task.id == request.task_id), None)
    if task is None:
        raise UnknownEntity("Unknown suggestion work item.")
    profile = load_production_assumptions()
    inputs = _inputs(site, plan, task, intent, profile)
    selected = {
        candidate.task_id: candidate
        for candidate in plan.candidates
        if candidate.id in plan.selected_candidate_ids
    }
    candidate = selected.get(task.id)
    route_id = (
        candidate.route_id
        if candidate is not None
        else profile.route_id
        if task.id == profile.haul_task_id
        else task.route_id
    )
    evaluation = evaluate(
        site,
        EvaluationRequest(
            task_id=task.id,
            machine_id=candidate.machine_id if candidate is not None else task.assigned_machine_id,
            route_id=route_id,
            as_of=plan.as_of,
        ),
    )
    evaluations: list[Evaluation] = [evaluation]
    ground_status = evaluation.status
    reasons = evaluation.reasons.copy()
    for job in inputs.jobs:
        if job.task_id == task.id:
            continue
        retained = next(item for item in site.tasks if item.id == job.task_id)
        candidate = selected.get(job.task_id)
        checked = evaluate(
            site,
            EvaluationRequest(
                task_id=retained.id,
                machine_id=job.machine_id,
                route_id=candidate.route_id if candidate is not None else retained.route_id,
                as_of=plan.as_of,
            ),
        )
        evaluations.append(checked)
        ground_status = max((ground_status, checked.status), key=SEVERITY.__getitem__)
        reasons.extend(checked.reasons)
    blockers = blocking_tasks(site, task)
    if blockers:
        ground_status = max((ground_status, DecisionStatus.INSPECT), key=SEVERITY.__getitem__)
        reasons.append(
            Reason(
                code="UNFINISHED_PREREQUISITES",
                message="Actual completion required: " + ", ".join(blockers),
            )
        )
    if inputs.include_haul:
        haul = next(item for item in site.tasks if item.id == profile.haul_task_id)
        transport = evaluate(
            site,
            EvaluationRequest(
                task_id=haul.id,
                machine_id=profile.truck_machine_id,
                route_id=profile.route_id,
                as_of=plan.as_of,
            ),
        )
        evaluations.append(transport)
        ground_status = max((ground_status, transport.status), key=SEVERITY.__getitem__)
        reasons.extend(transport.reasons)
        loader = next(
            machine for machine in site.machines if machine.id == profile.loader_machine_id
        )
        zone = next(zone for zone in site.zones if zone.id == haul.zone_id)
        loading = evaluate_zone(zone, loader, site.observations, site.scenario, plan.as_of)
        ground_status = max((ground_status, loading.status), key=SEVERITY.__getitem__)
        reasons.extend(loading.reasons)
        if "excavate" not in loader.operations:
            ground_status = DecisionStatus.NO_GO
            reasons.append(
                Reason(
                    code="UNSUPPORTED_LOADER",
                    message="The synthetic loading mode requires excavation capability.",
                )
            )
        if blocking_tasks(site, haul):
            ground_status = max((ground_status, DecisionStatus.INSPECT), key=SEVERITY.__getitem__)
            reasons.append(
                Reason(
                    code="UNFINISHED_PREREQUISITES",
                    message="The haul batch must actually be complete; "
                    "scheduling preparation does not complete it.",
                )
            )
    alternatives = []
    if ground_status != DecisionStatus.GO or task.state == "completed":
        requested = SolverCaseResult(
            case="requested",
            status="unknown",
            solver_status="NOT_RUN",
            message="Ground, prerequisite or completion checks prevent this what-if "
            "from releasing work.",
            objective="not run: hard operational gate",
        )
        verdict: Literal["GO", "NO_GO", "INSPECT", "UNKNOWN"] = (
            "NO_GO" if ground_status == DecisionStatus.NO_GO else "INSPECT"
        )
    else:
        requested = _solve_case(inputs, task.id, "requested")
        alternative_cases: tuple[Case, ...] = (
            "minimum_fleet",
            "minimum_overtime",
            "maximum_volume",
        )
        alternatives = [_solve_case(inputs, task.id, case) for case in alternative_cases]
        verdict = (
            "GO"
            if requested.status == "feasible"
            else "NO_GO"
            if requested.status == "infeasible"
            else "UNKNOWN"
        )
    assumptions = [
        profile.description,
        "Times are integer minutes from the evidence clock. Completed cycles include return "
        "travel; partial loads are not modeled.",
        "Retained work follows the submitted draft. Loading shares EX-01 with preparation and "
        "drainage. The completed prior batch supplies this haul; today's preparation is not "
        "a haul prerequisite.",
        "Only one truck/operator pair exists in the snapshot. Larger fleets require "
        "additional real resources.",
        "Ground is checked at the evidence clock only. The schedule does not certify conditions "
        "through completion: reinspect before evidence expires or when conditions change.",
        "Read-only planning result. No choices, approvals, completion, observations or equipment "
        "were changed.",
        "Minimum-fleet relaxes the fleet cap up to three; minimum-overtime permits up to "
        "120 minutes; maximum-volume relaxes the target. Other scoped constraints remain.",
    ]
    body = {
        "source_plan_id": plan.id,
        "task_id": task.id,
        "as_of": plan.as_of.isoformat(),
        "inputs": inputs.model_dump(mode="json"),
        "requested": requested.model_dump(mode="json"),
        "alternatives": [case.model_dump(mode="json") for case in alternatives],
    }
    return SuggestionSolverResult(
        id=hashlib.sha256(
            json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        task_id=task.id,
        source_plan_id=plan.id,
        as_of=plan.as_of,
        review_by=evidence_review_by(site, plan.as_of, evaluations),
        ground_status=ground_status,
        ground_reasons=reasons,
        verdict=verdict,
        inputs=inputs,
        requested=requested,
        alternatives=alternatives,
        assumptions=assumptions,
        solver="OR-Tools CP-SAT " + version("ortools"),
    )
