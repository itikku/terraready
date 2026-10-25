import assert from "node:assert/strict";
import { test } from "node:test";
import { Runpod, providerAccess } from "../dist/provider.js";

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
    assert.equal(options.redirect, "error");
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
