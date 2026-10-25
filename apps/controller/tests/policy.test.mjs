import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dayAt,
  initialLedger,
  nextDeadline,
  POLICY,
  transition,
} from "../dist/policy.js";

const minute = 60_000;
const now = Date.parse("2026-10-26T17:00:00Z");
const quote = (time = now, hourly = 100_000) => ({
  id: "synthetic-quote",
  hourly,
  fixed: 10_000,
  validUntil: time + minute,
});
const amount = (values) => Object.values(values).reduce((a, b) => a + b, 0);

function harness(time = now, hourly = 100_000, state = initialLedger()) {
  let current = state;
  let clock = time;
  const send = (event, at = clock, expected = null) => {
    clock = at;
    const result = transition(current, event, at);
    assert.equal(result.error, expected);
    current = result.state;
    return current;
  };
  const read = () => current.runs.at(-1);
  send({ type: "reserve", key: "run-one", quote: quote(time, hourly) });
  const start = () => {
    send(
      { type: "created", key: "run-one", resourceId: "pod-one" },
      time + minute,
    );
    send({ type: "ready", key: "run-one" }, time + 2 * minute);
    send({ type: "open", key: "run-one" }, time + 3 * minute);
  };
  return { send, read, start, state: () => current };
}

test("prior billed usage is conservatively rounded and seeded once", () => {
  const state = initialLedger();
  assert.equal(state.totalSpent, 146_056);
  assert.deepEqual(state.spent, { "2026-10-25": 146_056 });
  assert.equal(POLICY.daily, 1_500_000);
  assert.equal(POLICY.lifetime, 5_000_000);
});

test("a single whole-host reservation includes setup, ready waiting, active use and cleanup", () => {
  const h = harness();
  assert.equal(h.read().reserveUntil - now, 155 * minute);
  assert.equal(h.read().costStopAt, h.read().reserveUntil - POLICY.shutdownMs);
  assert.equal(
    amount(h.read().reserved),
    Math.ceil((100_000 * 155) / 60) + 10_000,
  );
  assert.equal(
    h.state().totalSpent,
    146_056,
    "reservation is not booked as settled spend",
  );
});

test("concurrent visitors share one reservation and cannot renew its active deadline", () => {
  const h = harness();
  h.start();
  const first = structuredClone(h.read());
  for (let visitor = 0; visitor < 10; visitor++)
    h.send({ type: "open", key: "run-one" }, now + 4 * minute);
  assert.equal(h.read().firstUseAt, first.firstUseAt);
  assert.equal(h.read().activeEndAt, first.activeEndAt);
  assert.deepEqual(h.read().reserved, first.reserved);
  assert.equal(h.state().runs.length, 1);
});

test("setup and polling do not start or refresh the first-use/idle clock", () => {
  const h = harness();
  h.send(
    { type: "created", key: "run-one", resourceId: "pod-one" },
    now + minute,
  );
  h.send({ type: "ready", key: "run-one" }, now + 2 * minute);
  h.send({ type: "tick" }, now + 11 * minute);
  assert.equal(h.read().firstUseAt, null);
  h.send({ type: "tick" }, now + 12 * minute);
  assert.equal(h.read().phase, "stopping");
  assert.equal(h.read().stopReason, "idle");
  h.send(
    { type: "open", key: "run-one" },
    now + 12 * minute,
    "run_unavailable",
  );
});

test("setup deadline persists even if create has an uncertain outcome", () => {
  const h = harness();
  h.send({ type: "uncertain", key: "run-one" });
  h.send(
    { type: "reserve", key: "run-two", quote: quote() },
    now,
    "run_unsettled",
  );
  h.send({ type: "tick" }, now + 20 * minute);
  assert.equal(h.read().phase, "stopping");
  assert.equal(h.read().stopReason, "setup");
  h.send({ type: "created", key: "run-one", resourceId: "pod-late" });
  assert.equal(
    h.read().phase,
    "stopping",
    "a reconciled late create still requires termination",
  );
  assert.equal(h.read().resourceId, "pod-late");
});

test("active use ends after two hours despite sustained interactive activity", () => {
  const h = harness();
  h.start();
  for (let m = 12; m < 123; m += 9)
    h.send({ type: "activity", key: "run-one" }, now + m * minute);
  h.send(
    { type: "activity", key: "run-one" },
    now + 123 * minute,
    "run_unavailable",
  );
  assert.equal(h.read().stopReason, "active");
  assert.equal(h.read().activeEndAt, now + 123 * minute);
});

