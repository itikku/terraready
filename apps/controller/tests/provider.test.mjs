import assert from "node:assert/strict";
import { test } from "node:test";
import { Runpod, providerAccess } from "../dist/provider.js";

const owned = {
  id: "syntheticpod01",
  name: "terraready-" + "a".repeat(32),
  nonce: "b".repeat(64),
  since: Date.parse("2026-10-25T20:00:00Z"),
};
const running = () => ({
  id: owned.id,
  name: owned.name,
  createdAt: "2026-10-25T20:00:01Z",
  status: "RUNNING",
  env: { TR_RUN_NONCE: owned.nonce, NEVER_EXPOSE: "synthetic-provider-value" },
});

test("packaged startup permits only a pinned project image and performs no source download", async () => {
  let created;
  const provider = new Runpod(
    "synthetic-runtime-key",
    async (_url, options) => {
      created = JSON.parse(options.body);
      return Response.json({ id: "syntheticpod01" });
    },
  );
  const source = {
    commit: "a".repeat(40),
    sha256: "b".repeat(64),
    image: "ghcr.io/itikku/terraready-runtime@sha256:" + "c".repeat(64),
  };
  await provider.create(owned, source, "d".repeat(64), {
    hourly: 600000,
    dataCenterIds: ["EU-RO-1"],
  });
  assert.equal(created.image, source.image);
  assert.match(created.cmd[0], /unset RUNPOD_API_KEY/);
  assert.match(created.cmd[0], /hosted_image.py run/);
  assert.doesNotMatch(created.cmd[0], /curl|npm|pip install/);
  assert.deepEqual(created.ports, ["8000/http"]);
  assert.equal(created.env.TR_SOURCE_COMMIT, source.commit);
  assert.ok(!("RUNPOD_API_KEY" in created.env));
  for (const image of [
    "ghcr.io/other/image:latest",
    "ghcr.io/itikku/terraready-runtime:latest",
    source.image + ";echo unsafe",
  ]) {
    await assert.rejects(
      provider.create(owned, { ...source, image }, "d".repeat(64), {
        hourly: 600000,
        dataCenterIds: ["EU-RO-1"],
      }),
    );
  }
});

test("runtime capability checks use only fixed-host read-only authenticated requests", async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    const data = url.includes("billing")
      ? { records: [] }
      : url.includes("catalog")
        ? { gpus: [] }
        : { pods: [{ env: { PRIVATE_KEY: "never-return-provider-values" } }] };
    return Response.json(data);
  };
  const result = await new Runpod("synthetic-runtime-key", transport).access();
  assert.deepEqual(result, {
    pods: "available",
    catalog: "available",
    billing: "available",
  });
  assert.equal(calls.length, 3);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, "https://api.runpod.io");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, "Bearer synthetic-runtime-key");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
  }
  assert.equal(JSON.stringify(result).includes("never-return"), false);
});

test("missing runtime key needs secure setup and never makes a provider call", async () => {
  assert.deepEqual(await providerAccess(), {
    pods: "missing_key",
    catalog: "missing_key",
    billing: "missing_key",
  });
});

test("missing grants differ from provider failures without echoing credentials or response bodies", async () => {
  for (const [status, expected] of [
    [401, "denied"],
    [403, "denied"],
    [429, "unavailable"],
    [500, "unavailable"],
  ]) {
    const client = new Runpod("synthetic-runtime-key", async () =>
      Response.json({ detail: "sensitive-provider-detail" }, { status }),
    );
    const result = await client.access();
    assert.deepEqual(result, {
      pods: expected,
      catalog: expected,
      billing: expected,
    });
    assert.equal(
      JSON.stringify(result).includes("sensitive-provider-detail"),
      false,
    );
  }
});

