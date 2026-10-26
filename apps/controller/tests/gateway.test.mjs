import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { test } from "node:test";
import { gateway, signedOriginRequest } from "../dist/gateway.js";
import { initialLedger, transition } from "../dist/policy.js";

const secret = "ab".repeat(32); // Public test value, not a deployment credential.
const audience = "synthetic-access-audience";
const base = "https://demo.example";
function context(email = "owner@example.org", uuid = "synthetic-owner") {
  return {
    access: {
      aud: audience,
      getIdentity: async () => ({ email, user_uuid: uuid }),
    },
  };
}
function request(path, method = "GET", extra = {}) {
  return new Request(base + path, {
    method,
    ...(method === "POST" ? { headers: { Origin: base } } : {}),
    ...extra,
  });
}
async function fixture(ready = true) {
  let state = initialLedger();
  const events = [];
  const stub = {
    async apply(event) {
      events.push(event);
      const result = transition(state, event, Date.now());
      state = result.state;
      return result;
    },
  };
  const env = {
    BUDGET: {
      getByName: (name) => {
        assert.equal(name, "terraready-project");
        return stub;
      },
    },
    ACCESS_AUD: audience,
    OWNER_EMAIL: "owner@example.org",
    ORIGIN_SECRET: secret,
  };
  if (ready) {
    await stub.apply({
      type: "reserve",
      key: "synthetic-run",
      quote: {
        id: "synthetic-quote",
        hourly: 100_000,
        fixed: 0,
        validUntil: Date.now() + 60_000,
      },
    });
    await stub.apply({
      type: "created",
      key: "synthetic-run",
      resourceId: "syntheticpod01",
    });
    await stub.apply({ type: "ready", key: "synthetic-run" });
  }
  return { env, stub, events, state: () => state };
}

test("public reviewers need no identity; only owner paths trust native Access, never spoofed headers", async () => {
  const f = await fixture();
  assert.equal((await gateway(request("/api/status"), {}, {})).status, 503);
  const publicStatus = await gateway(request("/api/status"), f.env, {});
  assert.equal(publicStatus.status, 200);
  assert.equal((await publicStatus.json()).owner, false);
  const spoof = request("/owner/api/setup", "GET", {
    headers: {
      "Cf-Access-Authenticated-User-Email": "owner@example.org",
      "Cf-Access-Jwt-Assertion": "invented",
    },
  });
  assert.equal((await gateway(spoof, f.env, {})).status, 403);
  const wrong = context();
  wrong.access.aud = "other-app";
  assert.equal(
    (await gateway(request("/owner/api/status"), f.env, wrong)).status,
    403,
  );
  assert.equal(
    (
      await gateway(
        request("/owner/api/status"),
        f.env,
        context("guest@example.org", "guest"),
      )
    ).status,
    403,
  );
  assert.equal(f.events.filter((e) => e.type === "open").length, 0);
});

test("status polling never starts or extends active use and hides resource/accounting internals", async () => {
  const f = await fixture();
  const result = await gateway(
    request("/api/status"),
    f.env,
    context("guest@example.org", "guest"),
  );
  const body = await result.json();
  assert.equal(body.phase, "ready");
  assert.equal(body.owner, false);
  assert.equal(body.dailyLimit, 2);
  assert.equal(body.lifetimeLimit, 10);
  assert.equal(body.timezone, "America/Los_Angeles");
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(f.state().runs[0].firstUseAt, null);
  assert.ok(!JSON.stringify(body).includes("syntheticpod01"));
  assert.equal(body.startup, null);
});

test("startup progress reports confirmed allocation without revealing provider identity or changing use", async () => {
  const f = await fixture(false);
  await f.stub.apply({
    type: "reserve",
    key: "progress-run",
    quote: {
      id: "test",
      hourly: 100_000,
      fixed: 0,
      validUntil: Date.now() + 60_000,
    },
  });
  const status = async () =>
    (await gateway(request("/api/status"), f.env, {})).json();
  let body = await status();
  assert.equal(body.startup.stage, "allocating");
  assert.ok(body.startup.elapsedMs >= 0);
  await f.stub.apply({ type: "uncertain", key: "progress-run" });
  body = await status();
  assert.equal(body.startup.stage, "confirming");
  await f.stub.apply({
    type: "created",
    key: "progress-run",
    resourceId: "syntheticpod02",
  });
  body = await status();
  assert.equal(body.startup.stage, "preparing");
  assert.ok(!JSON.stringify(body).includes("syntheticpod02"));
  assert.equal(f.state().runs[0].firstUseAt, null);
  assert.equal(f.state().runs[0].lastUseAt, null);
  await f.stub.apply({ type: "ready", key: "progress-run" });
  assert.equal((await status()).startup, null);
});

