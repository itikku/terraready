"""Export only typed, sanitized facts from an actual completed local-model smoke."""

import json
from pathlib import Path

from terraready.agent_models import AssistRun
from terraready.system_evidence import VerificationEvidence

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    raw = json.loads((ROOT / ".data/reports/local-agent.json").read_text())
    manifest = raw["model_manifest"]
    config = raw["hardware"]["runtime_configuration"]
    if config["model_id"] != manifest["model_id"] or config["model_sha256"] != manifest["sha256"]:
        raise ValueError("Launch/model provenance mismatch; no artifact exported.")
    cases = []
    for case in raw["cases"]:
        run = AssistRun.model_validate(case["run"])
        cases.append(
            {
                "name": case["case"],
                "passed": case["passed"],
                "mode": run.mode,
                "elapsed_ms": run.elapsed_ms,
                "tools": [t.tool for t in run.trace],
                "task_ids": [f.task_id for f in run.facts],
                "evidence_ids": sorted({e for f in run.facts for e in f.evidence_ids}),
            }
        )
    report = VerificationEvidence.model_validate(
        {
            "kind": raw["kind"],
            "recorded_at": raw["measured_at"],
            "source_base_commit": raw["base_commit"],
            "working_tree_dirty": raw["working_tree_dirty"],
            "source_sha256": raw["source_sha256"],
            "dataset_sha256": raw["dataset_sha256"],
            "model": {
                "model_id": manifest["model_id"],
                "revision": manifest["revision"],
                "weights_sha256": manifest["sha256"],
                "license": manifest["license"],
                "runtime_tag": manifest["runtime"]["tag"],
                "runtime_commit": manifest["runtime"]["commit"],
            },
            "hardware": {
                "host": raw["hardware"].get("cpu_name", "Unreported host; architecture recorded"),
                "os": raw["hardware"]["os"],
                "architecture": raw["hardware"]["architecture"],
                "host_memory_bytes": raw["hardware"].get("host_memory_bytes"),
                "gpu_layers_requested": config["gpu_layers"],
                "cpu_threads": config["threads"],
                "context_size": config["context_size"],
            },
            "cases": cases,
            "completed": raw["completed"],
            "limitations": [
                raw["limits"],
                "GPU layers are requested launch configuration, not a VRAM measurement.",
                "No Jetson or Runpod test. Peak RAM/VRAM, power and provider charges not measured.",
                "No verified full-stack external-access denial. "
                "Offline flag/browser blocking are not proof.",
            ],
        }
    )
    # Printing a patch keeps promotion into version control explicit and reviewable.
    print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