test("invalid credentials, malformed responses, oversized bodies and transport errors fail closed", async () => {
  for (const key of [
    "short",
    "contains a space",
    "key\nheader",
    "a".repeat(4097),
  ])
    assert.throws(() => new Runpod(key));
  for (const transport of [
    async () => Response.json([]),
    async () => Response.json({}),
    async () => new Response("invalid-json"),
    async () => new Response("x".repeat(1_048_577)),
    async () => {
      throw new Error("network-with-sensitive-details");
    },
  ]) {
    const result = await new Runpod(
      "synthetic-runtime-key",
      transport,
    ).access();
    assert.deepEqual(result, {
      pods: "unavailable",
      catalog: "unavailable",
      billing: "unavailable",
    });
  }
});

test("owned termination reads first, deletes only its exact ID and verifies absence", async () => {
  const calls = [];
  const client = new Runpod("synthetic-runtime-key", async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    return calls.length === 1
      ? Response.json(running())
      : Response.json({}, { status: 404 });
  });
  assert.equal(await client.terminateOwned(owned), true);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["GET", "DELETE", "GET"],
  );
  assert.ok(
    calls.every((c) => c.url === `https://api.runpod.io/v2/pods/${owned.id}`),
  );
});

test("a matching name, unknown ID, wrong marker or creation time cannot authorize deletion", async () => {
  for (const mutate of [
    (p) => ({ ...p, id: "differentpod01" }),
    (p) => ({ ...p, name: "terraready-" + "c".repeat(32) }),
    (p) => ({ ...p, env: { TR_RUN_NONCE: "c".repeat(64) } }),
    (p) => ({ ...p, env: null }),
    (p) => ({ ...p, createdAt: "2026-10-24T20:00:01Z" }),
    (p) => ({ ...p, createdAt: "2026-10-25T21:00:01Z" }),
    (p) => ({ ...p, createdAt: "invalid" }),
  ]) {
    const calls = [];
    const client = new Runpod("synthetic-runtime-key", async (_, options) => {
      calls.push(options.method);
      return Response.json(mutate(running()));
    });
    await assert.rejects(client.terminateOwned(owned), {
      message: "Runpod request failed.",
    });
    assert.deepEqual(calls, ["GET"]);
  }
});

test("accepted or failed deletion does not confirm shutdown while provider still reports a live Pod", async () => {
  for (const status of [202, 204, 403, 429, 500, "timeout"]) {
    const calls = [];
    const client = new Runpod("synthetic-runtime-key", async (_, options) => {
      calls.push(options.method);
      if (options.method === "GET") return Response.json(running());
      if (status === "timeout")
        throw Error("synthetic-private-upstream-detail");
      return new Response(null, { status });
    });
    assert.equal(await client.terminateOwned(owned), false);
    assert.deepEqual(calls, ["GET", "DELETE", "GET"]);
  }
});

test("lost delete response can be reconciled by a fresh read, and prior absence needs no delete", async () => {
  let count = 0;
  const client = new Runpod("synthetic-runtime-key", async (_, options) => {
    count++;
    if (options.method === "DELETE") throw Error("lost reply");
    return Response.json({
      ...running(),
      status: count === 1 ? "RUNNING" : "TERMINATED",
    });
  });
  assert.equal(await client.terminateOwned(owned), true);
  for (const data of [null, { ...running(), status: "TERMINATED" }]) {
    const methods = [];
    const absent = new Runpod("synthetic-runtime-key", async (_, options) => {
      methods.push(options.method);
      return data ? Response.json(data) : Response.json({}, { status: 404 });
    });
    assert.equal(await absent.terminateOwned(owned), true);
    assert.deepEqual(methods, ["GET"]);
  }
});

test("invalid exact-ID records fail before calling Runpod; read errors stay sanitized", async () => {
  const client = new Runpod("synthetic-runtime-key", async () => {
    throw Error("Never disclose this response or key");
  });
  for (const value of [
    { ...owned, id: "../other" },
    { ...owned, nonce: "bad" },
    { ...owned, name: "generic-name" },
    { ...owned, since: 0 },
    owned,
  ])
    await assert.rejects(client.terminateOwned(value), {
      message: "Runpod request failed.",
    });
});