test("setup check is owner-only, read-only, secret-free and cannot start a GPU", async () => {
  const f = await fixture(false);
  const before = f.events.length;
  assert.equal(
    (
      await gateway(
        request("/owner/api/setup"),
        f.env,
        context("guest@example.org", "guest"),
      )
    ).status,
    403,
  );
  assert.equal(
    (await gateway(request("/owner/api/setup", "POST"), f.env, context()))
      .status,
    405,
  );
  const response = await gateway(request("/owner/api/setup"), f.env, context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    provider: {
      pods: "missing_key",
      catalog: "missing_key",
      billing: "missing_key",
    },
    startupEnabled: false,
  });
  assert.equal(f.events.length, before);
});

test("owner diagnostics distinguish invalid key format without returning its value", async () => {
  const f = await fixture(false);
  f.env.RUNPOD_API_KEY = "synthetic invalid key";
  const req = request("/owner/api/setup?diagnostics=1");
  assert.equal(
    (await gateway(req, f.env, context("guest@example.org", "guest"))).status,
    403,
  );
  const result = await gateway(req, f.env, context());
  const body = await result.json();
  assert.deepEqual(body, {
    configured: true,
    formatValid: false,
    status: null,
  });
  assert.ok(!JSON.stringify(body).includes(f.env.RUNPOD_API_KEY));
});

test("public control page needs no sign-in and cannot open a run through page loads", async () => {
  const f = await fixture(false);
  assert.equal((await gateway(request("/demo"), f.env, {})).status, 200);
  for (const path of ["/", "/demo"]) {
    const result = await gateway(request(path), f.env, context());
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type"), /text\/html/);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.match(
      result.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    const text = await result.text();
    assert.ok(text.includes("One shared budget"));
    assert.ok(!text.includes(secret));
  }
  assert.ok(f.events.every((e) => e.type === "tick"));
  assert.equal(f.state().runs.length, 0);
});

test("signed frontend and System routes work only during active use; assets do not refresh idle", async (t) => {
  const f = await fixture();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const forwarded = [];
  globalThis.fetch = async (req) => {
    forwarded.push(req);
    return new Response("public-frontend-test-only", {
      headers: { "Content-Type": "text/html" },
    });
  };
  assert.equal(
    (await gateway(request("/system"), f.env, context())).status,
    503,
  );
  await f.stub.apply({ type: "open", key: "synthetic-run" });
  const lastUse = f.state().runs[0].lastUseAt;
  for (const path of [
    "/",
    "/system",
    "/assets/app.js",
    "/imagery/site-aerial.jpg",
    "/licenses/DM-Sans-OFL.txt",
  ]) {
    const result = await gateway(request(path), f.env, context());
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "public-frontend-test-only");
  }
  assert.equal(forwarded.length, 5);
  assert.ok(forwarded.every((req) => req.headers.has("X-TR-Signature")));
  assert.ok(f.state().runs[0].lastUseAt >= lastUse);
  assert.equal(
    (await gateway(request("/.env.local"), f.env, context())).status,
    404,
  );
  await f.stub.apply({
    type: "terminated",
    key: "synthetic-run",
    resourceId: "syntheticpod01",
  });
  assert.equal(
    (await (await gateway(request("/api/status"), f.env, context())).json())
      .phase,
    "terminated",
  );
});

