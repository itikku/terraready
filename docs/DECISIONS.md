# Architecture decisions

## 2026-10-24 — Construction earthworks first

The v1 is a post-rain earthworks shift-planning workflow for a site superintendent. Construction offers the clearest visual story and a narrow, credible POC. Cross-vertical applicability will be explicit in the README but not implemented as multiple applications.

## 2026-10-24 — Real aerial base; synthetic operational layer

The visual base will use a local, attributed crop from public-domain USDA NAIP aerial imagery. Site boundary, zones, routes, equipment, inspection evidence, and operating telemetry will be synthetic and labeled as such. This prevents a weekend prototype from making an unsupported claim of world-model realism or use of a real customer site.

## 2026-10-24 — Mapbox is optional presentation infrastructure

The connected showcase may use Mapbox GL JS when `VITE_MAPBOX_TOKEN` is present. The core demo must work without a network or token using the bundled NAIP crop. No Mapbox imagery will be committed or redistributed.

## 2026-10-24 — Deterministic decision logic

V1 recommendations will use transparent rules over fixture data. A language model may eventually help query or summarize evidence, but it will not produce or override a safety-relevant decision.

## 2026-10-24 — Local collaboration artifacts, not SaaS integrations

The system will produce role-specific shift updates locally. Slack, email, and third-party dispatch integrations are explicitly deferred.

## 2026-10-24 — MIT license

The repository will use MIT for original code and original assets. Public-domain and third-party materials retain their own status and will be recorded in `ATTRIBUTIONS.md`.

## 2026-10-24 — Phase 1 backend and persistence

Use Python 3.12, FastAPI, Pydantic and local LanceDB, with a committed `uv.lock`. Domain logic stays separate from database and HTTP code. Six typed tables store a single site's demo snapshot. Explicit Arrow schemas preserve enum, literal, nullable and timestamp fields because LanceDB's Pydantic schema conversion does not support the contract's `Literal` fields. No vector search or fabricated embeddings are introduced before actual multimodal assets exist.

The seed validates the full fixture and constructs Arrow tables before writing. It explicitly replaces only the named demo tables and is run with the API stopped; a cross-table transaction is deferred for this small POC. The API validates the complete stored snapshot before evaluating and returns a recovery-oriented `503` on missing or broken data.

## 2026-10-24 — Fixed scenario time and demo thresholds

Evaluate against the fixture's explicit clock, with optional later time for staleness testing. The engine checks the full selected route, machine capabilities, static closures and slopes, then fresh trusted post-rain observations. Conflicting evidence requires inspection; an independent static restriction still blocks operation. Source confidence is not a calibrated safety probability. Exact fields, units, rules and expected outcomes are recorded in `docs/DATA_CONTRACT.md`.

## 2026-10-24 — CI starts with the backend

Add CI in Phase 1 so every subsequent change has automated backend verification. Use the current HTTPX2 client supported by the installed Starlette TestClient. Browser tests and visual checks begin with Phase 2; their absence must be explicit until then.
