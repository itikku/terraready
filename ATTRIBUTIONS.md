# Asset provenance

## Bundled aerial

- File: `apps/web/public/imagery/site-aerial.jpg`
- Source: [USGS National Map NAIP Plus service](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer)
- Credit: USGS, USDA, The National Map: Orthoimagery.
- Tile: `m_3712248_nw_10_060_20220519`, object ID 21792, USDA / USDA-FSA-APFO.
- Acquisition: May 19, 2022. Native source resolution: 0.6 m.
- Requested WGS84 bounds: `[-122.124, 37.315, -122.100, 37.329]` near Cupertino, California. Exported Web Mercator bounds are recorded in `source.json`; the service adjusts the image extent to its aspect ratio.
- Export: JPEG, 1800 × 1300, quality 90, `esriMosaicLockRaster` ID 21792.
- SHA-256: `a897511b859e141aae4dd4073bb3e0b2585e3b48e74e7bcca01033d148bca9a4`.
- Public-domain NAIP imagery: [USGS archive documentation](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip).

This historical aerial provides visual context only. North Ridge, its operational boundaries, routes, asset profiles, measurements and current conditions are fictional. No relationship with the actual site or its owner is implied. Local coordinates and route distances are illustrative, not surveyed engineering data.

## Synthetic inspection illustration

- File: `apps/web/public/imagery/north-inspection.png`.
- Created using the built-in OpenAI ImageGen tool on October 24, 2026.
- SHA-256: `f6a803b80adf6812232b47529e88cbc50888bb2a9bbad79456ddae98007d0d84`.
- It is not a photograph of the mapped site and is never used to infer quantitative ground measurements.
- Prompt: “Use case: photorealistic-natural. Asset type: fictional inspection evidence photo for a construction ground-readiness demo. A documentary photograph taken from standing height at the edge of an unpaved earthworks access road just after overnight rain. Heavy truck tire ruts hold shallow muddy water; saturated clay shoulders; gravel and small stones in the foreground; a terraced earth cut and subdued construction equipment in the distant background. Overcast California dawn, natural muted earth tones, highly realistic soil and water textures, understated professional field-survey photography, sharp near-ground details. Wide landscape composition. No people, text, overlays, logos, watermarks or dramatic cinematic effects. This is an explicitly fictional synthetic inspection scene, not a photograph of an actual site.”

## Fonts, icons and connected maps

DM Sans and IBM Plex Mono are bundled through Fontsource (SIL Open Font License). The full font licenses are included in `apps/web/public/licenses/` so they accompany the built site. Lucide icons use the ISC License. Optional Mapbox imagery and software retain Mapbox's terms and attribution; no Mapbox tiles or imagery are bundled or redistributed under MIT.

## Optimization library

The scheduling what-if uses [Google OR-Tools](https://github.com/google/or-tools), pinned to Python package version 9.15.6755, under Apache-2.0. Application code builds a bounded CP-SAT model; it does not train or modify a neural solver. The production fixture is original synthetic demo data.

## Application screenshots

The screenshots under `docs/images/` show TerraReady's synthetic scenario over the attributed aerial above. `local-assistant.png` and `local-assistant-mobile.png` are explicitly labeled protocol-stub interaction captures. `gpu-recovery-approved.png` is an unmodified full-page capture from the private single-L4 test on October 25, 2026, showing genuine Qwen3-4B analysis, separate human approval and local briefs. No real customer data or credentials are shown. Historical native and GPU results are independently recorded under `docs/verification/`; screenshots alone are not benchmark evidence.

Camera-interface captures: `camera-stub.png` shows the explicit disconnected demo source. `camera-adapter-mobile.png` supplies the same synthetic illustration through a mocked snapshot adapter for contract/UI verification; it is not a hardware-camera capture. Both retain the imagery/synthetic-data boundaries above.

`solver-what-if.png` is a genuine hosted Qwen/CP-SAT capture from source f876ba4 on October 26 Pacific. Its operating and production inputs are synthetic. The screenshot is an integration observation, not a benchmark or physical validation.