test("visitors can start once configured; only the owner can stop the shared run", async () => {
  const f = await fixture();
  for (const path of ["/api/stop"]) {
    assert.equal(
      (
        await gateway(
          request(path, "POST"),
          f.env,
          context("guest@example.org", "guest"),
        )
      ).status,
      403,
    );
  }
  const started = await gateway(
    request("/api/start", "POST"),
    f.env,
    context(),
  );
  assert.equal(started.status, 503);
  f.env.RUNPOD_API_KEY = "synthetic-provider-key";
  f.env.SOURCE_COMMIT = "a".repeat(40);
  f.env.SOURCE_SHA256 = "b".repeat(64);
  let starts = 0;
  f.stub.start = async () => {
    starts++;
    return { state: f.state(), error: null };
  };
  const guestStart = await gateway(
    request("/api/start", "POST"),
    f.env,
    context("reviewer@unknown.example", "new-reviewer"),
  );
  assert.equal(guestStart.status, 202);
  assert.equal(starts, 1);

  assert.equal(f.events.filter((e) => e.type === "reserve").length, 1);
  const stopped = await gateway(
    request("/owner/api/stop", "POST"),
    f.env,
    context(),
  );
  assert.equal(stopped.status, 202);
  assert.equal((await stopped.json()).shutdownConfirmed, false);
  assert.equal(f.state().runs[0].phase, "stopping");
});

test("CSRF, control methods and oversized declared bodies are rejected before a ledger mutation", async () => {
  const f = await fixture();
  for (const extra of [
    { headers: {} },
    { headers: { Origin: "https://other.example" } },
  ]) {
    assert.equal(
      (await gateway(request("/api/open", "POST", extra), f.env, context()))
        .status,
      403,
    );
  }
  assert.equal(
    (await gateway(request("/api/open"), f.env, context())).status,
    405,
  );
  assert.equal(
    (await gateway(request("/api/status", "POST"), f.env, context())).status,
    405,
  );
  assert.equal(
    (
      await gateway(
        request("/api/open", "POST", {
          headers: { Origin: base, "Content-Length": "20000" },
        }),
        f.env,
        context(),
      )
    ).status,
    413,
  );
  assert.equal(f.state().runs[0].firstUseAt, null);
});

test("first deliberate open starts once; joining does not renew the shared active deadline", async () => {
  const f = await fixture();
  const first = await gateway(request("/api/open", "POST"), f.env, context());
  assert.equal((await first.json()).accepted, true);
  const deadline = f.state().runs[0].activeEndAt;
  const joined = await gateway(
    request("/api/open", "POST"),
    f.env,
    context("guest@example.org", "guest"),
  );
  assert.equal((await joined.json()).accepted, true);
  assert.equal(f.state().runs[0].activeEndAt, deadline);
  assert.equal(
    (
      await gateway(
        request("/api/scenarios/post-rain"),
        (await fixture(false)).env,
        context(),
      )
    ).status,
    503,
  );
});

test("accounting holds and stopping runs cannot reach the origin", async () => {
  const f = await fixture();
  await f.stub.apply({ type: "stop", key: "synthetic-run" });
  assert.equal(
    (await gateway(request("/api/scenarios/post-rain"), f.env, context()))
      .status,
    503,
  );
  await f.stub.apply({
    type: "terminated",
    key: "synthetic-run",
    resourceId: "syntheticpod01",
  });
  await f.stub.apply({
    type: "settle",
    key: "synthetic-run",
    actual: { "2026-10-25": 2_000_000 },
  });
  assert.equal(f.state().accountingHold, true);
  assert.equal(
    (await gateway(request("/api/open", "POST"), f.env, context())).status,
    503,
  );
});

test("origin signing binds method, encoded query, body and opaque user; no browser credentials forward", async () => {
  const body = '{"question":"What can continue?"}';
  const input = request("/api/scenarios/post-rain/assist?x=%2F", "POST", {
    body,
    headers: {
      "Content-Type": "application/json",
      Cookie: "private-cookie",
      Authorization: "Bearer private-token",
      "X-TR-Visitor": "spoof",
    },
  });
  const out = await signedOriginRequest(
    input,
    "syntheticpod01",
    "a".repeat(64),
    secret,
  );
  assert.equal(
    out.url,
    "https://syntheticpod01-8000.proxy.runpod.net/api/scenarios/post-rain/assist?x=%2F",
  );
  assert.equal(out.headers.get("Cookie"), null);
  assert.equal(out.headers.get("Authorization"), null);
  assert.equal(out.headers.get("X-TR-Visitor"), "a".repeat(64));
  assert.equal(out.redirect, "manual");
  const canonical = [
    "terraready-origin-v1",
    out.headers.get("X-TR-Time"),
    out.headers.get("X-TR-Nonce"),
    "a".repeat(64),
    "POST",
    "/api/scenarios/post-rain/assist?x=%2F",
    createHash("sha256").update(body).digest("hex"),
  ].join("\n");
  assert.equal(
    out.headers.get("X-TR-Signature"),
    createHmac("sha256", secret).update(canonical).digest("hex"),
  );
  assert.equal(await out.text(), body);
  await assert.rejects(
    signedOriginRequest(
      request("/api/x"),
      "https://evil.example",
      "a".repeat(64),
      secret,
    ),
  );
  await assert.rejects(
    signedOriginRequest(request("/api/x"), "syntheticpod01", "spoof", secret),
  );
  await assert.rejects(
    signedOriginRequest(
      request("/api/x"),
      "syntheticpod01",
      "a".repeat(64),
      "short",
    ),
  );
});

