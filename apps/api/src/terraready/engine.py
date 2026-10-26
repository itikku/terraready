"""Pure demo rules: no database, network, wall-clock or model calls."""

from datetime import datetime, timedelta

from terraready.models import (
    Calculation,
    DecisionStatus,
    Evaluation,
    EvaluationRequest,
    GroundAccess,
    Machine,
    Observation,
    Reason,
    Scenario,
    SiteSnapshot,
    Zone,
    ZoneDecision,
)

SEVERITY = {DecisionStatus.GO: 0, DecisionStatus.INSPECT: 1, DecisionStatus.NO_GO: 2}
MOISTURE_CAUTION_MARGIN = 0.05


class UnknownEntity(ValueError):
    """The requested task, asset or route does not exist."""


class InvalidEvaluation(ValueError):
    """Known entities form an invalid evaluation request."""


def _blocking_reasons(observation: Observation, machine: Machine) -> list[Reason]:
    reasons = []
    if observation.access == GroundAccess.CLOSED:
        reasons.append(
            Reason(
                code="ACCESS_CLOSED",
                message="Current field evidence marks access closed.",
                evidence_ids=[observation.id],
            )
        )
    if (
        observation.moisture_fraction is not None
        and observation.moisture_fraction >= machine.max_moisture_fraction
    ):
        reasons.append(
            Reason(
                code="MOISTURE_LIMIT",
                message=f"Moisture fraction {observation.moisture_fraction:g} meets/exceeds "
                f"this machine's demo limit of {machine.max_moisture_fraction:g}.",
                evidence_ids=[observation.id],
            )
        )
    if (
        observation.bearing_capacity_kpa is not None
        and observation.bearing_capacity_kpa <= machine.ground_pressure_kpa
    ):
        reasons.append(
            Reason(
                code="BEARING_LIMIT",
                message=f"Bearing capacity {observation.bearing_capacity_kpa:g} kPa is at/below "
                f"this machine's {machine.ground_pressure_kpa:g} kPa ground pressure.",
                evidence_ids=[observation.id],
            )
        )
    return reasons


def _observation_status(observation: Observation, machine: Machine) -> DecisionStatus:
    if _blocking_reasons(observation, machine):
        return DecisionStatus.NO_GO
    if (
        observation.access == GroundAccess.UNKNOWN
        or observation.moisture_fraction is None
        or observation.bearing_capacity_kpa is None
        or observation.moisture_fraction >= machine.max_moisture_fraction - MOISTURE_CAUTION_MARGIN
    ):
        return DecisionStatus.INSPECT
    return DecisionStatus.GO


