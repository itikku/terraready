# TerraReady

TerraReady is a local-first, multimodal shift-planning prototype for dynamic ground conditions. It joins aerial context, inspection evidence, weather, equipment constraints, and site rules to produce an auditable **go / inspect / no-go** decision and a revised shift plan.

## The operating primitive

> Can this asset perform this task, in this place, at this time, under evidence-backed operating constraints?

| Construction | Agriculture | Mining | Forestry |
| --- | --- | --- | --- |
| Excavator × saturated work zone | Planter × wet field strip | Haul truck × rain-soft road | Harvester × protected-soil route |

The first demo focuses on construction earthworks, but the underlying planning primitive applies across physical operations.

## What the v1 demo will show

- A site superintendent reviews a post-rain shift on a visual site map.
- The system assesses machine-and-zone feasibility using explicit, deterministic rules.
- A marginal or stale-evidence condition becomes **Inspect**, never invented certainty.
- The superintendent approves a revised plan and produces role-specific updates for a field lead and haul coordinator.
- The same user flow works offline with local data. A connected Mapbox map is an optional visual enhancement.

## POC boundaries

TerraReady is not a safety-certified system, trafficability model, or machine-control product. All v1 operational layers and inspection evidence are synthetic and visibly labeled as such. The final README will include a real aerial base-map attribution and visual cross-vertical examples.

## Project documents

- [Goals and scope](docs/GOALS.md)
- [Build plan](docs/PLAN.md)
- [Current project state](docs/STATE.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Research and business rationale](docs/RESEARCH.md)

## Local configuration

Copy `.env.example` to `.env.local` and optionally set `VITE_MAPBOX_TOKEN`. Never commit this token. The app must run without it.

## License

Code and original project assets are released under the [MIT License](LICENSE). Third-party and public-domain data are identified separately in `ATTRIBUTIONS.md` when added.
