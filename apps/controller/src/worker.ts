import { DurableObject } from "cloudflare:workers";
import { gateway, type GatewayBindings } from "./gateway.js";
import {
  assertLedger,
  initialLedger,
  nextDeadline,
  transition,
} from "./policy.js";

export class BudgetLedger extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO ledger VALUES (1, ?)",
      JSON.stringify(initialLedger()),
    );
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
    if (due.length) await this.ctx.storage.setAlarm(Math.min(...due));
    else await this.ctx.storage.deleteAlarm();
    return result;
  }

  async alarm() {
    await this.apply({ type: "tick" });
  }
}

export default {
  fetch(request: Request, env: GatewayBindings, ctx: ExecutionContext) {
    return gateway(request, env, ctx);
  },
};