def _zone_calculations(
    zone: Zone,
    machine: Machine,
    available: list[Observation],
    eligible: list[Observation],
    scenario: Scenario,
    as_of: datetime,
) -> list[Calculation]:
    """Expose the same rule operands without rounding or promoting untrusted evidence."""
    calculations = [
        Calculation(
            code="SLOPE",
            label="Slope below machine limit",
            observed=zone.slope_deg,
            limit=machine.max_slope_deg,
            headroom=machine.max_slope_deg - zone.slope_deg,
            unit="degrees",
            outcome="blocked" if zone.slope_deg >= machine.max_slope_deg else "pass",
        )
    ]
    eligible_ids = {observation.id for observation in eligible}
    for observation in available:
        age = (as_of - observation.observed_at).total_seconds() / 3600
        after_rain = (observation.observed_at - scenario.rain_ended_at).total_seconds() / 3600
        applicable = observation.id in eligible_ids
        bearing = observation.bearing_capacity_kpa
        moisture = observation.moisture_fraction
        calculations.extend(
            [
                Calculation(
                    code="EVIDENCE_AGE",
                    label="Evidence within age limit",
                    observed=age,
                    limit=scenario.max_evidence_age_hours,
                    headroom=scenario.max_evidence_age_hours - age,
                    unit="hours",
                    outcome="pass" if age <= scenario.max_evidence_age_hours else "inspect",
                    evidence_id=observation.id,
                ),
                Calculation(
                    code="POST_RAIN",
                    label="Observation after rain ended",
                    observed=after_rain,
                    limit=0,
                    headroom=after_rain,
                    unit="hours",
                    outcome="pass"
                    if observation.observed_at >= scenario.rain_ended_at
                    else "inspect",
                    evidence_id=observation.id,
                ),
                Calculation(
                    code="CONFIDENCE",
                    label="Evidence confidence meets policy",
                    observed=observation.confidence,
                    limit=scenario.min_evidence_confidence,
                    headroom=observation.confidence - scenario.min_evidence_confidence,
                    unit="fraction",
                    outcome="pass"
                    if observation.confidence >= scenario.min_evidence_confidence
                    else "inspect",
                    evidence_id=observation.id,
                ),
                Calculation(
                    code="BEARING",
                    label="Bearing capacity above ground pressure",
                    observed=bearing,
                    limit=machine.ground_pressure_kpa,
                    headroom=None if bearing is None else bearing - machine.ground_pressure_kpa,
                    unit="kPa",
                    outcome="unavailable"
                    if not applicable or bearing is None
                    else "blocked"
                    if bearing <= machine.ground_pressure_kpa
                    else "pass",
                    evidence_id=observation.id,
                    applicable=applicable,
                ),
                Calculation(
                    code="MOISTURE",
                    label="Moisture below machine limit",
                    observed=moisture,
                    limit=machine.max_moisture_fraction,
                    headroom=None if moisture is None else machine.max_moisture_fraction - moisture,
                    unit="fraction",
                    outcome="unavailable"
                    if not applicable or moisture is None
                    else "blocked"
                    if moisture >= machine.max_moisture_fraction
                    else "inspect"
                    if moisture >= machine.max_moisture_fraction - MOISTURE_CAUTION_MARGIN
                    else "pass",
                    evidence_id=observation.id,
                    applicable=applicable,
                    caution_limit=machine.max_moisture_fraction - MOISTURE_CAUTION_MARGIN,
                ),
            ]
        )
    return calculations


def evaluate_zone(
    zone: Zone,
    machine: Machine,
    observations: list[Observation],
    scenario: Scenario,
    as_of: datetime,
) -> ZoneDecision:
    """Evaluate static limits, then all fresh and trusted post-rain evidence."""
    reasons: list[Reason] = []
    mitigations: list[str] = []
    status = DecisionStatus.GO
    confidence: float | None = None
    # Future observations cannot support historical decisions.
    available = sorted(
        (o for o in observations if o.zone_id == zone.id and o.observed_at <= as_of),
        key=lambda o: (o.observed_at, o.id),
    )
    evidence_ids = [o.id for o in available]
    if zone.closed:
        status = DecisionStatus.NO_GO
        reasons.append(Reason(code="ZONE_CLOSED", message=f"{zone.name}: {zone.closure_reason}"))
        mitigations.append(f"Keep {zone.name} closed until the site lead releases the restriction.")
    if zone.slope_deg >= machine.max_slope_deg:
        status = DecisionStatus.NO_GO
        reasons.append(
            Reason(
                code="SLOPE_LIMIT",
                message=f"{zone.name}'s slope of {zone.slope_deg:g}° meets/exceeds "
                f"this machine's {machine.max_slope_deg:g}° demo limit.",
            )
        )
        mitigations.append("Select a different work area or machine after supervisor review.")
    eligible = [
        o
        for o in available
        if as_of - o.observed_at <= timedelta(hours=scenario.max_evidence_age_hours)
        and o.observed_at >= scenario.rain_ended_at
        and o.confidence >= scenario.min_evidence_confidence
    ]
    if not eligible:
        # A static restriction remains NO_GO even when supporting observations are missing.
        status = max((status, DecisionStatus.INSPECT), key=SEVERITY.__getitem__)
        reasons.append(
            Reason(
                code="EVIDENCE_REQUIRED",
                message=f"{zone.name} needs fresh, trusted post-rain ground evidence.",
                evidence_ids=evidence_ids,
            )
        )
        mitigations.append(f"Ask the field lead to inspect {zone.name} before releasing work.")
    else:
        confidence = min(o.confidence for o in eligible)
        eligible_ids = [o.id for o in eligible]
        states = {_observation_status(o, machine) for o in eligible}
        if len(states) > 1:
            evidence_status = DecisionStatus.INSPECT
            reasons.append(
                Reason(
                    code="CONFLICTING_EVIDENCE",
                    message=f"Current observations disagree on {zone.name}'s operability.",
                    evidence_ids=eligible_ids,
                )
            )
            mitigations.append(
                f"Reconcile the conflicting observations in {zone.name} in the field."
            )
        elif DecisionStatus.NO_GO in states:
            evidence_status = DecisionStatus.NO_GO
            reasons.extend(reason for o in eligible for reason in _blocking_reasons(o, machine))
            mitigations.append(f"Avoid {zone.name}; compare another route, machine or task.")
        else:
            evidence_status = next(iter(states))
            code, message, mitigation = {
                DecisionStatus.GO: (
                    "WITHIN_DEMO_LIMITS",
                    f"{zone.name} is within this machine's demo ground limits.",
                    None,
                ),
                DecisionStatus.INSPECT: (
                    "MARGINAL_OR_INCOMPLETE",
                    f"{zone.name} has marginal or incomplete ground measurements.",
                    f"Confirm ground conditions in {zone.name} before releasing this machine.",
                ),
            }[evidence_status]
            reasons.append(Reason(code=code, message=message, evidence_ids=eligible_ids))
            if mitigation:
                mitigations.append(mitigation)
        status = max((status, evidence_status), key=SEVERITY.__getitem__)
    return ZoneDecision(
        zone_id=zone.id,
        status=status,
        reasons=reasons,
        confidence=confidence,
        evidence_ids=evidence_ids,
        mitigations=mitigations,
        calculations=_zone_calculations(zone, machine, available, eligible, scenario, as_of),
    )


