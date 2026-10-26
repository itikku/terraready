import { dayAt, POLICY, type Event, type transition } from "./policy.js";
import { providerAccess, Runpod } from "./provider.js";
import { controlPage } from "./page.js";

type Result = ReturnType<typeof transition>;
interface LedgerStub {
  apply(event: Event): Promise<Result>;
  start?(): Promise<Result>;
}

// Local boundary types until deployment configuration generates binding types.
export interface GatewayBindings {
  BUDGET?: { getByName(name: string): LedgerStub };
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  ORIGIN_SECRET?: string;
  RUNPOD_API_KEY?: string;
  SOURCE_COMMIT?: string;
  SOURCE_SHA256?: string;
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

async function routeGateway(
  request: Request,
  env: GatewayBindings,
  ctx: Pick<ExecutionContext, "access">,
  visitor: string,
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
  try {
    let url = new URL(request.url);
    const ownerPath =
      url.pathname === "/owner" || url.pathname.startsWith("/owner/");
    let owner = false;
    if (ownerPath) {
      if (!ctx.access || ctx.access.aud !== env.ACCESS_AUD)
        return response(403, "Sign in to owner controls.");
      const identity = await ctx.access.getIdentity();
      if (
        !identity?.user_uuid ||
        !identity.email ||
        identity.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()
      )
        return response(403, "Owner access is required.");
      owner = true;
      url.pathname = url.pathname.slice(6) || "/demo";
      request = new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
      });
      url = new URL(request.url);
    }
    const startupEnabled = Boolean(
      env.RUNPOD_API_KEY &&
      /^[a-f0-9]{40}$/.test(env.SOURCE_COMMIT ?? "") &&
      /^[a-f0-9]{64}$/.test(env.SOURCE_SHA256 ?? ""),
    );
    if (url.pathname === "/api/setup") {
      if (!owner) return response(403, "Only the demo owner can check setup.");
      if (request.method !== "GET") return response(405, "Setup requires GET.");
      if (url.searchParams.get("diagnostics") === "1") {
        const key = env.RUNPOD_API_KEY;
        const formatValid = Boolean(
          key &&
          key.length >= 8 &&
          key.length <= 4096 &&
          /^[\x21-\x7e]+$/.test(key),
        );
        return Response.json(
          {
            configured: Boolean(key),
            formatValid,
            status: formatValid ? await new Runpod(key!).diagnostics() : null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        {
          provider: await providerAccess(env.RUNPOD_API_KEY),
          startupEnabled,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const control = [
      "/api/start",
      "/api/stop",
      "/api/open",
      "/api/status",
      "/api/activity",
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
    if (url.pathname === "/api/stop" && !owner)
      return response(403, "Only the demo owner can stop the shared GPU run.");
    // Creation deliberately stays closed until the provider/build/independent
    // cleanup gates pass. No browser quote, resource ID or ledger event is trusted.
    const stub = env.BUDGET.getByName("terraready-project");
    if (url.pathname === "/api/start") {
      if (!startupEnabled || !stub.start)
        return response(503, "Live demo startup is not configured yet.");
      const started = await stub.start();
      return Response.json(
        { accepted: started.error === null, error: started.error },
        {
          status: started.error ? 409 : 202,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    let result = await stub.apply({ type: "tick" });
    const run = result.state.runs.find((item) => item.phase !== "settled");
    if (
      request.method === "GET" &&
      (url.pathname === "/demo" ||
        (url.pathname === "/" && run?.phase !== "active"))
    )
      return controlPage();
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
          startupEnabled,
          idleMinutes: POLICY.idleMs / 60_000,
          idleEndAt:
            run?.phase === "active"
              ? run.lastUseAt! + POLICY.idleMs
              : run?.phase === "ready"
                ? run.readyAt! + POLICY.idleMs
                : null,
          dailyAvailable:
            Math.max(
              0,
              POLICY.daily -
                (result.state.spent[dayAt(Date.now())] ?? 0) -
                (run?.reserved[dayAt(Date.now())] ?? 0),
            ) / 1_000_000,
          lifetimeAvailable:
            Math.max(
              0,
              POLICY.lifetime -
                result.state.totalSpent -
                Object.values(run?.reserved ?? {}).reduce((a, b) => a + b, 0),
            ) / 1_000_000,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (!run || result.state.accountingHold)
      return response(
        503,
        "This session has ended. Return to /demo to start another within the shared budget.",
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
    if (url.pathname === "/api/activity") {
      const activity = await stub.apply({ type: "activity", key: run.key });
      return Response.json(
        { accepted: activity.error === null },
        {
          status: activity.error ? 409 : 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (run.phase !== "active" || !run.resourceId)
      return response(503, "Open a ready demo before using its workspace.");
    if (
      !url.pathname.startsWith("/api/") &&
      !["/", "/system"].includes(url.pathname) &&
      !["/assets/", "/imagery/", "/licenses/"].some((p) =>
        url.pathname.startsWith(p),
      )
    )
      return response(404, "This demo page does not exist.");
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
    if (
      upstream.ok &&
      (request.method === "POST" ||
        (request.method === "GET" &&
          (url.pathname === "/" ||
            url.pathname === "/system" ||
            url.pathname.startsWith("/api/scenarios/"))))
    ) {
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

// Anonymous reviewers receive an opaque, signed, essential-session cookie.
// It carries no email or approval authority. All paid admission remains shared.
export async function gateway(
  request: Request,
  env: GatewayBindings,
  ctx: Pick<ExecutionContext, "access">,
): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(env.ORIGIN_SECRET ?? ""))
    return routeGateway(request, env, ctx, "0".repeat(64));
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      utf8(env.ORIGIN_SECRET!),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const cookies = (request.headers.get("Cookie") ?? "")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.startsWith("tr_visitor="));
    const value = cookies.length === 1 ? cookies[0].slice(11) : "";
    let id = "",
      setCookie = "";
    if (/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) {
      const [candidate, signature] = value.split(".");
      const bytes = new Uint8Array(
        signature.match(/../g)!.map((x) => parseInt(x, 16)),
      );
      if (
        await crypto.subtle.verify(
          "HMAC",
          key,
          bytes,
          utf8("terraready-visitor-v1\n" + candidate),
        )
      )
        id = candidate;
    }
    if (!id) {
      id = crypto.randomUUID().replaceAll("-", "");
      const signature = hex(
        await crypto.subtle.sign(
          "HMAC",
          key,
          utf8("terraready-visitor-v1\n" + id),
        ),
      );
      setCookie = `tr_visitor=${id}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
    }
    const result = await routeGateway(
      request,
      env,
      ctx,
      await digest(utf8("terraready-workspace-v1\n" + id)),
    );
    if (!setCookie) return result;
    const headers = new Headers(result.headers);
    headers.set("Set-Cookie", setCookie);
    return new Response(result.body, { status: result.status, headers });
  } catch {
    return response(503, "Demo session unavailable. Please try again.");
  }
}
