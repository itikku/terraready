import { POLICY, type Event, type transition } from "./policy.js";

type Result = ReturnType<typeof transition>;
interface LedgerStub {
  apply(event: Event): Promise<Result>;
}

// Local boundary types until deployment configuration generates binding types.
export interface GatewayBindings {
  BUDGET?: { getByName(name: string): LedgerStub };
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  ORIGIN_SECRET?: string;
}

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const utf8 = (value: string) => new TextEncoder().encode(value);
const digest = async (value: Uint8Array) =>
  hex(await crypto.subtle.digest("SHA-256", value));
const response = (status: number, reason: string) =>
  Response.json(
    { status: "unavailable", reason },
    { status, headers: { "Cache-Control": "no-store" } },
  );

async function boundedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = AbortSignal.timeout(5_000);
  const expired = new Promise<never>((_, reject) => {
    deadline.addEventListener(
      "abort",
      () => reject(new Error("Body timeout.")),
      { once: true },
    );
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), expired]);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 16_384) throw new RangeError("Request too large.");
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function signedOriginRequest(
  request: Request,
  resourceId: string,
  visitor: string,
  secret: string,
): Promise<Request> {
  if (
    !/^[a-z0-9]{8,32}$/.test(resourceId) ||
    !/^[a-f0-9]{64}$/.test(visitor) ||
    !/^[a-f0-9]{64}$/.test(secret)
  )
    throw new Error("Invalid origin configuration.");
  const url = new URL(request.url);
  const target = url.pathname + url.search;
  const stamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const bytes = await boundedBody(request);
  const canonical = [
    "terraready-origin-v1",
    stamp,
    nonce,
    visitor,
    request.method,
    target,
    await digest(bytes),
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const headers = new Headers({
    "X-TR-Visitor": visitor,
    "X-TR-Time": stamp,
    "X-TR-Nonce": nonce,
    "X-TR-Signature": hex(
      await crypto.subtle.sign("HMAC", key, utf8(canonical)),
    ),
  });
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  return new Request(`https://${resourceId}-8000.proxy.runpod.net${target}`, {
    method: request.method,
    headers,
    body: bytes.byteLength ? bytes : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(160_000),
  });
}

export async function gateway(
  request: Request,
  env: GatewayBindings,
  ctx: Pick<ExecutionContext, "access">,
): Promise<Response> {
  const secret = env.ORIGIN_SECRET ?? "";
  if (
    !env.BUDGET ||
    !env.ACCESS_AUD ||
    !env.OWNER_EMAIL ||
    !/^[a-f0-9]{64}$/.test(secret)
  )
    return response(
      503,
      "Shared access and provider lifecycle are not configured.",
    );
  // Platform-authenticated context only. Browser-supplied Access/email headers
  // never establish identity. No Static Assets router may precede this Worker.
  if (!ctx.access || ctx.access.aud !== env.ACCESS_AUD)
    return response(403, "Sign in through the invited demo application.");
  try {
    const identity = await ctx.access.getIdentity();
    if (
      !identity?.user_uuid ||
      typeof identity.user_uuid !== "string" ||
      identity.user_uuid.length > 128 ||
      !identity.email
    )
      return response(403, "An invited user identity is required.");
    const owner =
      identity.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
    const url = new URL(request.url);
    const control = [
      "/api/start",
      "/api/stop",
      "/api/open",
      "/api/status",
    ].includes(url.pathname);
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (request.headers.get("Origin") !== url.origin)
        return response(403, "Use the demo page to submit this request.");
      const length = request.headers.get("Content-Length");
      if (length && (!/^\d+$/.test(length) || Number(length) > 16_384))
        return response(413, "Request is too large.");
    }
    if (control && url.pathname !== "/api/status" && request.method !== "POST")
      return response(405, "This action requires POST.");
    if (url.pathname === "/api/status" && request.method !== "GET")
      return response(405, "Status requires GET.");
    if (["/api/start", "/api/stop"].includes(url.pathname) && !owner)
      return response(403, "Only the demo owner can start or stop a GPU run.");
    // Creation deliberately stays closed until the provider/build/independent
    // cleanup gates pass. No browser quote, resource ID or ledger event is trusted.
    if (url.pathname === "/api/start")
      return response(
        503,
        "GPU startup is awaiting provider readiness verification.",
      );
    const stub = env.BUDGET.getByName("terraready-project");
    let result = await stub.apply({ type: "tick" });
    const run = result.state.runs.find(
      (item) => !["settled", "terminated"].includes(item.phase),
    );
    if (url.pathname === "/api/status")
      return Response.json(
        {
          phase: run?.phase ?? "off",
          owner,
          activeEndAt: run?.activeEndAt ?? null,
          costStopAt: run?.costStopAt ?? null,
          dailyLimit: POLICY.daily / 1_000_000,
          lifetimeLimit: POLICY.lifetime / 1_000_000,
          timezone: POLICY.timezone,
          accountingHold: result.state.accountingHold,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (!run || result.state.accountingHold)
      return response(
        503,
        "No demo run is available. The owner can check its budget and status.",
      );
    if (url.pathname === "/api/stop") {
      result = await stub.apply({ type: "stop", key: run.key });
      return Response.json(
        { phase: "stopping", shutdownConfirmed: false, error: result.error },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname === "/api/open") {
      result = await stub.apply({ type: "open", key: run.key });
      return Response.json(
        { accepted: result.error === null, error: result.error },
        {
          status: result.error ? 409 : 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (run.phase !== "active" || !run.resourceId)
      return response(503, "Open a ready demo before using its workspace.");
    if (!url.pathname.startsWith("/api/"))
      return response(404, "The hosted workspace page is not configured yet.");
    const visitor = await digest(
      utf8(`${env.ACCESS_AUD}\n${identity.user_uuid}`),
    );
    const forwarded = await signedOriginRequest(
      request,
      run.resourceId,
      visitor,
      secret,
    );
    const upstream = await fetch(forwarded);
    if (upstream.status >= 300 && upstream.status < 400)
      return response(502, "The demo origin returned an unexpected redirect.");
    // Rejected/overloaded requests and polling cannot keep a lease alive.
    if (request.method === "POST" && upstream.ok) {
      result = await stub.apply({ type: "activity", key: run.key });
      if (result.error) return response(503, "This demo run has ended.");
    }
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json",
      "X-Content-Type-Options": "nosniff",
    });
    const retryAfter = upstream.headers.get("Retry-After");
    if (retryAfter && /^\d{1,3}$/.test(retryAfter))
      headers.set("Retry-After", retryAfter);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof RangeError)
      return response(413, "Request is too large.");
    return response(503, "Shared demo unavailable. Please retry later.");
  }
}
