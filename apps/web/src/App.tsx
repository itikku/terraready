import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CloudRain,
  Compass,
  Crosshair,
  Database,
  Expand,
  FileImage,
  Info,
  Layers,
  Leaf,
  Map as MapIcon,
  Minus,
  Mountain,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Tractor,
  Truck,
  WifiOff,
  X,
} from "lucide-react";
import { getEvaluation, getReadiness, getSite } from "./api";
import OfflineSiteMap from "./map/OfflineSiteMap";
import PlanReview from "./PlanReview";
import AssistPanel from "./AssistPanel";
import type { Evaluation, Machine, Readiness, Site, Status } from "./types";

const ConnectedMap = lazy(() => import("./map/MapboxSiteMap"));
const STATUS_TEXT: Record<Status, string> = {
  GO: "Go",
  INSPECT: "Inspect",
  NO_GO: "No-go",
};
const ICONS = [Truck, Tractor, Compass];
const SHORT: Record<string, string> = {
  "loaded-hauler": "HT-02",
  "tracked-excavator": "EX-01",
  "utility-rover": "UT-03",
};
const zoneNumber: Record<string, string> = {
  "service-yard": "01",
  "north-access": "02",
  "south-access": "03",
  "east-cut": "04",
  "west-stockpile": "05",
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status-pill ${status.toLowerCase()}`}>
      <span />
      {STATUS_TEXT[status]}
    </span>
  );
}

export default function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [machineId, setMachineId] = useState("loaded-hauler");
  const [taskId, setTaskId] = useState("east-haul");
  const [routeId, setRouteId] = useState("north-to-east");
  const [selected, setSelected] = useState("north-access");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [pending, setPending] = useState(true);
  const [decisionError, setDecisionError] = useState("");
  const [expired, setExpired] = useState(false);
  const [connected, setConnected] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [providerNotice, setProviderNotice] = useState("");
  const [overlays, setOverlays] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [sources, setSources] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const evidenceHeading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const tokenAvailable = Boolean(import.meta.env.VITE_MAPBOX_TOKEN);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    getSite(c.signal)
      .then(setSite)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [retry]);
  const asOf = expired ? "2026-10-24T12:00:00-07:00" : undefined;
  useEffect(() => {
    if (!site) return;
    const c = new AbortController();
    setPending(true);
    setDecisionError("");
    Promise.all([
      getReadiness(machineId, c.signal, asOf),
      getEvaluation(taskId, machineId, routeId, c.signal, asOf),
    ])
      .then(([r, e]) => {
        setReadiness(r);
        setEvaluation(e);
        setPending(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setDecisionError(e.message);
          setReadiness(null);
          setEvaluation(null);
          setPending(false);
        }
      });
    return () => c.abort();
  }, [site, machineId, taskId, routeId, asOf, retry]);
  useEffect(() => {
    if (sources || photo) dialog.current?.showModal();
    else dialog.current?.close();
  }, [sources, photo]);
  const providerFailed = () => {
    setConnected(false);
    setProviderReady(false);
    setProviderNotice(
      "Connected imagery unavailable. Using the bundled aerial; local analysis remains available.",
    );
  };
  function chooseMachine(machine: Machine) {
    setPending(true);
    setMachineId(machine.id);
    const task = site?.tasks.find((t) => t.assigned_machine_id === machine.id);
    if (task) {
      setTaskId(task.id);
      setRouteId(task.route_id);
    }
  }
  function chooseZone(id: string) {
    setSelected(id);
    setPhotoFailed(false);
  }
  function closeDialog() {
    setSources(false);
    setPhoto(false);
    sourceTrigger.current?.focus();
  }
  const machine = site?.machines.find((m) => m.id === machineId);
  const task = site?.tasks.find((t) => t.id === taskId);
  const route = site?.routes.find((r) => r.id === routeId);
  const zone = site?.zones.find((z) => z.id === selected);
  const zoneDecision = readiness?.zones.find((z) => z.zone_id === selected);
  const observations =
    site?.observations
      .filter((o) => o.zone_id === selected)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at)) || [];
  const observation = observations[0];
  const clock = asOf || site?.scenario.as_of || "";
  const fresh = Boolean(
    site &&
    observation &&
    new Date(clock).valueOf() - new Date(observation.observed_at).valueOf() <=
      site.scenario.max_evidence_age_hours * 3600000 &&
    new Date(observation.observed_at) >= new Date(site.scenario.rain_ended_at),
  );
  const statuses = Object.fromEntries(
    (readiness?.zones || []).map((z) => [z.zone_id, z.status]),
  );
  const counts = (status: Status) =>
    readiness?.zones.filter((z) => z.status === status).length || 0;
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <nav className="rail" aria-label="Primary navigation">
        <a
          className="brand-mark"
          href="#main"
          aria-label="TerraReady workspace"
        >
          <Mountain size={25} strokeWidth={1.6} />
        </a>
        <span className="rail-divider" />
        <a
          href="#main"
          className="rail-item active"
          aria-label="Ground readiness"
        >
          <MapIcon size={21} />
        </a>
        <button
          className="rail-item"
          aria-label="Focus evidence panel"
          onClick={() => evidenceHeading.current?.focus()}
        >
          <FileImage size={21} />
        </button>
        <a
          href="/system"
          className="rail-item"
          aria-label="System & deployment"
        >
          <ShieldCheck size={21} />
        </a>
        <button
          ref={sourceTrigger}
          className="rail-item rail-bottom"
          aria-label="Data sources and provenance"
          onClick={() => setSources(true)}
        >
          <Database size={20} />
        </button>
        <div className="avatar" title="Site superintendent">
          ST
        </div>
      </nav>
      <div className="app-content">
        <header className="topbar">
          <div className="wordmark">
            terra<span>ready</span>
            <span className="product-label">FIELD OPERATIONS</span>
          </div>
          <div className="topbar-right">
            <span className="demo-tag">INTERACTIVE DEMO</span>
            <span className="local-status">
              <span />
              Local site memory
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <section className="page-heading">
            <div>
              <div className="breadcrumb">
                North Ridge <span>/</span> Construction earthworks{" "}
                <ChevronDown size={13} />
              </div>
              <h1>Good ground. Better decisions.</h1>
              <p>A clear view of where your equipment can work today.</p>
            </div>
            <div className="shift-stamp">
              <span className="eyebrow">MORNING SHIFT</span>
              <strong>Saturday, October 24</strong>
              <span>
                <Radio size={13} />
                07:00 PDT · Demo snapshot
              </span>
            </div>
          </section>
          {error ? (
            <section className="error-state" role="alert">
              <WifiOff />
              <h2>Site workspace unavailable</h2>
              <p>{error}</p>
              <button
                className="primary-button"
                onClick={() => setRetry((x) => x + 1)}
              >
                <RefreshCw size={16} />
                Try again
              </button>
            </section>
          ) : !site || !machine || !task || !route || !zone ? (
            <section className="loading-state" role="status">
              <div className="loading-orbit" />
              <p>Opening the local site workspace…</p>
            </section>
          ) : (
            <>
              <div className="weather-strip">
                <div className="weather-icon">
                  <CloudRain size={24} />
                </div>
                <div>
                  <strong>
                    18 mm overnight. A different site this morning.
                  </strong>
                  <span>
                    North access is soft. Review ground readiness for each
                    machine before releasing work.
                  </span>
                </div>
                <div className="rain-ended">
                  RAIN ENDED <strong>04:00 PDT</strong>
                </div>
              </div>
              <section
                className="equipment-bar"
                aria-label="Equipment selection"
              >
                <div className="eyebrow">ASSESS FOR</div>
                {[site.machines[1], site.machines[0], site.machines[2]].map(
                  (m, index) => {
                    const Icon = ICONS[index];
                    return (
                      <button
                        key={m.id}
                        className={`equipment-button ${m.id === machineId ? "selected" : ""}`}
                        aria-pressed={m.id === machineId}
                        onClick={() => chooseMachine(m)}
                      >
                        <Icon size={21} />
                        <span>
                          <strong>{SHORT[m.id]}</strong>
                          <small>{m.name.split(" · ")[1]}</small>
                        </span>
                        {m.id === machineId && (
                          <span className="equipment-check">
                            <Check size={12} />
                          </span>
                        )}
                      </button>
                    );
                  },
                )}
                <div className="clock-select">
                  <label htmlFor="clock">Evidence clock</label>
                  <select
                    id="clock"
                    value={expired ? "expired" : "morning"}
                    onChange={(e) => {
                      setPending(true);
                      setExpired(e.target.value === "expired");
                    }}
                  >
                    <option value="morning">07:00 · Shift start</option>
                    <option value="expired">12:00 · Evidence expired</option>
                  </select>
                </div>
              </section>
              <div className="workspace-grid">
                <section className="map-workspace" aria-label="Site workspace">
                  <div className="map-heading">
                    <div>
                      <MapIcon size={17} />
                      <h2>Ground readiness</h2>
                      <span className="zone-total">5 zones</span>
                    </div>
                    <div className="layer-switch">
                      <button
                        aria-pressed={!connected}
                        onClick={() => {
                          setConnected(false);
                          setProviderNotice("");
                        }}
                      >
                        Local aerial
                      </button>
                      <button
                        aria-pressed={connected}
                        disabled={!tokenAvailable}
                        title={
                          tokenAvailable
                            ? "Load connected Mapbox imagery"
                            : "A Mapbox token enables connected imagery"
                        }
                        onClick={() => {
                          setProviderNotice("");
                          setProviderReady(false);
                          setConnected(true);
                        }}
                      >
                        Satellite <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </div>
                  {providerNotice && (
                    <div className="provider-notice" role="status">
                      {providerNotice}
                    </div>
                  )}
                  <div className="map-canvas" aria-busy={pending}>
                    <OfflineSiteMap
                      site={site}
                      statuses={pending ? {} : statuses}
                      selected={selected}
                      route={route}
                      onSelect={chooseZone}
                      overlays={overlays && !connected}
                      zoom={zoom}
                    />
                    {connected && (
                      <Suspense
                        fallback={
                          <div className="map-connecting" role="status">
                            Opening satellite imagery…
                          </div>
                        }
                      >
                        <ConnectedMap
                          site={site}
                          statuses={statuses}
                          route={route}
                          onSelect={chooseZone}
                          onFailure={providerFailed}
                          onReady={() => setProviderReady(true)}
                          overlays={overlays}
                        />
                      </Suspense>
                    )}
                    {connected && !providerReady && (
                      <div className="map-connecting" role="status">
                        Opening satellite imagery…
                      </div>
                    )}
                    <div className="map-topline">
                      <span className="site-code">
                        <span />
                        NORTH RIDGE / NR-01
                      </span>
                      <span className="map-time">{time(clock)} PDT</span>
                    </div>
                    <div className="zone-dock" aria-label="Work zones">
                      <div className="eyebrow">
                        WORK ZONES <span>FOR {SHORT[machineId]}</span>
                      </div>
                      {site.zones.map((z) => (
                        <button
                          key={z.id}
                          className={
                            selected === z.id ? "zone-row selected" : "zone-row"
                          }
                          aria-pressed={selected === z.id}
                          onClick={() => chooseZone(z.id)}
                        >
                          <span className="zone-number">
                            {zoneNumber[z.id]}
                          </span>
                          <span>{z.name}</span>
                          <span
                            className={`zone-dot ${pending ? "unknown" : (statuses[z.id] || "INSPECT").toLowerCase()}`}
                          />
                        </button>
                      ))}
                    </div>
                    <div className="map-controls">
                      <button
                        aria-label="Toggle readiness overlays"
                        aria-pressed={overlays}
                        onClick={() => setOverlays((x) => !x)}
                      >
                        <Layers size={18} />
                      </button>
                      {!connected && (
                        <>
                          <button
                            aria-label="Zoom in"
                            disabled={zoom >= 1.6}
                            onClick={() =>
                              setZoom((z) => Math.min(1.6, z + 0.2))
                            }
                          >
                            <Plus size={19} />
                          </button>
                          <button
                            aria-label="Zoom out"
                            disabled={zoom <= 1}
                            onClick={() => setZoom((z) => Math.max(1, z - 0.2))}
                          >
                            <Minus size={19} />
                          </button>
                          <button
                            aria-label="Fit site"
                            onClick={() => setZoom(1)}
                          >
                            <Crosshair size={18} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="map-north">
                      <span>N</span>
                      <ArrowUpRight size={25} />
                    </div>
                    <div className="map-bottomline">
                      <span className="map-scale">
                        ━━━━<span>~250 m · illustrative</span>
                      </span>
                      <span className="map-credit">
                        {connected
                          ? "Mapbox satellite"
                          : "USGS / USDA NAIP · May 2022"}
                        <br />
                        Synthetic operating overlays
                      </span>
                    </div>
                    {pending && (
                      <div className="map-updating" role="status">
                        Evaluating ground conditions…
                      </div>
                    )}
                  </div>
                  <div className="map-legend">
                    <span>
                      <i className="go" />
                      Go <b>{counts("GO")}</b>
                    </span>
                    <span>
                      <i className="inspect" />
                      Inspect <b>{counts("INSPECT")}</b>
                    </span>
                    <span>
                      <i className="no_go" />
                      No-go <b>{counts("NO_GO")}</b>
                    </span>
                    <small>
                      Readiness is specific to the selected equipment.
                    </small>
                  </div>
                </section>
                <aside className="evidence-panel" aria-label="Zone evidence">
                  <div className="panel-eyebrow">
                    <span className="eyebrow">
                      ZONE {zoneNumber[zone.id]} / EVIDENCE
                    </span>
                    <FileImage size={16} />
                  </div>
                  <h2 ref={evidenceHeading} tabIndex={-1}>
                    {zone.name}
                  </h2>
                  <div className="evidence-status">
                    {!pending && zoneDecision ? (
                      <StatusPill status={zoneDecision.status} />
                    ) : (
                      <span className="muted">Assessing…</span>
                    )}
                    <span>for {SHORT[machineId]}</span>
                  </div>
                  <div className="evidence-picture">
                    {observation?.image_path && !photoFailed ? (
                      <button
                        aria-label="Enlarge synthetic inspection image"
                        onClick={() => setPhoto(true)}
                      >
                        <img
                          src={observation.image_path}
                          onError={() => setPhotoFailed(true)}
                          alt="Synthetic illustration of a rutted, waterlogged construction access road"
                        />
                        <span className="image-expand">
                          <Expand size={14} />
                        </span>
                      </button>
                    ) : (
                      <div
                        className="aerial-detail"
                        style={{
                          backgroundImage: "url(/imagery/site-aerial.jpg)",
                        }}
                        role="img"
                        aria-label="Historical aerial context, not a current ground inspection"
                      />
                    )}
                    <span className="image-type">
                      {observation?.image_path && !photoFailed
                        ? "SYNTHETIC INSPECTION"
                        : "HISTORICAL AERIAL CONTEXT"}
                    </span>
                  </div>
                  <div className="observation-stamp">
                    <span>
                      <Radio size={12} />
                      {observation
                        ? `${time(observation.observed_at)} PDT`
                        : "No observation"}
                    </span>
                    <span className={fresh ? "fresh-tag" : "stale-tag"}>
                      {fresh ? "Current evidence" : "Refresh required"}
                    </span>
                  </div>
                  <p className="observation-note">
                    {observation?.note ||
                      "No inspection evidence is available. A field review is required."}
                  </p>
                  <div className="measurement-grid">
                    <div>
                      <span>Soil moisture</span>
                      <strong>
                        {observation?.moisture_fraction != null
                          ? Math.round(observation.moisture_fraction * 100)
                          : "—"}
                        <small>%</small>
                      </strong>
                      <span className="measurement-limit">
                        Asset limit{" "}
                        {Math.round(machine.max_moisture_fraction * 100)}%
                      </span>
                    </div>
                    <div>
                      <span>Bearing capacity</span>
                      <strong>
                        {observation?.bearing_capacity_kpa ?? "—"}
                        <small>kPa</small>
                      </strong>
                      <span className="measurement-limit">
                        Asset pressure {machine.ground_pressure_kpa} kPa
                      </span>
                    </div>
                  </div>
                  <div className="finding">
                    <span className="eyebrow">DECISION BASIS</span>
                    {decisionError ? (
                      <p role="alert">{decisionError}</p>
                    ) : pending ? (
                      <p>Refreshing evidence assessment…</p>
                    ) : (
                      zoneDecision?.reasons.map((reason, index) => (
                        <p key={`${reason.code}-${index}`}>
                          <span
                            className={`finding-marker ${zoneDecision.status.toLowerCase()}`}
                          />
                          {reason.message}
                        </p>
                      ))
                    )}
                  </div>
                  <div className="source-line">
                    <ShieldCheck size={16} />
                    <div>
                      <strong>
                        {observation
                          ? `${Math.round(observation.confidence * 100)}% source confidence`
                          : "Evidence unavailable"}
                      </strong>
                      <span>
                        {observation?.source || "Inspection required"}
                      </span>
                    </div>
                    <button
                      aria-label="About source confidence"
                      onClick={() => setSources(true)}
                    >
                      <Info size={15} />
                    </button>
                  </div>
                  <p className="evidence-disclaimer">
                    Illustrative measurements · Supervisor approval required.
                    Source confidence is not a safety probability.
                  </p>
                </aside>
              </div>
              <section
                className="route-review"
                aria-label="Task and route assessment"
              >
                <div className="route-title">
                  <div className="route-icon">
                    <Truck size={22} />
                  </div>
                  <div>
                    <span className="eyebrow">CURRENT WORK PACKAGE</span>
                    <h2>{task.name}</h2>
                    <span>
                      {SHORT[machineId]} · {task.target_quantity}{" "}
                      {task.quantity_unit === "m3" ? "m³" : task.quantity_unit}{" "}
                      · {task.duration_hours}h planned
                    </span>
                  </div>
                </div>
                <div className="route-picker">
                  <label htmlFor="route">Access route</label>
                  <select
                    id="route"
                    value={routeId}
                    onChange={(e) => {
                      setPending(true);
                      setRouteId(e.target.value);
                    }}
                  >
                    {site.routes
                      .filter((r) => r.zone_ids.includes(task.zone_id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                  <span>{route.distance_m} m · synthetic route</span>
                </div>
                <div className="route-result" aria-live="polite">
                  {pending ? (
                    <span>Assessing route…</span>
                  ) : decisionError ? (
                    <div role="alert">
                      <span>Assessment unavailable</span>
                      <button onClick={() => setRetry((x) => x + 1)}>
                        Retry
                      </button>
                    </div>
                  ) : (
                    evaluation && (
                      <>
                        <StatusPill status={evaluation.status} />
                        <span>
                          {evaluation.status === "NO_GO"
                            ? "Select another route before release."
                            : evaluation.status === "INSPECT"
                              ? "Fresh field evidence is needed."
                              : "Within demo limits. Awaiting supervisor review."}
                        </span>
                      </>
                    )
                  )}
                </div>
              </section>
              <PlanReview
                key={asOf ?? site.scenario.as_of}
                site={site}
                asOf={asOf}
              />
              <AssistPanel
                key={`assist-${asOf ?? site.scenario.as_of}`}
                site={site}
                asOf={asOf}
              />
              <footer className="workspace-footer">
                <span>
                  <Leaf size={14} />
                  One operating question. Construction today; farms, mines and
                  forests next.
                </span>
                <button onClick={() => setSources(true)}>
                  Data & provenance <ArrowRight size={13} />
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      <dialog
        ref={dialog}
        className={photo ? "photo-dialog" : "source-dialog"}
        onCancel={closeDialog}
        onClose={() => {
          setSources(false);
          setPhoto(false);
        }}
        aria-label={
          photo ? "Synthetic inspection image" : "Data sources and provenance"
        }
      >
        <button
          className="dialog-close"
          aria-label="Close dialog"
          onClick={closeDialog}
        >
          <X size={20} />
        </button>
        {photo ? (
          <>
            <img
              src={observation?.image_path || ""}
              alt="Enlarged synthetic inspection scene"
            />
            <p>{observation?.image_caption}</p>
          </>
        ) : (
          <>
            <span className="eyebrow">TRANSPARENT BY DESIGN</span>
            <h2>Every observation has a source.</h2>
            <p>
              The base aerial is real. The operating scenario, equipment,
              measurements and inspection illustration are synthetic.
            </p>
            <dl>
              <dt>Aerial base</dt>
              <dd>
                USDA NAIP · USGS National Map
                <br />
                Acquired May 19, 2022 · 0.6 m source resolution
                <br />
                Public domain. Cupertino, California area.
              </dd>
              <dt>Inspection illustration</dt>
              <dd>
                Generated with OpenAI ImageGen. It depicts a fictional muddy
                road and is not an observation of the mapped location.
              </dd>
              <dt>Ground measurements</dt>
              <dd>
                Explicit synthetic fixtures. Photographs do not determine
                bearing capacity or soil moisture in this prototype.
              </dd>
              <dt>Source confidence</dt>
              <dd>
                Confidence assigned to each demo observation. It is not a
                calibrated probability that a machine can operate safely.
              </dd>
            </dl>
            <a
              href="https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip"
              target="_blank"
              rel="noreferrer"
            >
              View USGS source documentation <ArrowUpRight size={14} />
            </a>
          </>
        )}
      </dialog>
    </div>
  );
}
