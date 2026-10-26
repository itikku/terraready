import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const worker = path.resolve("dist/worker.js");
const modules = [
  { type: "ESModule", path: worker, contents: await readFile(worker, "utf8") },
  {
    type: "ESModule",
    path: path.resolve("dist/policy.js"),
    contents: await readFile("dist/policy.js", "utf8"),
  },
  {
    type: "ESModule",
    path: path.resolve("dist/gateway.js"),
    contents: await readFile("dist/gateway.js", "utf8"),
  },
  {
    type: "ESModule",
    path: path.resolve("dist/provider.js"),
    contents: await readFile("dist/provider.js", "utf8"),
  },
  {
    type: "ESModule",
    path: path.resolve("dist/page.js"),
    contents: await readFile("dist/page.js", "utf8"),
  },
];
const emulator = (configuration) =>
  new Miniflare(convertV4MiniflareOptions(configuration));
const options = (persist) => ({
  modules,
  compatibilityDate: "2026-10-19",
  durableObjects: { BUDGET: { className: "BudgetLedger", useSQLite: true } },
  resourcePersistencePath: persist,
  isolatedResourcePersistencePath: persist,
  telemetry: { enabled: false },
  host: "127.0.0.1",
  port: 0,
  // Any accidental external call from the Worker is rejected in this proof.
  outboundService: () =>
    new Response("External requests disabled", { status: 503 }),
});
const quote = () => ({
  id: "synthetic-quote",
  hourly: 100_000,
  fixed: 10_000,
  validUntil: Date.now() + 60_000,
});
async function ledger(mf) {
  const ns = await mf.getDurableObjectNamespace("BUDGET");
  return ns.get(ns.idFromName("terraready-project"));
}
async function fixture(t) {
  const persist = await mkdtemp(path.join(tmpdir(), "terraready-ledger-test-"));
  let mf = emulator(options(persist));
  t.after(async () => {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  });
  return {
    mf: () => mf,
    stub: () => ledger(mf),
    restart: async () => {
      await mf.dispose();
      mf = emulator(options(persist));
    },
  };
}

test("public Worker fails closed for every start/status route and method", async (t) => {
  const f = await fixture(t);
  for (const pathname of ["/", "/api/start", "/api/status", "/api/open"]) {
    for (const method of ["GET", "POST"]) {
      const response = await f
        .mf()
        .dispatchFetch(`http://localhost${pathname}`, { method });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match((await response.json()).reason, /not configured/);
    }
  }
});

test("ten simultaneous retries atomically persist one reservation across emulator restart", async (t) => {
  const f = await fixture(t);
  const stub = await f.stub();
  const event = { type: "reserve", key: "same-start", quote: quote() };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => stub.apply(event)),
  );
  for (const result of results) {
    assert.equal(result.error, null);
    assert.equal(result.state.runs.length, 1);
  }
  const before = results.at(-1).state;
  await f.restart();
  const after = await (await f.stub()).apply({ type: "tick" });
  assert.equal(after.error, null);
  assert.deepEqual(after.state.runs, before.runs);
  assert.deepEqual(after.state.spent, before.spent);
  assert.equal(
    after.state.totalSpent,
    146_056,
    "historical cost is not reseeded on restart",
  );
});

test("ten competing starts admit one lease; uncertain create remains blocked after restart", async (t) => {
  const f = await fixture(t);
  const stub = await f.stub();
  const q = quote();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      stub.apply({ type: "reserve", key: `start-${i}`, quote: q }),
    ),
  );
  assert.equal(results.filter((result) => result.error === null).length, 1);
  assert.equal(
    results.filter((result) => result.error === "run_unsettled").length,
    9,
  );
  const key = results.find((result) => result.error === null).state.runs[0].key;
  await stub.apply({ type: "uncertain", key });
  await f.restart();
  const response = await (
    await f.stub()
  ).apply({ type: "reserve", key: "after-restart", quote: quote() });
  assert.equal(response.error, "run_unsettled");
  assert.equal(response.state.runs[0].uncertainCreate, true);
  assert.equal(response.state.runs.length, 1);
});

