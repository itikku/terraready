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
