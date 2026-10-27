import { DurableObject } from "cloudflare:workers";
import { gateway, type GatewayBindings } from "./gateway.js";
import {
  assertLedger,
  initialLedger,
  nextDeadline,
  transition,
  bookedBound,
  POLICY,
  dayAt,
} from "./policy.js";
import { Runpod, ProviderError, type OwnedPod } from "./provider.js";
import { signedOriginRequest } from "./gateway.js";

const STARTUP_CHECK_MS = 5_000;

interface Attempt {
  key: string;
  name: string;
  nonce: string;
  since: number;
  nextCheckAt: number | null;
  problem?: string;
  startup?: { stage: string; changedAt: number; checkedAt: number };
}

export class BudgetLedger extends DurableObject<GatewayBindings> {
  constructor(ctx: DurableObjectState, env: GatewayBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO ledger VALUES (1, ?)",
      JSON.stringify(initialLedger()),
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, record TEXT NOT NULL)",
    );
  }

  #attempt(key: string): Attempt | undefined {
    const row = this.ctx.storage.sql
      .exec<{ record: string }>("SELECT record FROM attempts WHERE key=?", key)
      .toArray()[0];
    return row ? (JSON.parse(row.record) as Attempt) : undefined;
  }

  #save(attempt: Attempt) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO attempts VALUES (?,?)",
      attempt.key,
      JSON.stringify(attempt),
    );
  }

  async start() {
    if (
      !this.env.RUNPOD_API_KEY ||
      !/^[a-f0-9]{40}$/.test(this.env.SOURCE_COMMIT ?? "") ||
      !/^[a-f0-9]{64}$/.test(this.env.SOURCE_SHA256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(this.env.ORIGIN_SECRET ?? "") ||
      (this.env.IMAGE_REF !== undefined &&
        !/^ghcr\.io\/itikku\/terraready-runtime@sha256:[a-f0-9]{64}$/.test(
          this.env.IMAGE_REF,
        ))
    )
      throw new Error("Runtime setup incomplete.");
    let result = await this.apply({ type: "tick" });
    if (result.state.runs.some((r) => r.phase !== "settled")) return result;
    const allowed = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS launch_gate (id INTEGER PRIMARY KEY, time INTEGER NOT NULL)",
      );
      const prior = this.ctx.storage.sql
        .exec<{ time: number }>("SELECT time FROM launch_gate WHERE id=1")
        .toArray()[0];
      if (prior && Date.now() - prior.time < 30_000) return false;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO launch_gate VALUES (1,?)",
        Date.now(),
      );
      return result.state.runs.length < 256;
    });
    if (!allowed) return { ...result, error: "start_cooldown" };
    const provider = new Runpod(this.env.RUNPOD_API_KEY);
    const quote = await provider.quote();
    const now = Date.now();
    const key = crypto.randomUUID().replaceAll("-", "");
    // Concurrent callers may read a quote, but only one atomic reservation wins.
    result = await this.apply({
      type: "reserve",
      key,
      quote: {
        id: "l4-secure-ephemeral",
        hourly: quote.hourly,
        fixed: 10_000,
        validUntil: now + 60_000,
      },
    });
    if (result.error)
      return result.error === "run_unsettled"
        ? this.apply({ type: "tick" })
        : result;
    const attempt: Attempt = {
      key,
      name: "terraready-" + key,
      nonce:
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", ""),
      since: now,
      nextCheckAt: now + STARTUP_CHECK_MS,
    };
    this.#save(attempt);
    await this.ctx.storage.setAlarm(attempt.nextCheckAt!);
    try {
      const id = await provider.create(
        attempt,
        {
          commit: this.env.SOURCE_COMMIT!,
          sha256: this.env.SOURCE_SHA256!,
          ...(this.env.IMAGE_REF ? { image: this.env.IMAGE_REF } : {}),
        },
        this.env.ORIGIN_SECRET!,
        quote,
      );
      result = await this.apply({ type: "created", key, resourceId: id });
    } catch (error) {
      if (
        error instanceof ProviderError &&
        [400, 401, 403, 404, 422].includes(error.status)
      ) {
        await this.apply({ type: "absent", key });
        result = await this.apply({
          type: "settle",
          key,
          actual: { [dayAt(now)]: 0 },
        });
        result.error = "provider_start_failed";
      } else result = await this.apply({ type: "uncertain", key });
      attempt.problem = "startup_failed";
      this.#save(attempt);
    }
    return result;
  }

  async startup(key: string) {
    return this.#attempt(key)?.startup ?? null;
  }

  // Internal binding only. No public route reaches this method. The future
  // authenticated gateway must derive events from trusted provider/user actions.
  async apply(event: unknown) {
    return this.#applyAt(event, Date.now());
  }

  async #applyAt(event: unknown, now: number) {
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{ state: string }>("SELECT state FROM ledger WHERE id=1")
        .one();
      const state: unknown = JSON.parse(row.state);
      assertLedger(state);
      const result = transition(state, event, now);
      this.ctx.storage.sql.exec(
        "UPDATE ledger SET state=? WHERE id=1",
        JSON.stringify(result.state),
      );
      return result;
    });
    const due = result.state.runs.flatMap((run) => {
      const deadline = nextDeadline(run);
      return deadline ? [deadline.at] : [];
    });
    for (const run of result.state.runs.filter((r) => r.phase !== "settled")) {
      const attempt = this.#attempt(run.key);
      if (attempt?.nextCheckAt)
        due.push(Math.max(now + 1000, attempt.nextCheckAt));
      if (attempt && run.phase === "stopping") due.push(now + 1000);
    }
    if (due.length) await this.ctx.storage.setAlarm(Math.min(...due));
    else await this.ctx.storage.deleteAlarm();
    return result;
  }

  async alarm() {
    let result = await this.apply({ type: "tick" });
    let run = result.state.runs.find((r) => r.phase !== "settled");
    if (!run || !this.env.RUNPOD_API_KEY || !this.env.ORIGIN_SECRET) return;
    const attempt = this.#attempt(run.key);
    if (!attempt) return;
    const provider = new Runpod(this.env.RUNPOD_API_KEY);
    attempt.nextCheckAt =
      Date.now() + (run.phase === "reserved" ? STARTUP_CHECK_MS : 30_000);
    this.#save(attempt);
    try {
      if (run.resourceId === null) {
        const id = await provider.findOwned(attempt);
        if (id) {
          result = await this.apply({
            type: "created",
            key: run.key,
            resourceId: id,
          });
          run = result.state.runs.find((r) => r.key === run!.key)!;
        }
        // An ambiguous create is never blindly retried or declared free.
        if (!run.resourceId) return;
      }
      if (run.phase === "stopping") {
        const owned: OwnedPod = { ...attempt, id: run.resourceId };
        if (!(await provider.terminateOwned(owned))) return;
        result = await this.apply({
          type: "terminated",
          key: run.key,
          resourceId: run.resourceId,
        });
        run = result.state.runs.find((r) => r.key === run!.key)!;
      }
      if (run.phase === "terminated") {
        await this.apply({
          type: "settle",
          key: run.key,
          actual: bookedBound(run, Date.now() + POLICY.shutdownMs),
          basis: "operator_conservative_upper_bound",
        });
        attempt.nextCheckAt = null;
        this.#save(attempt);
      } else if (run.phase === "reserved") {
        const req = await signedOriginRequest(
          new Request("https://demo.invalid/ready"),
          run.resourceId!,
          "0".repeat(64),
          this.env.ORIGIN_SECRET,
        );
        const ready = await fetch(
          new Request(req, { signal: AbortSignal.timeout(5_000) }),
        );
        await ready.body?.cancel();
        if (ready.status === 200) {
          attempt.nextCheckAt = null;
          this.#save(attempt);
          await this.apply({ type: "ready", key: run.key });
        } else if (this.env.IMAGE_REF) {
          const progressRequest = await signedOriginRequest(
            new Request("https://demo.invalid/startup"),
            run.resourceId!,
            "0".repeat(64),
            this.env.ORIGIN_SECRET,
          );
          const progress = await fetch(
            new Request(progressRequest, {
              signal: AbortSignal.timeout(5_000),
            }),
          );
          if (!progress.ok || !progress.body) {
            await progress.body?.cancel();
            return;
          }
          const reader = progress.body.getReader();
          let bytes = new Uint8Array();
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              if (bytes.byteLength + part.value.byteLength > 512) return;
              const next = new Uint8Array(
                bytes.byteLength + part.value.byteLength,
              );
              next.set(bytes);
              next.set(part.value, bytes.byteLength);
              bytes = next;
            }
          } finally {
            await reader.cancel();
          }
          const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (
            typeof value === "object" &&
            value !== null &&
            "stage" in value &&
            "changedAt" in value &&
            Object.keys(value).length === 2 &&
            typeof value.stage === "string" &&
            ["loading_model", "checking_workspace", "ready", "failed"].includes(
              String(value.stage),
            ) &&
            typeof value.changedAt === "number" &&
            Number.isSafeInteger(value.changedAt) &&
            value.changedAt >= run.createdAt - 30_000 &&
            value.changedAt <= Date.now() + 30_000
          ) {
            attempt.startup = {
              stage: String(value.stage),
              changedAt: value.changedAt,
              checkedAt: Date.now(),
            };
            this.#save(attempt);
          }
        }
      } else {
        attempt.nextCheckAt = null;
        this.#save(attempt);
      }
    } catch {
      // Keep the reservation and exact attempt identity; the durable alarm retries.
    } finally {
      await this.apply({ type: "tick" });
    }
  }
}

export default {
  fetch(request: Request, env: GatewayBindings, ctx: ExecutionContext) {
    return gateway(request, env, ctx);
  },
};