test("real SQLite persistence keeps first-use deadline, exact resource and pending invoice", async (t) => {
  const f = await fixture(t);
  let stub = await f.stub();
  const key = "ready-run";
  await stub.apply({ type: "reserve", key, quote: quote() });
  await stub.apply({ type: "created", key, resourceId: "synthetic-pod" });
  await stub.apply({ type: "ready", key });
  const first = await stub.apply({ type: "open", key });
  assert.equal(first.error, null);
  const activeEndAt = first.state.runs[0].activeEndAt;
  const firstUseAt = first.state.runs[0].firstUseAt;
  await f.restart();
  stub = await f.stub();
  const second = await stub.apply({ type: "open", key });
  assert.equal(second.state.runs[0].activeEndAt, activeEndAt);
  assert.equal(second.state.runs[0].firstUseAt, firstUseAt);
  assert.equal(
    (await stub.apply({ type: "terminated", key, resourceId: "wrong-pod" }))
      .error,
    "resource_conflict",
  );
  await stub.apply({ type: "terminated", key, resourceId: "synthetic-pod" });
  await f.restart();
  stub = await f.stub();
  assert.equal(
    (await stub.apply({ type: "reserve", key: "next-run", quote: quote() }))
      .error,
    "run_unsettled",
  );
  const current = await stub.apply({ type: "tick" });
  const actual = Object.fromEntries(
    Object.keys(current.state.runs[0].reserved).map((day) => [day, 1]),
  );
  const settled = await stub.apply({ type: "settle", key, actual });
  assert.equal(settled.error, null);
  const settledTotal = settled.state.totalSpent;
  await f.restart();
  stub = await f.stub();
  const repeat = await stub.apply({ type: "settle", key, actual });
  assert.equal(repeat.state.totalSpent, settledTotal);
  assert.equal(
    (await stub.apply({ type: "reserve", key: "next-run", quote: quote() }))
      .error,
    null,
  );
});

test("corrupt or unsupported stored accounting cannot silently become a new budget", async (t) => {
  const persist = await mkdtemp(
    path.join(tmpdir(), "terraready-corrupt-ledger-test-"),
  );
  const source = await readFile(worker, "utf8");
  const mf = emulator({
    ...options(persist),
    scriptPath: undefined,
    modules: [
      {
        type: "ESModule",
        path: worker,
        contents:
          source +
          `
        export class TestLedger extends BudgetLedger {
          corrupt(state) { this.ctx.storage.sql.exec("UPDATE ledger SET state=? WHERE id=1", state); }
        }
      `,
      },
      {
        type: "ESModule",
        path: path.resolve("dist/policy.js"),
        contents: await readFile("dist/policy.js", "utf8"),
      },
      modules[2],
      modules[3],
      modules[4],
    ],
    durableObjects: { BUDGET: { className: "TestLedger", useSQLite: true } },
  });
  t.after(async () => {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  });
  const stub = await ledger(mf);
  const clean = await stub.apply({ type: "tick" });
  for (const value of [
    "{",
    JSON.stringify({ ...clean.state, version: 2 }),
    JSON.stringify({ ...clean.state, totalSpent: -1 }),
    JSON.stringify({ ...clean.state, spent: {} }),
    JSON.stringify({ ...clean.state, totalSpent: 0 }),
  ]) {
    await stub.corrupt(value);
    await assert.rejects(
      stub.apply({ type: "reserve", key: "bad", quote: quote() }),
    );
  }
});

