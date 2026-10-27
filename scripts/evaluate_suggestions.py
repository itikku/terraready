"""Explicit HTTP evaluation against an isolated API or the approved public demo.

Never reads model credentials or a local database. Output contains case IDs and
typed results, not raw user comments, model prose or HTTP response bodies.
"""

import argparse
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASES = ROOT / "data/evals/work-suggestions.json"
DEMO_HOST = "terraready-controller.terraready-itikku.workers.dev"


def permitted_base(value: str) -> str:
    url = urllib.parse.urlsplit(value)
    if url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
        raise ValueError("Use a plain approved API origin without credentials, query or path.")
    isolated = (
        url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost"} and url.port == 8004
    )
    public = url.scheme == "https" and url.hostname == DEMO_HOST and url.port in {None, 443}
    if not isolated and not public:
        raise ValueError(
            "Only isolated loopback port 8004 or the approved HTTPS demo is permitted."
        )
    return value.rstrip("/")


def request_json(opener: Any, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json", "Accept": "application/json"}
    )
    for attempt in range(3):
        try:
            with opener.open(req, timeout=95) as response:
                raw = response.read(262145)
                if len(raw) > 262144:
                    raise ValueError("Evaluation response exceeded the size limit.")
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError("Evaluation response must be a JSON object.")
                return value
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 2:
                raise
            # The shared host enforces a per-visitor cooldown; honor its bounded hint.
            try:
                delay = min(30, max(1, int(error.headers.get("Retry-After", "10"))))
            except ValueError:
                delay = 10
            time.sleep(delay)
    raise ValueError("Evaluation request did not complete.")


def assess(case: dict[str, Any], body: dict[str, Any], mode: str) -> tuple[bool, dict[str, Any]]:
    """Check typed behavior and fail-closed solver invariants, never model wording."""
    expected = case["expected"]
    interpretation = body.get("interpretation") or {}
    solver = body.get("solver")
    actual = {
        "task_id": body.get("task_id"),
        "status": interpretation.get("status"),
        "intent": interpretation.get("intent"),
        "mode": interpretation.get("mode"),
        "model_id": interpretation.get("model_id"),
        "model_elapsed_ms": interpretation.get("elapsed_ms"),
        "trace_tools": [t.get("tool") for t in interpretation.get("trace", [])],
        "solver": None,
    }
    passed = (
        body.get("task_id") == case["task_id"]
        and interpretation.get("task_id") == case["task_id"]
        and body.get("planning_only") is True
        and interpretation.get("mode") == mode
        and interpretation.get("status") == expected["status"]
        and interpretation.get("intent") == expected["intent"]
        and actual["trace_tools"] == ["interpret_suggestion"]
    )
    if isinstance(solver, dict):
        requested = solver.get("requested") or {}
        alternatives = solver.get("alternatives") or []
        actual["solver"] = {
            "verdict": solver.get("verdict"),
            "ground_status": solver.get("ground_status"),
            "solver": solver.get("solver"),
            "requested_status": requested.get("status"),
            "requested_solver_status": requested.get("solver_status"),
            "verified": requested.get("verified"),
            "id": solver.get("id"),
            "alternatives": [
                {
                    "case": c.get("case"),
                    "status": c.get("status"),
                    "solver_status": c.get("solver_status"),
                    "verified": c.get("verified"),
                }
                for c in alternatives
            ],
        }
    if expected["status"] != "interpreted":
        return passed and solver is None, actual
    if not isinstance(solver, dict):
        return False, actual
    gate_ok = (
        solver.get("task_id") == case["task_id"]
        and solver.get("source_plan_id") == body.get("source_plan_id")
        and solver.get("read_only") is True
        and solver.get("solver_workers") == 1
        and solver.get("verdict") in expected["solver_verdicts"]
    )
    if solver.get("verdict") == "GO":
        gate_ok = gate_ok and (
            solver.get("ground_status") == "GO"
            and requested.get("status") == "feasible"
            and requested.get("solver_status") in {"OPTIMAL", "FEASIBLE"}
            and requested.get("verified") is True
        )
    for result in [requested, *alternatives]:
        if result.get("status") == "feasible":
            gate_ok = gate_ok and result.get("verified") is True
        if result.get("solver_status") == "UNKNOWN":
            gate_ok = gate_ok and result.get("status") == "unknown"
    return passed and gate_ok, actual


def evaluate(
    base: str,
    cases: list[dict[str, Any]],
    output: Path,
    *,
    protocol_only: bool = False,
    opener: Any = None,
) -> dict[str, Any]:
    base = permitted_base(base)
    opener = opener or urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    report: dict[str, Any] = {
        "kind": "protocol_stub_evaluation" if protocol_only else "real_model_evaluation",
        "scope": "Synthetic golden intent and solver-gate checks; not production reliability.",
        "started_at": datetime.now(UTC).isoformat(),
        "expected_mode": "test_stub" if protocol_only else "local_model",
        "completed": False,
        "passed": 0,
        "total": len(cases),
        "cases": [],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as destination:
        destination.write(json.dumps(report, indent=2) + "\n")
    snapshots: dict[str | None, dict[str, Any]] = {}
    for case in cases:
        started = time.monotonic()
        record = {"id": case["id"], "expected": case["expected"], "passed": False}
        try:
            clock = case.get("as_of")
            if clock not in snapshots:
                query = "?" + urllib.parse.urlencode({"as_of": clock}) if clock else ""
                snapshots[clock] = request_json(
                    opener, base + "/api/scenarios/post-rain/recovery" + query
                )
            snapshot = snapshots[clock]
            request = {
                "task_id": case["task_id"],
                "suggestion": case["suggestion"],
                "source_plan_id": snapshot["id"],
                "current_candidate_ids": snapshot["selected_candidate_ids"],
            }
            if clock:
                request["as_of"] = clock
            body = request_json(opener, base + "/api/scenarios/post-rain/suggestions", request)
            passed, actual = assess(case, body, report["expected_mode"])
            record.update(passed=passed, actual=actual)
        except urllib.error.HTTPError as error:
            record["error"] = f"http_{error.code}"
        except (OSError, ValueError, TypeError, KeyError, RecursionError):
            record["error"] = "unavailable_or_invalid_response"
        record["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        report["cases"].append(record)
        report["passed"] += int(record["passed"])
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "case": record["id"],
                    "passed": record["passed"],
                    "elapsed_ms": record["elapsed_ms"],
                }
            ),
            flush=True,
        )
    report["completed"] = True
    report["finished_at"] = datetime.now(UTC).isoformat()
    output.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--protocol-only", action="store_true")
    args = parser.parse_args()
    dataset = json.loads(args.cases.read_text())
    if dataset.get("version") != "work-suggestions-eval-v1" or not dataset.get("cases"):
        parser.error("Expected a nonempty work-suggestions-eval-v1 dataset.")
    try:
        result = evaluate(
            args.base_url, dataset["cases"], args.output, protocol_only=args.protocol_only
        )
    except (ValueError, FileExistsError) as error:
        parser.error(str(error))
    print(f"Passed {result['passed']}/{result['total']} {result['expected_mode']} cases.")
    if result["passed"] != result["total"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
