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
