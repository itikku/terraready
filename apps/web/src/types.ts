export type Status = "GO" | "INSPECT" | "NO_GO";
export interface Point {
  x_m: number;
  y_m: number;
}
export interface Zone {
  id: string;
  name: string;
  polygon: Point[];
  slope_deg: number;
  closed: boolean;
}
export interface Machine {
  id: string;
  name: string;
  operating_mass_t: number;
  ground_pressure_kpa: number;
  max_moisture_fraction: number;
  operations: string[];
}
export interface Route {
  id: string;
  name: string;
  zone_ids: string[];
  path: Point[];
  distance_m: number;
}
export interface Task {
  id: string;
  name: string;
  zone_id: string;
  operation: string;
  assigned_machine_id: string;
  route_id: string;
  target_quantity: number;
  quantity_unit: string;
  duration_hours: number;
  priority: number;
}
export interface Observation {
  id: string;
  zone_id: string;
  observed_at: string;
  source: string;
  note: string;
  confidence: number;
  access: string;
  moisture_fraction: number | null;
  bearing_capacity_kpa: number | null;
  image_path: string | null;
  image_caption: string | null;
}
export interface Site {
  scenario: {
    id: string;
    name: string;
    summary: string;
    as_of: string;
    rain_ended_at: string;
    rainfall_24h_mm: number;
    max_evidence_age_hours: number;
    min_evidence_confidence: number;
  };
  zones: Zone[];
  machines: Machine[];
  routes: Route[];
  tasks: Task[];
  observations: Observation[];
}
export interface Reason {
  code: string;
  message: string;
  evidence_ids: string[];
}
export interface ZoneDecision {
  zone_id: string;
  status: Status;
  reasons: Reason[];
  confidence: number | null;
  evidence_ids: string[];
  mitigations: string[];
}
export interface Readiness {
  machine_id: string;
  zones: ZoneDecision[];
}
export interface Evaluation {
  route_id: string;
  status: Status;
  reasons: Reason[];
  zone_decisions: ZoneDecision[];
  mitigations: string[];
  as_of: string;
}
export interface PlanItem {
  task_id: string;
  baseline: Evaluation;
  alternatives: Evaluation[];
  selected_route_id: string | null;
  status: Status;
}
export interface TeamUpdate {
  role: "Field lead" | "Haul coordinator";
  title: string;
  body: string;
}
export interface Approval {
  plan_id: string;
  evaluated_at: string;
  approved_at: string;
  approved_by: string;
  updates: TeamUpdate[];
}
export interface ShiftPlan {
  id: string;
  as_of: string;
  review_by: string | null;
  items: PlanItem[];
  baseline_eligible_count: number;
  proposed_eligible_count: number;
  assumptions: string[];
  approval: Approval | null;
}

export interface AssistRun {
  id: string;
  source_plan_id: string;
  mode: "local_model" | "test_stub" | "deterministic_fallback";
  model_id: string;
  focus: "overview" | "reroute" | "redeploy" | "blocked";
  candidate_ids: string[];
  held_task_ids: string[];
  facts: {
    task_id: string;
    candidate_id: string | null;
    text: string;
    evidence_ids: string[];
  }[];
  trace: {
    step: number;
    tool: string;
    outcome: string;
    reference_ids: string[];
    evidence_ids: string[];
    elapsed_ms: number;
    inference_ms: number;
    completion_tokens: number;
  }[];
  elapsed_ms: number;
  fallback_reason: string | null;
  saved_locally: boolean;
}

export interface RecoveryPlan {
  id: string;
  as_of: string;
  review_by: string | null;
  selected_candidate_ids: string[];
  candidates: {
    id: string;
    task_id: string;
    machine_id: string;
    route_id: string;
    required_hours: number;
  }[];
  items: {
    task_id: string;
    disposition: string;
    reasons: Reason[];
    blocking_task_ids: string[];
  }[];
  resources: {
    machine_id: string;
    available_hours: number;
    proposed_hours: number;
    unallocated_hours: number;
  }[];
  assumptions: string[];
  approval: Approval | null;
}

export interface GpuTestEvidence {
  provider: "Runpod";
  gpu_name: string;
  gpu_count: 1;
  gpu_vram_mib: number;
  driver_version: string;
  region: string;
  container_image_sha256: string;
  container_memory_limit_bytes: number;
  allocated_vcpu: number;
  cpu_quota_cores: number;
  sampled_peak_gpu_mib: number;
  sampled_peak_container_memory_bytes: number;
  sampled_services_rss_kib: number;
  resource_sample_count: number;
  sample_interval_seconds: number;
  stack_ready_seconds: number;
  first_request_ms: number;
  warm_request_ms: number[];
  warm_passed: number;
  warm_p50_ms: number;
  warm_p95_ms: number;
  browser_journey_passed: boolean;
  model_outage_passed: boolean;
  evidence_expiry_passed: boolean;
  restart_probe_passed: boolean;
  operating_snapshot_unchanged: boolean;
  cleanup_verified: boolean;
  started_at: string;
  terminated_at: string;
  billing_status: "pending" | "recorded";
  observed_balance_decrease_usd: number | null;
  provider_charge_usd: number | null;
  usage_ceiling_usd: 5;
  egress_denial: "deferred_unverified";
}

export interface SystemEvidence {
  data_ready: boolean;
  runtime: {
    reachable: boolean;
    mode: "local_model" | "test_stub";
    model_id: string;
    checked_at: string;
    meaning: string;
  };
  verification: {
    status: "recorded" | "missing" | "invalid";
    evidence: null | {
      recorded_at: string;
      source_base_commit: string;
      working_tree_dirty: boolean;
      source_sha256: Record<string, string>;
      dataset_sha256: string;
      model: {
        model_id: string;
        revision: string;
        weights_sha256: string;
        license: string;
        runtime_tag: string;
        runtime_commit: string;
      };
      hardware: {
        host: string;
        os: string;
        architecture: string;
        host_memory_bytes: number | null;
        gpu_layers_requested: number;
        cpu_threads: number;
        context_size: number;
      };
      cases: {
        name: string;
        passed: boolean;
        mode: string;
        elapsed_ms: number;
        tools: string[];
        task_ids: string[];
        evidence_ids: string[];
      }[];
      limitations: string[];
      gpu_test?: GpuTestEvidence | null;
    };
  };
  gpu_verification?: SystemEvidence["verification"];
}

export interface CameraView {
  mode: "demo_stub" | "external_snapshot";
  status: "stub" | "available" | "unavailable";
  snapshot: null | {
    camera_id: string;
    snapshot_id: string;
    captured_at: string;
    media_type: "image/jpeg" | "image/png";
    sha256: string;
    image_base64: string;
  };
}
