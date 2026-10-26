// Monetary values are integer microdollars, rounded upward at each day boundary.
export const POLICY = {
  daily: 2_000_000,
  lifetime: 10_000_000,
  timezone: "America/Los_Angeles",
  setupMs: 20 * 60_000,
  idleMs: 30 * 60_000,
  activeMs: 120 * 60_000,
  shutdownMs: 5 * 60_000,
} as const;

export interface Quote {
  id: string;
  hourly: number;
  fixed: number;
  validUntil: number;
}

export interface Run {
  key: string;
  quote: Quote;
  phase:
    "reserved" | "ready" | "active" | "stopping" | "terminated" | "settled";
  createdAt: number;
  costStopAt: number;
  reserveUntil: number;
  reserved: Record<string, number>;
  resourceId: string | null;
  uncertainCreate: boolean;
  readyAt: number | null;
  firstUseAt: number | null;
  lastUseAt: number | null;
  activeEndAt: number | null;
  stopReason: string | null;
  terminatedAt: number | null;
  actual: Record<string, number> | null;
  costBasis?: "provider_invoice" | "operator_conservative_upper_bound";
  providerInvoicePending?: boolean;
}

export interface Ledger {
  version: 1;
  lastTime: number;
  spent: Record<string, number>;
  totalSpent: number;
  accountingHold: boolean;
  runs: Run[];
}

export type Event =
  | { type: "reserve"; key: string; quote: Quote }
  | { type: "created" | "terminated"; key: string; resourceId: string }
  | {
      type: "ready" | "open" | "activity" | "uncertain" | "absent" | "stop";
      key: string;
    }
  | {
      type: "settle";
      key: string;
      actual: Record<string, number>;
      basis?: "provider_invoice" | "operator_conservative_upper_bound";
    }
  | { type: "tick" };

class Rejected extends Error {}