test("idle use stops at ten minutes and activity at the boundary cannot resurrect it", () => {
  const h = harness();
  h.start();
  h.send(
    { type: "activity", key: "run-one" },
    now + 13 * minute,
    "run_unavailable",
  );
  assert.equal(h.read().stopReason, "idle");
  assert.equal(h.read().lastUseAt, now + 3 * minute);
});

test("daily budget can end use before two hours, retaining five minutes for shutdown", () => {
  const time = Date.parse("2026-10-25T17:00:00Z");
  const h = harness(time, 600_000);
  h.send(
    { type: "created", key: "run-one", resourceId: "pod-one" },
    time + minute,
  );
  h.send({ type: "ready", key: "run-one" }, time + 19 * minute);
  h.send({ type: "open", key: "run-one" }, time + 20 * minute);
  const run = structuredClone(h.read());
  assert.ok(run.costStopAt < run.activeEndAt);
  assert.ok(amount(run.reserved) + 146_056 <= POLICY.daily);
  for (let t = time + 29 * minute; t < run.costStopAt; t += 9 * minute)
    h.send({ type: "activity", key: "run-one" }, t);
  h.send({ type: "tick" }, run.costStopAt);
  assert.equal(h.read().stopReason, "cost");
  assert.equal(run.reserveUntil - run.costStopAt, 5 * minute);
});

test("same start key is idempotent regardless of field order, changed quote is rejected", () => {
  const h = harness();
  const q = quote();
  h.send({
    type: "reserve",
    key: "run-one",
    quote: {
      validUntil: q.validUntil,
      fixed: q.fixed,
      id: q.id,
      hourly: q.hourly,
    },
  });
  h.send(
    { type: "reserve", key: "run-one", quote: { ...q, hourly: 200_000 } },
    now,
    "idempotency_conflict",
  );
  assert.equal(h.state().runs.length, 1);
});

test("wrong resource ID cannot replace the lease or confirm termination", () => {
  const h = harness();
  h.start();
  h.send(
    { type: "created", key: "run-one", resourceId: "other-pod" },
    now + 4 * minute,
    "resource_conflict",
  );
  h.send(
    { type: "terminated", key: "run-one", resourceId: "other-pod" },
    now + 4 * minute,
    "resource_conflict",
  );
  h.send(
    { type: "absent", key: "run-one" },
    now + 4 * minute,
    "resource_conflict",
  );
  assert.equal(h.read().resourceId, "pod-one");
});

test("neither shutdown intent nor unconfirmed billing releases reservations", () => {
  const h = harness();
  h.start();
  const actual = { "2026-10-26": 30_000 };
  h.send({ type: "stop", key: "run-one" });
  h.send(
    { type: "settle", key: "run-one", actual },
    now + 4 * minute,
    "termination_unconfirmed",
  );
  h.send({ type: "terminated", key: "run-one", resourceId: "pod-one" });
  h.send(
    { type: "reserve", key: "run-two", quote: quote(now + 4 * minute) },
    now + 4 * minute,
    "run_unsettled",
  );
  h.send({ type: "settle", key: "run-one", actual });
  assert.equal(h.state().totalSpent, 176_056);
  h.send({ type: "settle", key: "run-one", actual });
  assert.equal(
    h.state().totalSpent,
    176_056,
    "duplicate invoice must not double count",
  );
  h.send(
    { type: "settle", key: "run-one", actual: { "2026-10-26": 20_000 } },
    now + 4 * minute,
    "settlement_conflict",
  );
  h.send({ type: "reserve", key: "run-two", quote: quote(now + 4 * minute) });
  assert.equal(h.state().runs.length, 2);
});

test("verified absence reconciles uncertain create without silently releasing its charge", () => {
  const h = harness();
  h.send({ type: "uncertain", key: "run-one" });
  h.send({ type: "absent", key: "run-one" }, now + minute);
  h.send(
    { type: "reserve", key: "run-two", quote: quote(now + minute) },
    now + minute,
    "run_unsettled",
  );
  h.send({ type: "settle", key: "run-one", actual: { "2026-10-26": 0 } });
  h.send({ type: "reserve", key: "run-two", quote: quote(now + minute) });
});

test("an invoice beyond its reservation is recorded and blocks subsequent admission", () => {
  const h = harness();
  h.start();
  h.send(
    { type: "terminated", key: "run-one", resourceId: "pod-one" },
    now + 4 * minute,
  );
  h.send({
    type: "settle",
    key: "run-one",
    actual: { "2026-10-26": 1_600_000 },
  });
  assert.equal(h.state().accountingHold, true);
  assert.equal(
    h.state().totalSpent,
    1_746_056,
    "unexpected cost is not hidden",
  );
  h.send(
    { type: "reserve", key: "run-two", quote: quote(now + 4 * minute) },
    now + 4 * minute,
    "accounting_hold",
  );
});

