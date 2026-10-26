import { useEffect, useState } from "react";

interface Session {
  phase: string;
  idleEndAt: number | null;
  costStopAt: number | null;
  activeEndAt: number | null;
}

export default function SessionNotice() {
  const [session, setSession] = useState<Session | null>(null);
  const [now, setNow] = useState(Date.now());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let hosted = true;
    async function check() {
      if (!hosted || document.hidden) return;
      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          hosted = false;
          return;
        }
        if (!response.ok) return;
        const value = (await response.json()) as Partial<Session>;
        if (
          typeof value.phase === "string" &&
          "idleEndAt" in value &&
          [value.idleEndAt, value.costStopAt, value.activeEndAt].every(
            (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
          )
        ) {
          setSession(value as Session);
          setNow(Date.now());
        }
      } catch {
        /* Local mode has no session controller. */
      }
    }
    void check();
    const timer = setInterval(() => {
      setNow(Date.now());
      void check();
    }, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  if (!session) return null;
  const idle = session.idleEndAt ?? Infinity;
  const end = Math.min(
    idle,
    session.costStopAt ?? Infinity,
    session.activeEndAt ?? Infinity,
  );
  const ended = session.phase !== "active" || end <= now;
  if (!ended && end - now > 5 * 60_000) return null;
  const idleWarning = !ended && end === idle;
  async function keepWorking() {
    try {
      const response = await fetch("/api/activity", { method: "POST" });
      if (!response.ok) throw Error();
      setSession((s) =>
        s ? { ...s, idleEndAt: Date.now() + 30 * 60_000 } : s,
      );
      setNow(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <aside className="session-notice" aria-live="polite">
      <p>
        {ended
          ? "This live session has ended."
          : idleWarning
            ? "This session will end soon because it has been idle."
            : "This session is nearing its shared time or budget limit."}
      </p>
      {idleWarning && (
        <button onClick={() => void keepWorking()}>Keep working</button>
      )}
      <a href="/demo">
        {ended ? "Start or join another session" : "Session details"}
      </a>
      {failed && (
        <p role="alert">Could not extend idle time. Check session details.</p>
      )}
    </aside>
  );
}