test("unknown-length chunked requests are bounded before signing", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16_385));
      controller.close();
    },
  });
  await assert.rejects(
    signedOriginRequest(
      request("/api/x", "POST", { body, duplex: "half" }),
      "syntheticpod01",
      "a".repeat(64),
      secret,
    ),
    RangeError,
  );
});

test("proxy preserves overload feedback and updates idle only after accepted actions", async (t) => {
  const f = await fixture();
  await gateway(request("/api/open", "POST"), f.env, context());
  let code = 429;
  const forwarded = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    forwarded.push(input);
    return new Response("{}", {
      status: code,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "10",
        "Set-Cookie": "private-origin-cookie",
      },
    });
  });
  const ask = () =>
    request("/api/scenarios/post-rain/assist", "POST", {
      body: "{}",
      headers: { Origin: base, "Content-Type": "application/json" },
    });
  const busy = await gateway(ask(), f.env, context());
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("Retry-After"), "10");
  assert.ok(!busy.headers.get("Set-Cookie").includes("private-origin-cookie"));
  assert.equal(f.events.filter((e) => e.type === "activity").length, 0);
  code = 200;
  assert.equal((await gateway(ask(), f.env, context())).status, 200);
  assert.equal(f.events.filter((e) => e.type === "activity").length, 1);
  assert.equal(
    (
      await gateway(
        request("/api/scenarios/post-rain"),
        f.env,
        context("guest@example.org", "guest"),
      )
    ).status,
    200,
  );
  assert.notEqual(
    forwarded[0].headers.get("X-TR-Visitor"),
    forwarded[2].headers.get("X-TR-Visitor"),
  );
  assert.equal(f.events.filter((e) => e.type === "activity").length, 2);
  code = 302;
  assert.equal((await gateway(ask(), f.env, context())).status, 502);
});

test("identity/provider errors reveal no secrets and never turn into success", async (t) => {
  const f = await fixture();
  const failed = context();
  failed.access.getIdentity = async () => {
    throw new Error(secret);
  };
  const failure = await gateway(request("/owner/api/status"), f.env, failed);
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes(secret));
  await gateway(request("/api/open", "POST"), f.env, context());
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(secret);
  });
  const offline = await gateway(request("/api/system"), f.env, context());
  assert.equal(offline.status, 503);
  assert.ok(!(await offline.text()).includes(secret));
});

test("anonymous browser cookies are signed, opaque, stable and cannot unlock owner controls", async () => {
  const f = await fixture(false);
  const first = await gateway(request("/demo"), f.env, {});
  const cookie = first.headers.get("Set-Cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!cookie.includes("owner@example.org"));
  const jar = cookie.split(";")[0];
  const req = () => request("/api/status", "GET", { headers: { Cookie: jar } });
  const repeated = await gateway(req(), f.env, {});
  assert.equal(repeated.headers.get("Set-Cookie"), null);
  assert.equal((await repeated.json()).owner, false);
  assert.equal(
    (
      await gateway(
        request("/api/setup", "GET", { headers: { Cookie: jar } }),
        f.env,
        context(),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await gateway(
        request("/owner/api/setup", "GET", { headers: { Cookie: jar } }),
        f.env,
        {},
      )
    ).status,
    403,
  );
  const tampered = jar.slice(0, -1) + (jar.endsWith("a") ? "b" : "a");
  const replaced = await gateway(
    request("/api/status", "GET", { headers: { Cookie: tampered } }),
    f.env,
    {},
  );
  assert.ok(replaced.headers.get("Set-Cookie"));
  assert.equal((await replaced.json()).owner, false);
});