test("cross-midnight reservation splits elapsed rental cost and charges fixed costs only once", () => {
  const time = Date.parse("2026-10-27T06:50:00Z"); // 23:50 Los Angeles
  const h = harness(time);
  assert.deepEqual(h.read().reserved, {
    "2026-10-26": 26_667,
    "2026-10-27": 241_667,
  });
  const reservation = structuredClone(h.read().reserved);
  h.send({ type: "tick" }, time + 11 * minute);
  assert.deepEqual(
    h.read().reserved,
    reservation,
    "a new day cannot reset an existing run",
  );
  h.send(
    { type: "reserve", key: "run-two", quote: quote(time + 11 * minute) },
    time + 11 * minute,
    "run_unsettled",
  );
});

test("remaining daily allowance before midnight cannot be borrowed from tomorrow", () => {
  const time = Date.parse("2026-10-27T06:50:00Z");
  const state = initialLedger();
  state.spent["2026-10-26"] = 1_490_000;
  state.totalSpent += 1_490_000;
  const result = transition(
    state,
    { type: "reserve", key: "run-one", quote: quote(time) },
    time,
  );
  assert.equal(result.error, "budget_exhausted");
  assert.equal(result.state.runs.length, 0);
});

test("lifetime allowance never resets on a new day", () => {
  const state = initialLedger();
  state.spent["2026-10-22"] = 1_500_000;
  state.spent["2026-10-23"] = 1_500_000;
  state.spent["2026-10-24"] = 1_400_000;
  state.totalSpent += 4_400_000;
  const h = harness(now, 600_000, state);
  assert.ok(amount(h.read().reserved) <= 453_944);
  assert.ok(h.read().reserveUntil < now + 46 * minute);
  const exhausted = structuredClone(state);
  exhausted.spent["2026-10-21"] = 450_000;
  exhausted.totalSpent += 450_000;
  assert.equal(
    transition(
      exhausted,
      { type: "reserve", key: "other", quote: quote() },
      now,
    ).error,
    "budget_exhausted",
  );
});

for (const [name, time] of [
  ["spring forward", "2026-03-08T09:30:00Z"],
  ["fall back", "2026-11-01T08:30:00Z"],
]) {
  test(`DST ${name} changes neither elapsed-time rental nor active-run duration`, () => {
    const timeMs = Date.parse(time);
    const h = harness(timeMs);
    h.start();
    assert.equal(h.read().activeEndAt - h.read().firstUseAt, 120 * minute);
    assert.equal(h.read().reserveUntil - timeMs, 155 * minute);
    assert.equal(Object.keys(h.read().reserved).length, 1);
    assert.equal(amount(h.read().reserved), 268_334);
    assert.equal(dayAt(timeMs), time.slice(0, 10));
  });
}

test("untrusted malformed fields, negative money, stale quotes and reversed clocks fail closed", () => {
  const h = harness();
  const before = structuredClone(h.state());
  for (const event of [
    null,
    [],
    { type: "unknown" },
    { type: "tick", now: now + minute },
    { type: "ready", key: "../" },
    { type: "reserve", key: "evil", quote: { ...quote(), hourly: -1 } },
    { type: "settle", key: "run-one", actual: { "2026-02-30": 0 } },
  ]) {
    assert.ok(transition(before, event, now).error);
  }
  const stale = transition(
    initialLedger(),
    { type: "reserve", key: "stale", quote: { ...quote(), validUntil: now } },
    now,
  );
  assert.equal(stale.error, "quote_expired");
  assert.throws(
    () => transition(before, { type: "tick" }, now - 1),
    /invalid_clock/,
  );
  assert.deepEqual(
    h.state(),
    before,
    "reducer never mutates the supplied persisted state",
  );
});

test("the next alarm is the earliest setup, idle, active or cost deadline", () => {
  const h = harness();
  assert.deepEqual(nextDeadline(h.read()), {
    at: now + 20 * minute,
    reason: "setup",
  });
  h.start();
  assert.deepEqual(nextDeadline(h.read()), {
    at: now + 13 * minute,
    reason: "idle",
  });
  h.send({ type: "stop", key: "run-one" });
  assert.equal(nextDeadline(h.read()), null);
});