test("a real emulator alarm persists shutdown intent without a browser or provider call", async (t) => {
  const persist = await mkdtemp(path.join(tmpdir(), "terraready-alarm-test-"));
  const mf = emulator({
    ...options(persist),
    modules: [
      {
        ...modules[0],
        contents:
          modules[0].contents +
          `
        export class TestLedger extends BudgetLedger {
          readStored() {
            return JSON.parse(this.ctx.storage.sql.exec("SELECT state FROM ledger WHERE id=1").one().state);
          }
          async expireSetup() {
            const state = this.readStored();
            const run = state.runs[0];
            const shift = run.createdAt - (Date.now() - 21 * 60000);
            run.createdAt -= shift;
            run.costStopAt -= shift;
            run.reserveUntil -= shift;
            this.ctx.storage.sql.exec("UPDATE ledger SET state=? WHERE id=1", JSON.stringify(state));
            await this.ctx.storage.setAlarm(Date.now() + 1);
          }
        }
      `,
      },
      modules[1],
      modules[2],
      modules[3],
      modules[4],
    ],
    durableObjects: { BUDGET: { className: "TestLedger", useSQLite: true } },
  });
  t.after(async () => {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  });
  const stub = await ledger(mf);
  assert.equal(
    (await stub.apply({ type: "reserve", key: "alarm-run", quote: quote() }))
      .error,
    null,
  );
  await stub.expireSetup();
  let stored;
  for (let attempt = 0; attempt < 100; attempt++) {
    stored = await stub.readStored(); // Read raw SQL; do not advance the policy.
    if (stored.runs[0].phase === "stopping") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(stored.runs[0].phase, "stopping");
  assert.equal(stored.runs[0].stopReason, "setup");
  assert.equal(stored.runs[0].resourceId, null);
  assert.ok(
    Object.keys(stored.runs[0].reserved).length > 0,
    "alarm does not release its reservation",
  );
});

test("native Worker runtime can probe the provider transport without secret disclosure", async (t) => {
  const persist = await mkdtemp(
    path.join(tmpdir(), "terraready-provider-runtime-"),
  );
  const mf = emulator({
    ...options(persist),
    modules: [
      {
        ...modules[0],
        contents:
          modules[0].contents +
          `
      import { Runpod as ProbeRunpod } from "./provider.js";
      export class Probe extends BudgetLedger {
        async probe() { return new ProbeRunpod("synthetic-provider-key").diagnostics(); }
      }
    `,
      },
      ...modules.slice(1),
    ],
    durableObjects: { BUDGET: { className: "Probe", useSQLite: true } },
    outboundService: () => Response.json({ pods: [], gpus: [], records: [] }),
  });
  t.after(async () => {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  });
  const result = await (await ledger(mf)).probe();
  assert.equal(await result.pods, 200);
  assert.equal(await result.catalog, 200);
  assert.equal(await result.billing, 200);
});

async function lifecycleFixture(
  t,
  { ambiguous = false, deletionFails = false } = {},
) {
  const persist = await mkdtemp(path.join(tmpdir(), "terraready-lifecycle-"));
  let pod = null,
    creates = 0,
    deletes = 0;
  let failDelete = deletionFails;
  const config = {
    ...options(persist),
    bindings: {
      RUNPOD_API_KEY: "synthetic-provider-key",
      ACCESS_AUD: "synthetic-audience",
      OWNER_EMAIL: "owner@example.org",
      ORIGIN_SECRET: "ab".repeat(32),
      SOURCE_COMMIT: "c".repeat(40),
      SOURCE_SHA256: "d".repeat(64),
    },
    modules: [
      {
        ...modules[0],
        contents:
          modules[0].contents +
          `
      export class LifecycleTest extends BudgetLedger {
        readStored() {return JSON.parse(this.ctx.storage.sql.exec("SELECT state FROM ledger WHERE id=1").one().state);}
        async serviceNow() {await this.alarm();}
        resetCooldown() {this.ctx.storage.sql.exec("UPDATE launch_gate SET time=time-31000 WHERE id=1");}
      }
    `,
      },
      ...modules.slice(1),
    ],
    durableObjects: { BUDGET: { className: "LifecycleTest", useSQLite: true } },
    outboundService: async (request) => {
      const u = new URL(request.url);
      if (u.hostname.endsWith(".proxy.runpod.net"))
        return new Response("ready");
      assert.equal(u.origin, "https://api.runpod.io");
      assert.equal(
        request.headers.get("authorization"),
        "Bearer synthetic-provider-key",
      );
      if (u.pathname.startsWith("/v2/catalog/gpus/"))
        return Response.json({
          price: { secure: 0.59 },
          dataCenters: [{ id: "EU-RO-1", availability: "LOW" }],
        });
      if (u.pathname === "/v2/pods" && request.method === "POST") {
        creates++;
        const body = await request.json();
        assert.deepEqual(body.gpu, {
          id: "NVIDIA L4",
          count: 1,
          minCudaVersion: "12.8",
        });
        assert.deepEqual(body.ports, ["8000/http"]);
        assert.deepEqual(body.mounts, {});
        assert.equal(body.disk, 50);
        assert.equal(body.startSsh, false);
        assert.equal(body.startJupyter, false);
        assert.ok(!("RUNPOD_API_KEY" in body.env));
        assert.match(body.cmd[0], /sha256sum --check/);
        assert.match(body.cmd[0], /unset RUNPOD_API_KEY/);
        pod = {
          id: "syntheticpod01",
          name: body.name,
          env: body.env,
          createdAt: new Date().toISOString(),
          status: "RUNNING",
        };
        if (ambiguous) throw Error("synthetic lost response");
        return Response.json({ id: pod.id });
      }
      if (u.pathname === "/v2/pods")
        return Response.json({ pods: pod ? [pod] : [], hasNextPage: false });
      assert.equal(u.pathname, "/v2/pods/syntheticpod01");
      if (request.method === "DELETE") {
        deletes++;
        if (!failDelete) pod = null;
        return new Response(null, { status: failDelete ? 500 : 204 });
      }
      return pod ? Response.json(pod) : Response.json({}, { status: 404 });
    },
  };
  let mf = emulator(config);
  t.after(async () => {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  });
  return {
    stub: () => ledger(mf),
    http: (url, init) => mf.dispatchFetch(url, init),
    creates: () => creates,
    deletes: () => deletes,
    allowDelete: () => {
      failDelete = false;
    },
    restart: async () => {
      await mf.dispose();
      mf = emulator(config);
    },
  };
}

test("concurrent visitor starts create once; readiness, restart, exact cleanup and conservative booking persist", async (t) => {
  const f = await lifecycleFixture(t);
  let stub = await f.stub();
  await Promise.all(Array.from({ length: 10 }, () => stub.start()));
  assert.equal(f.creates(), 1);
  await stub.serviceNow();
  let state = await stub.readStored();
  assert.equal(state.runs[0].phase, "ready");
  await stub.apply({ type: "open", key: state.runs[0].key });
  const deadline = (await stub.readStored()).runs[0].activeEndAt;
  await f.restart();
  stub = await f.stub();
  await stub.start();
  assert.equal(f.creates(), 1);
  state = await stub.readStored();
  assert.equal(state.runs[0].activeEndAt, deadline);
  await stub.apply({ type: "stop", key: state.runs[0].key });
  await stub.serviceNow();
  state = await stub.readStored();
  assert.equal(state.runs[0].phase, "settled");
  assert.equal(state.runs[0].costBasis, "operator_conservative_upper_bound");
  assert.equal(state.runs[0].providerInvoicePending, true);
  assert.equal(f.deletes(), 1);
  assert.ok(state.totalSpent > 146056);
  await stub.resetCooldown();
  await stub.start();
  assert.equal(f.creates(), 2);
});

test("lost create response is recovered by exact persisted nonce, with no second create", async (t) => {
  const f = await lifecycleFixture(t, { ambiguous: true });
  let stub = await f.stub();
  await stub.start();
  assert.equal(f.creates(), 1);
  assert.equal((await stub.readStored()).runs[0].uncertainCreate, true);
  await f.restart();
  stub = await f.stub();
  await stub.serviceNow();
  const state = await stub.readStored();
  assert.equal(state.runs[0].phase, "ready");
  await stub.start();
  assert.equal(f.creates(), 1);
});

test("failed shutdown retains the reservation until verified absence; a real alarm retries cleanup", async (t) => {
  const f = await lifecycleFixture(t, { deletionFails: true });
  const stub = await f.stub();
  await stub.start();
  let state = await stub.readStored();
  await stub.apply({ type: "stop", key: state.runs[0].key });
  await stub.serviceNow();
  state = await stub.readStored();
  assert.equal(state.runs[0].phase, "stopping");
  assert.equal(state.runs[0].actual, null);
  assert.equal(f.creates(), 1);
  f.allowDelete();
  for (let i = 0; i < 100; i++) {
    state = await stub.readStored();
    if (state.runs[0].phase === "settled") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(state.runs[0].phase, "settled");
  assert.ok(f.deletes() >= 2);
});

test("native HTTP reviewer entry and paid admission need no sign-in; owner routes reject spoofed headers", async (t) => {
  const f = await lifecycleFixture(t);
  const page = await f.http("http://localhost/demo");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("Set-Cookie"), /HttpOnly/);
  assert.match(await page.text(), /No sign-in/);
  assert.equal(f.creates(), 0);
  const denied = await f.http("http://localhost/owner/api/setup", {
    headers: { "Cf-Access-Authenticated-User-Email": "owner@example.org" },
  });
  assert.equal(denied.status, 403);
  const started = await f.http("http://localhost/api/start", {
    method: "POST",
    headers: { Origin: "http://localhost" },
  });
  assert.equal(started.status, 202);
  assert.equal(f.creates(), 1);
});