function requireThat(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Rejected(reason);
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function day(value: string): boolean {
  return (
    /^20\d\d-\d\d-\d\d$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function amounts(value: unknown): value is Record<string, number> {
  return (
    record(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
      ([key, amount]) => day(key) && integer(amount),
    ) &&
    Number.isSafeInteger(
      Object.values(value).reduce<number>((a, b) => a + Number(b), 0),
    )
  );
}

function parseEvent(input: unknown): Event {
  requireThat(record(input) && typeof input.type === "string", "invalid_event");
  const fields = ["type"];
  if (input.type !== "tick") {
    fields.push("key");
    requireThat(identifier(input.key), "invalid_key");
  }
  switch (input.type) {
    case "reserve":
      fields.push("quote");
      requireThat(record(input.quote), "invalid_quote");
      requireThat(
        Object.keys(input.quote).sort().join() ===
          "fixed,hourly,id,validUntil" &&
          identifier(input.quote.id) &&
          integer(input.quote.hourly, 1) &&
          input.quote.hourly <= POLICY.lifetime &&
          integer(input.quote.fixed) &&
          input.quote.fixed <= POLICY.daily &&
          integer(input.quote.validUntil),
        "invalid_quote",
      );
      break;
    case "created":
    case "terminated":
      fields.push("resourceId");
      requireThat(identifier(input.resourceId), "invalid_resource");
      break;
    case "settle":
      fields.push("actual");
      requireThat(amounts(input.actual), "invalid_actual_cost");
      if ("basis" in input) {
        fields.push("basis");
        requireThat(
          ["provider_invoice", "operator_conservative_upper_bound"].includes(
            String(input.basis),
          ),
          "invalid_cost_basis",
        );
      }
      break;
    case "ready":
    case "open":
    case "activity":
    case "uncertain":
    case "absent":
    case "stop":
    case "tick":
      break;
    default:
      throw new Rejected("invalid_event");
  }
  requireThat(
    Object.keys(input).sort().join() === fields.sort().join(),
    "unexpected_fields",
  );
  return input as unknown as Event;
}

export function initialLedger(): Ledger {
  // Provider charge $0.14605502702761441, conservatively rounded up once.
  return {
    version: 1,
    lastTime: 0,
    spent: { "2026-10-25": 146_056 },
    totalSpent: 146_056,
    accountingHold: false,
    runs: [],
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: POLICY.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayAt(time: number): string {
  const parts = dateFormatter.formatToParts(time);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// A lease is at most 175 minutes, so it touches at most two local calendar days.
function windows(start: number, end: number) {
  const firstDay = dayAt(start);
  if (firstDay === dayAt(end - 1)) return [{ day: firstDay, start, end }];
  let low = start;
  let high = end;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayAt(middle) === firstDay) low = middle;
    else high = middle;
  }
  return [
    { day: firstDay, start, end: high },
    { day: dayAt(high), start: high, end },
  ];
}

const total = (value: Record<string, number>) =>
  Object.values(value).reduce((a, b) => a + b, 0);

export function assertLedger(value: unknown): asserts value is Ledger {
  requireThat(record(value), "invalid_ledger");
  requireThat(value.version === 1 && integer(value.lastTime), "invalid_ledger");
  requireThat(
    amounts(value.spent) && integer(value.totalSpent),
    "invalid_ledger",
  );
  const spent = value.spent;
  requireThat(
    typeof value.accountingHold === "boolean" && Array.isArray(value.runs),
    "invalid_ledger",
  );
  const expected = initialLedger().spent;
  const keys = new Set<string>();
  for (const item of value.runs) {
    requireThat(
      record(item) && identifier(item.key) && !keys.has(item.key),
      "invalid_ledger",
    );
    keys.add(item.key);
    parseEvent({ type: "reserve", key: item.key, quote: item.quote });
    requireThat(
      [
        "reserved",
        "ready",
        "active",
        "stopping",
        "terminated",
        "settled",
      ].includes(String(item.phase)),
      "invalid_ledger",
    );
    requireThat(
      integer(item.createdAt) &&
        integer(item.reserveUntil) &&
        integer(item.costStopAt),
      "invalid_ledger",
    );
    requireThat(
      item.reserveUntil - item.createdAt >=
        POLICY.setupMs + POLICY.shutdownMs &&
        item.reserveUntil - item.createdAt <=
          POLICY.setupMs +
            POLICY.idleMs +
            POLICY.activeMs +
            POLICY.shutdownMs &&
        item.costStopAt === item.reserveUntil - POLICY.shutdownMs,
      "invalid_ledger",
    );
    requireThat(
      amounts(item.reserved) && total(item.reserved) > 0,
      "invalid_ledger",
    );
    requireThat(
      (item.resourceId === null || identifier(item.resourceId)) &&
        typeof item.uncertainCreate === "boolean",
      "invalid_ledger",
    );
    for (const field of [
      "readyAt",
      "firstUseAt",
      "lastUseAt",
      "activeEndAt",
      "terminatedAt",
    ]) {
      requireThat(
        item[field] === null || integer(item[field], item.createdAt),
        "invalid_ledger",
      );
    }
    if (item.firstUseAt !== null)
      requireThat(
        item.activeEndAt === Number(item.firstUseAt) + POLICY.activeMs &&
          item.lastUseAt !== null,
        "invalid_ledger",
      );
    if (item.phase === "ready" || item.phase === "active")
      requireThat(
        item.resourceId !== null && item.readyAt !== null,
        "invalid_ledger",
      );
    if (item.phase === "active")
      requireThat(item.firstUseAt !== null, "invalid_ledger");
    if (item.phase === "settled" || item.phase === "terminated")
      requireThat(item.terminatedAt !== null, "invalid_ledger");
    if (item.phase === "settled") {
      requireThat(amounts(item.actual), "invalid_ledger");
      for (const [date, cost] of Object.entries(item.actual))
        expected[date] = (expected[date] ?? 0) + cost;
    } else requireThat(item.actual === null, "invalid_ledger");
  }
  requireThat(
    Object.keys(expected).length === Object.keys(value.spent).length &&
      Object.entries(expected).every(([date, cost]) => spent[date] === cost) &&
      value.totalSpent === total(expected),
    "invalid_ledger",
  );
}

function reserve(state: Ledger, key: string, quote: Quote, now: number): void {
  const prior = state.runs.find((run) => run.key === key);
  if (prior) {
    requireThat(
      prior.quote.id === quote.id &&
        prior.quote.hourly === quote.hourly &&
        prior.quote.fixed === quote.fixed &&
        prior.quote.validUntil === quote.validUntil,
      "idempotency_conflict",
    );
    return;
  }
  requireThat(!state.accountingHold, "accounting_hold");
  requireThat(
    state.runs.every((run) => run.phase === "settled"),
    "run_unsettled",
  );
  requireThat(quote.validUntil > now, "quote_expired");
  const maximum =
    POLICY.setupMs + POLICY.idleMs + POLICY.activeMs + POLICY.shutdownMs;
  const parts = windows(now, now + maximum);
  const cost = (duration: number) => {
    const values: Record<string, number> = {};
    for (const part of parts) {
      const elapsed = Math.max(
        0,
        Math.min(now + duration, part.end) - part.start,
      );
      if (elapsed > 0)
        values[part.day] = Math.ceil((quote.hourly * elapsed) / 3_600_000);
    }
    values[parts[0].day] += quote.fixed;
    return values;
  };
  const fits = (duration: number) => {
    const values = cost(duration);
    return (
      state.totalSpent + total(values) <= POLICY.lifetime &&
      Object.entries(values).every(
        ([date, value]) => (state.spent[date] ?? 0) + value <= POLICY.daily,
      )
    );
  };
  const minimum = POLICY.setupMs + POLICY.shutdownMs;
  requireThat(fits(minimum), "budget_exhausted");
  let low = minimum;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  state.runs.push({
    key,
    quote: { ...quote },
    phase: "reserved",
    createdAt: now,
    costStopAt: now + low - POLICY.shutdownMs,
    reserveUntil: now + low,
    reserved: cost(low),
    resourceId: null,
    uncertainCreate: false,
    readyAt: null,
    firstUseAt: null,
    lastUseAt: null,
    activeEndAt: null,
    stopReason: null,
    terminatedAt: null,
    actual: null,
  });
}

export function nextDeadline(run: Run): { at: number; reason: string } | null {
  if (["stopping", "terminated", "settled"].includes(run.phase)) return null;
  const deadlines = [{ at: run.costStopAt, reason: "cost" }];
  if (run.phase === "reserved")
    deadlines.push({ at: run.createdAt + POLICY.setupMs, reason: "setup" });
  if (run.phase === "ready")
    deadlines.push({ at: run.readyAt! + POLICY.idleMs, reason: "idle" });
  if (run.phase === "active") {
    deadlines.push({ at: run.lastUseAt! + POLICY.idleMs, reason: "idle" });
    deadlines.push({ at: run.activeEndAt!, reason: "active" });
  }
  return deadlines.reduce((first, value) =>
    first.at <= value.at ? first : value,
  );
}

export function bookedBound(run: Run, endedAt: number): Record<string, number> {
  requireThat(
    integer(endedAt, run.createdAt) && endedAt - run.createdAt < 24 * 3_600_000,
    "unbounded_accounting",
  );
  const values: Record<string, number> = {};
  for (const part of windows(run.createdAt, endedAt)) {
    const elapsed = Math.max(0, Math.min(endedAt, part.end) - part.start);
    if (elapsed > 0)
      values[part.day] = Math.ceil((run.quote.hourly * elapsed) / 3_600_000);
  }
  values[dayAt(run.createdAt)] =
    (values[dayAt(run.createdAt)] ?? 0) + run.quote.fixed;
  return values;
}

function mutate(state: Ledger, event: Event, now: number): void {
  if (event.type === "tick") return;
  if (event.type === "reserve")
    return reserve(state, event.key, event.quote, now);
  const run = state.runs.find((value) => value.key === event.key);
  requireThat(run, "unknown_run");
  switch (event.type) {
    case "created":
      requireThat(
        run.phase !== "terminated" && run.phase !== "settled",
        "run_closed",
      );
      requireThat(
        run.resourceId === null || run.resourceId === event.resourceId,
        "resource_conflict",
      );
      run.resourceId = event.resourceId;
      run.uncertainCreate = false;
      break;
    case "uncertain":
      requireThat(
        run.resourceId === null &&
          run.phase !== "terminated" &&
          run.phase !== "settled",
        "invalid_phase",
      );
      run.uncertainCreate = true;
      break;
    case "ready":
      requireThat(
        run.phase === "reserved" && run.resourceId !== null,
        "invalid_phase",
      );
      run.phase = "ready";
      run.readyAt = now;
      break;
    case "open":
      requireThat(
        run.phase === "ready" || run.phase === "active",
        "run_unavailable",
      );
      if (run.firstUseAt === null) {
        run.firstUseAt = now;
        run.activeEndAt = now + POLICY.activeMs;
      }
      run.phase = "active";
      run.lastUseAt = now;
      break;
    case "activity":
      requireThat(run.phase === "active", "run_unavailable");
      run.lastUseAt = now;
      break;
    case "stop":
      requireThat(
        run.phase !== "terminated" && run.phase !== "settled",
        "run_closed",
      );
      run.phase = "stopping";
      run.stopReason ??= "owner";
      break;
    case "terminated":
      requireThat(run.resourceId === event.resourceId, "resource_conflict");
      if (run.phase === "settled" || run.phase === "terminated") return;
      run.phase = "terminated";
      run.terminatedAt = now;
      break;
    case "absent":
      requireThat(
        run.resourceId === null && run.phase !== "settled",
        "resource_conflict",
      );
      run.phase = "terminated";
      run.uncertainCreate = false;
      run.terminatedAt ??= now;
      break;
    case "settle":
      if (run.phase === "settled") {
        requireThat(
          Object.keys(run.actual!).length ===
            Object.keys(event.actual).length &&
            Object.entries(event.actual).every(
              ([date, value]) => run.actual![date] === value,
            ),
          "settlement_conflict",
        );
        return;
      }
      requireThat(run.phase === "terminated", "termination_unconfirmed");
      if (
        Object.entries(event.actual).some(
          ([date, value]) => value > (run.reserved[date] ?? 0),
        )
      ) {
        state.accountingHold = true;
      }
      run.actual = { ...event.actual };
      if (event.basis) {
        run.costBasis = event.basis;
        run.providerInvoicePending =
          event.basis === "operator_conservative_upper_bound";
      }
      run.phase = "settled";
      for (const [date, value] of Object.entries(event.actual))
        state.spent[date] = (state.spent[date] ?? 0) + value;
      state.totalSpent += total(event.actual);
      break;
  }
}

export function transition(state: Ledger, input: unknown, now: number) {
  requireThat(
    integer(now, state.lastTime) && now <= 4_102_444_800_000,
    "invalid_clock",
  );
  const advanced = structuredClone(state);
  advanced.lastTime = now;
  for (const run of advanced.runs) {
    const deadline = nextDeadline(run);
    if (deadline && now >= deadline.at) {
      run.phase = "stopping";
      run.stopReason = deadline.reason;
    }
  }
  const changed = structuredClone(advanced);
  try {
    mutate(changed, parseEvent(input), now);
    return { state: changed, error: null };
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    // A rejected action must not roll back an already-due shutdown intent.
    return { state: advanced, error: error.message };
  }
}
