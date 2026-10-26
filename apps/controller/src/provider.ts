// Fixed Runpod v2 transport. Provider bodies can contain environment secrets;
// retain only explicitly selected fields and never include bodies in errors.
type Fetch = typeof fetch;
export type Capability = "available" | "missing_key" | "denied" | "unavailable";
export interface ProviderAccess {
  pods: Capability;
  catalog: Capability;
  billing: Capability;
}

export interface OwnedPod {
  id: string;
  name: string;
  nonce: string;
  since: number;
}

export interface HostedSource {
  commit: string;
  sha256: string;
}
export interface PodQuote {
  hourly: number;
  dataCenterIds: string[];
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly stage = "response",
  ) {
    super("Runpod request failed.");
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class Runpod {
  constructor(
    private readonly key: string,
    private readonly transport: Fetch = (input, init) => fetch(input, init),
  ) {
    if (key.length < 8 || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key))
      throw new ProviderError(0);
  }

  async #read(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.transport(`https://api.runpod.io/v2/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.key}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ProviderError(0, "request");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError(0);
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        let part: ReadableStreamReadResult<Uint8Array>;
        try {
          part = await reader.read();
        } catch {
          throw new ProviderError(0, "body_read");
        }
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 1_048_576) throw new ProviderError(0);
        chunks.push(part.value);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* Already closed provider stream. */
      }
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ProviderError(0, "json");
    }
    if (!object(data)) throw new ProviderError(0);
    return data;
  }

  async quote(): Promise<PodQuote> {
    const gpu = await this.#read(
      "catalog/gpus/NVIDIA%20L4?include=AVAILABILITY&product=POD&cloud=SECURE&count=1&minCudaVersion=12.8",
    );
    const price = object(gpu.price) ? gpu.price.secure : undefined;
    if (
      typeof price !== "number" ||
      price <= 0 ||
      price > 0.59 ||
      !Array.isArray(gpu.dataCenters)
    )
      throw new ProviderError(0, "quote");
    const dataCenterIds = gpu.dataCenters
      .filter(
        (dc): dc is Record<string, unknown> =>
          object(dc) &&
          typeof dc.id === "string" &&
          /^[A-Z0-9-]+$/.test(dc.id) &&
          ["LOW", "MEDIUM", "HIGH"].includes(String(dc.availability)),
      )
      .map((dc) => String(dc.id));
    if (!dataCenterIds.length) throw new ProviderError(0, "capacity");
    // Existing approved 50 GB ephemeral disk quote plus upward rounding.
    return { hourly: 600_000, dataCenterIds };
  }

  async create(
    owned: Omit<OwnedPod, "id">,
    source: HostedSource,
    secret: string,
    quote: PodQuote,
  ): Promise<string> {
    if (
      !/^[a-f0-9]{40}$/.test(source.commit) ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      !/^[a-f0-9]{64}$/.test(secret)
    )
      throw new ProviderError(0, "configuration");
    const revision = source.commit.slice(0, 7);
    const url = `https://github.com/itikku/terraready/releases/download/preview-source-${revision}/terraready-source-${revision}.tar.gz`;
    const command = `set -euo pipefail; unset RUNPOD_API_KEY; umask 077; cd /; mkdir terraready; cd terraready; curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --max-time 600 --max-filesize 10000000 '${url}' -o /tmp/terraready-source.tar.gz; echo '${source.sha256}  /tmp/terraready-source.tar.gz' | sha256sum --check --status; tar -xzf /tmp/terraready-source.tar.gz; exec python3 -u scripts/hosted_boot.py`;
    const pod = await this.#read("pods", {
      name: owned.name,
      cloud: "SECURE",
      image:
        "runpod/pytorch@sha256:602afab6d10c5932bd9824c4f23119ca20b68d9a03423e4b3e9c612ff1431ddf",
      gpu: { id: "NVIDIA L4", count: 1, minCudaVersion: "12.8" },
      dataCenterIds: quote.dataCenterIds,
      disk: 50,
      mounts: {},
      ports: ["8000/http"],
      startSsh: false,
      startJupyter: false,
      entrypoint: ["/bin/bash", "-lc"],
      cmd: [command],
      env: {
        TR_RUN_NONCE: owned.nonce,
        TR_SOURCE_COMMIT: source.commit,
        TR_ORIGIN_SECRET: secret,
      },
    });
    if (typeof pod.id !== "string" || !/^[a-z0-9]{8,32}$/.test(pod.id))
      throw new ProviderError(0, "create_response");
    return pod.id;
  }

  async findOwned(owned: Omit<OwnedPod, "id">): Promise<string | null> {
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const result = await this.#read(
        "pods?includeClusterPods=true&limit=100" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (!Array.isArray(result.pods)) throw new ProviderError(0);
      const found = result.pods.filter(
        (p) =>
          object(p) &&
          p.name === owned.name &&
          object(p.env) &&
          p.env.TR_RUN_NONCE === owned.nonce,
      );
      if (found.length > 1) throw new ProviderError(0, "ownership");
      if (
        found.length === 1 &&
        object(found[0]) &&
        typeof found[0].id === "string"
      )
        return found[0].id;
      if (!result.hasNextPage) return null;
      if (typeof result.nextCursor !== "string" || !result.nextCursor)
        throw new ProviderError(0);
      cursor = result.nextCursor;
    }
    throw new ProviderError(0, "pagination");
  }

  async diagnostics(): Promise<Record<string, number | string>> {
    const result: Record<string, number | string> = {};
    for (const [name, path] of Object.entries({
      pods: "pods?includeClusterPods=true&limit=1",
      catalog:
        "catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE&count=1",
      billing: "billing/pods?lastN=1",
    })) {
      try {
        await this.#read(path);
        result[name] = 200;
      } catch (error) {
        result[name] =
          error instanceof ProviderError
            ? `${error.stage}:${error.status}`
            : error instanceof Error
              ? error.name
              : "transport_or_format";
      }
    }
    return result;
  }

  // Internal lifecycle primitive only. A trusted creation record supplies the
  // exact ID and an unpredictable per-attempt marker; a name alone is not proof.
  async terminateOwned(owned: OwnedPod): Promise<boolean> {
    if (
      !/^[a-z0-9]{8,32}$/.test(owned.id) ||
      !/^terraready-[a-f0-9]{32}$/.test(owned.name) ||
      !/^[a-f0-9]{64}$/.test(owned.nonce) ||
      !Number.isSafeInteger(owned.since) ||
      owned.since <= 0
    )
      throw new ProviderError(0);
    const path = `pods/${owned.id}`;
    const lookup = async () => {
      try {
        return await this.#read(path);
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw new ProviderError(
          error instanceof ProviderError ? error.status : 0,
        );
      }
    };
    const before = await lookup();
    if (before === null) return true;
    const created =
      typeof before.createdAt === "string" ? Date.parse(before.createdAt) : NaN;
    if (
      before.id !== owned.id ||
      before.name !== owned.name ||
      !object(before.env) ||
      before.env.TR_RUN_NONCE !== owned.nonce ||
      !Number.isFinite(created) ||
      created < owned.since - 60_000 ||
      created > owned.since + 20 * 60_000
    )
      throw new ProviderError(0);
    if (before.status === "TERMINATED") return true;
    // A lost DELETE response is ambiguous. Confirm with a fresh read even after
    // a timeout; never release a reservation merely because DELETE was accepted.
    try {
      const result = await this.transport(`https://api.runpod.io/v2/${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.key}` },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      await result.body?.cancel();
    } catch {
      // The independently persisted shutdown intent must retry if still live.
    }
    const after = await lookup();
    return (
      after === null || (after.id === owned.id && after.status === "TERMINATED")
    );
  }

  // Read-only checks of the exact three API families needed by the runtime.
  // No key, Pod configuration, billing amount or account identity is returned.
  async access(): Promise<ProviderAccess> {
    const check = async (
      path: string,
      valid: (data: Record<string, unknown>) => boolean,
    ): Promise<Capability> => {
      try {
        if (!valid(await this.#read(path))) return "unavailable";
        return "available";
      } catch (error) {
        return error instanceof ProviderError &&
          [401, 403].includes(error.status)
          ? "denied"
          : "unavailable";
      }
    };
    const [pods, catalog, billing] = await Promise.all([
      check("pods?includeClusterPods=true&limit=1", (data) =>
        Array.isArray(data.pods),
      ),
      check(
        "catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE&count=1",
        (data) => Array.isArray(data.gpus),
      ),
      check("billing/pods?lastN=1", (data) => Array.isArray(data.records)),
    ]);
    return { pods, catalog, billing };
  }
}

export async function providerAccess(key?: string): Promise<ProviderAccess> {
  if (!key)
    return {
      pods: "missing_key",
      catalog: "missing_key",
      billing: "missing_key",
    };
  try {
    return await new Runpod(key).access();
  } catch {
    return {
      pods: "unavailable",
      catalog: "unavailable",
      billing: "unavailable",
    };
  }
}