def evaluate(snapshot: SiteSnapshot, request: EvaluationRequest) -> Evaluation:
    tasks = {task.id: task for task in snapshot.tasks}
    machines = {machine.id: machine for machine in snapshot.machines}
    routes = {route.id: route for route in snapshot.routes}
    try:
        task, machine, route = (
            tasks[request.task_id],
            machines[request.machine_id],
            routes[request.route_id],
        )
    except KeyError as exc:
        raise UnknownEntity(f"Unknown task, machine or route: {exc.args[0]}") from exc
    if task.zone_id not in route.zone_ids:
        raise InvalidEvaluation("The selected route does not reach the task zone.")
    as_of = request.as_of or snapshot.scenario.as_of
    if as_of < snapshot.scenario.as_of:
        raise InvalidEvaluation("Evaluation time cannot precede the scenario snapshot.")
    zones = {zone.id: zone for zone in snapshot.zones}
    zone_decisions = [
        evaluate_zone(zones[zone_id], machine, snapshot.observations, snapshot.scenario, as_of)
        for zone_id in dict.fromkeys(route.zone_ids)
    ]
    status = max((decision.status for decision in zone_decisions), key=SEVERITY.__getitem__)
    reasons = [reason for decision in zone_decisions for reason in decision.reasons]
    mitigations = [item for decision in zone_decisions for item in decision.mitigations]
    if task.operation not in machine.operations:
        status = DecisionStatus.NO_GO
        reasons.append(
            Reason(code="UNSUPPORTED_OPERATION", message="This machine cannot perform the task.")
        )
        mitigations.append("Assign a machine that supports the requested operation.")
    if status == DecisionStatus.GO:
        mitigations.append("Review the evidence and approve the work plan before release.")
    confidences = [decision.confidence for decision in zone_decisions]
    confidence = None if None in confidences else min(c for c in confidences if c is not None)
    return Evaluation(
        scenario_id=snapshot.scenario.id,
        task_id=task.id,
        machine_id=machine.id,
        route_id=route.id,
        as_of=as_of,
        status=status,
        reasons=reasons,
        zone_decisions=zone_decisions,
        evidence_ids=list(dict.fromkeys(e for d in zone_decisions for e in d.evidence_ids)),
        confidence=confidence,
        mitigations=list(dict.fromkeys(mitigations)),
    )
