"""Explicit real-model smoke, separate from protocol stubs and paid GPU tests."""

import hashlib
import json
import platform
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from terraready.agent import assist
from terraready.agent_models import AssistRequest
from terraready.model_client import LocalModel
from terraready.seed import load_docket, load_fixture

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ("reroute", "Can we reroute the loaded hauler to keep the east haul moving?", "east-haul"),
    (
        "redeploy",
        "What ready upcoming work can the excavator pull forward instead of idling?",
        "yard-drainage",
    ),
    (
        "blocked",
        "Why can't west-followup start? Read the west-stockpile evidence before explaining.",
        "west-followup",
    ),
]


def main() -> None:
    site = load_docket(
        load_fixture(ROOT / "data/fixtures/post-rain.json"),
        ROOT / "data/fixtures/shift-docket.json",
    )
    client = LocalModel(ROOT / ".data/runtime/inference.key")
    records = []
    destination = ROOT / ".data/reports/local-agent.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "kind": "real_local_model_smoke",
        "measured_at": datetime.now(UTC).isoformat(),
        "base_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "working_tree_dirty": bool(
            subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)
        ),
        "source_sha256": {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in [
                "apps/api/src/terraready/agent.py",
                "apps/api/src/terraready/model_client.py",
                "scripts/evaluate_agent.py",
            ]
        },
        "hardware": {
            "architecture": platform.machine(),
            "os": platform.platform(),
            "runtime_configuration": json.loads((ROOT / ".data/runtime/launch.json").read_text()),
        },
        "model_manifest": json.loads((ROOT / "config/local-model.json").read_text()),
        "dataset_sha256": hashlib.sha256(site.model_dump_json().encode()).hexdigest(),
        "limits": "Three task-specific smoke cases, not a reliability/latency benchmark "
        "or full-stack egress-denial proof.",
        "completed": False,
        "cases": records,
    }
    destination.write_text(json.dumps(report, indent=2) + "\n")
    for focus, question, expected_task in CASES:
        run = assist(site, AssistRequest(question=question), client)
        passed = (
            run.mode == "local_model"
            and run.focus == focus
            and expected_task in {f.task_id for f in run.facts}
            and all(f.evidence_ids for f in run.facts)
            and any(t.tool == "get_shift" for t in run.trace)
            and (focus == "blocked" or any(t.tool == "evaluate_candidates" for t in run.trace))
            and (
                focus != "blocked"
                or (
                    expected_task in run.held_task_ids
                    and not run.candidate_ids
                    and any(t.tool == "get_evidence" for t in run.trace)
                )
            )
        )
        records.append(
            {
                "case": focus,
                "question": question,
                "passed": passed,
                "run": run.model_dump(mode="json"),
            }
        )
        destination.write_text(json.dumps(report, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "case": focus,
                    "passed": passed,
                    "mode": run.mode,
                    "elapsed_ms": run.elapsed_ms,
                    "fallback_reason": run.fallback_reason,
                }
            ),
            flush=True,
        )
    report["completed"] = True
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Sanitized report: {destination}", flush=True)
    if not all(record["passed"] for record in records):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
