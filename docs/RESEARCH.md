# Business rationale

## The problem

TerraReady addresses machine trafficability and field / site readiness: deciding whether a specific asset can perform a specific operation at a specific location under changing ground conditions.

- Agricultural research defines field readiness as the combined trafficability and workability of a field for a specific operation and machine. [Edwards et al., 2016](https://www.sciencedirect.com/science/article/pii/S1537511016000118)
- Sentinel-1-derived soil moisture has been studied for year-round monitoring of agricultural trafficability. [Agricultural Water Management, 2019](https://www.sciencedirect.com/science/article/pii/S0378377419304585)
- Heavy rainfall can suspend highway construction because soil becomes saturated and unworkable; rainfall-aware productivity planning has been studied for earthmoving, base-course, drainage, and paving operations. [ASCE, 2001](https://ascelibrary.org/doi/10.1061/%28ASCE%290733-9364%282001%29127%3A2%28125%29)
- Construction-machine trafficability has been evaluated from spectral imagery by estimating soil type, water content, and a trafficability measure. [Japan Society for Precision Engineering, 2020](https://www.jstage.jst.go.jp/article/jjspe/86/12/86_1057/_article/-char/en)

## Evidence boundary

The cited research motivates the workflow. TerraReady v1 does not implement or claim a validated trafficability model. Its fixture-based rules are explanatory demo logic only.

## Visual-data attribution policy

The project will use a static crop of USDA NAIP aerial imagery only after recording its source, acquisition date, location bounds, and attribution in `ATTRIBUTIONS.md`. USGS describes NAIP imagery as public domain and typically 0.6 m-resolution, orthorectified aerial imagery. [USGS NAIP archive](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip)
