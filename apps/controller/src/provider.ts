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

export class ProviderError extends Error {
  constructor(readonly status: number) {
    super("Runpod request failed.");
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class Runpod {
  constructor(
    private readonly key: string,
    private readonly transport: Fetch = fetch,
  ) {
    if (key.length < 8 || key.length > 4096 || /\s/.test(key))
      throw new ProviderError(0);
  }

  async #read(path: string): Promise<Record<string, unknown>> {
    const response = await this.transport(`https://api.runpod.io/v2/${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.key}` },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
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
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 1_048_576) throw new ProviderError(0);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!object(data)) throw new ProviderError(0);
    return data;
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
          error instanceof ProviderError ? error.status : "transport_or_format";
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
        redirect: "error",
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
