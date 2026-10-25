# Goals

## V1 outcome

Deliver a polished, local-first construction-earthworks demo that helps a site superintendent understand the day's commitments, see how a ground-condition disruption changes them, recover feasible work, approve a response, and brief the right teammates. A bounded locally served agent supports analysis; deterministic constraints remain authoritative.

## Success criteria

1. A seeded post-rain scenario displays a visual site map with machine, route, zone, evidence, and risk layers.
2. For every machine-zone-task evaluation, the system returns `GO`, `INSPECT`, or `NO_GO`, with evidence and explicit reasons.
3. An uncertain or stale-evidence scenario returns `INSPECT`; it never returns an unjustified `GO`.
4. A superintendent can approve a revised plan and view updates for the field lead and haul coordinator.
5. The local fallback works with network access disabled; Mapbox is optional.
6. Unit, API, accessibility, production-build, and Playwright interaction checks pass in CI.
7. The public README explains the cross-vertical primitive and includes attributed visuals.
8. A shift-first view shows 6–8 synthetic work packages, planned resources/targets/durations, actual completion state and explicit prerequisites. It identifies direct and downstream disruption without pretending approval equals completion.
9. Recovery demonstrates both rerouting and redeployment/pull-forward work. A candidate with unfinished prerequisites, incompatible equipment, conflicting resource allocation or uncertain ground never becomes ready work.
10. A real local model uses bounded read-only tools to explain validated alternatives with evidence references. Model failure, invalid output or an exhausted budget leaves deterministic planning and manual review available.
11. A System & deployment page explains implemented dataflow, design tradeoffs, tool/constraint/approval boundaries, failure behavior and actual verification artifacts. Planned capabilities are visibly distinguished from measured ones.
12. One private, temporary Runpod GPU test exercises the full stack and verifies workload operation with external access denied after preload. Record hardware, model/runtime versions, latency, memory, test outcomes and cost; do not imply Jetson validation. Usage must remain within the approved $5 ceiling; a larger account deposit requires separate approval.

## Non-goals

- Controlling, dispatching, or routing physical machinery in the real world
- A validated geotechnical or soil-trafficability model
- Live weather, telemetry, map, Slack, email, or enterprise-system integrations
- User accounts, multi-tenancy, permissions, or data uploads
- A general-purpose LLM agent or model-driven safety decision
- A globally optimal scheduler, autonomous resourcing, or invented progress/productivity forecasts
- Independent crew/shift rosters, multi-site planning, continuous video inference or model training
- Jetson deployment, a multi-node GPU cluster, always-on cloud hosting or a public unauthenticated demo

## V1 user and scenario

**Primary user:** construction site superintendent.

**Scenario:** overnight rain compromises the north access road. The superintendent must decide whether scheduled earthmoving can proceed, what requires field inspection, how to reroute a haul operation, and who needs an update.

The extended docket must also contain a genuinely held work package, an affected downstream package and a ready alternative for an available resource. Targets, planned durations and potential unassigned capacity are scenario assumptions, not measured production or promised savings. Equipment and its operator are treated as one paired resource in this bounded POC.
