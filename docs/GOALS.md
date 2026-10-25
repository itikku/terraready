# Goals

## V1 outcome

Deliver a polished, local-running construction-earthworks demo that lets a site superintendent review ground readiness after rain, approve a revised shift plan, and generate clear role-specific operational updates.

## Success criteria

1. A seeded post-rain scenario displays a visual site map with machine, route, zone, evidence, and risk layers.
2. For every machine-zone-task evaluation, the system returns `GO`, `INSPECT`, or `NO_GO`, with evidence and explicit reasons.
3. An uncertain or stale-evidence scenario returns `INSPECT`; it never returns an unjustified `GO`.
4. A superintendent can approve a revised plan and view updates for the field lead and haul coordinator.
5. The local fallback works with network access disabled; Mapbox is optional.
6. Unit, API, accessibility, production-build, and Playwright interaction checks pass in CI.
7. The public README explains the cross-vertical primitive and includes attributed visuals.

## Non-goals

- Controlling, dispatching, or routing physical machinery in the real world
- A validated geotechnical or soil-trafficability model
- Live weather, telemetry, map, Slack, email, or enterprise-system integrations
- User accounts, multi-tenancy, permissions, or data uploads
- A general-purpose LLM agent or model-driven safety decision

## V1 user and scenario

**Primary user:** construction site superintendent.

**Scenario:** overnight rain compromises the north access road. The superintendent must decide whether scheduled earthmoving can proceed, what requires field inspection, how to reroute a haul operation, and who needs an update.
