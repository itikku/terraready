"""Explicit, checksum-verified native inference; no implicit downloads or cloud API."""

import argparse
import hashlib
import json
import os
import platform
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--gpu-layers", type=int, default=99)
    args = parser.parse_args()
    manifest = json.loads((ROOT / "config/local-model.json").read_text())
    model = ROOT / ".data/models" / manifest["file"]
    runtime = (
        args.runtime
        or ROOT / ".data/runtime" / ("llama-" + manifest["runtime"]["tag"]) / "llama-server"
    )
    if not model.is_file() or not runtime.is_file():
        parser.exit(
            2, "Local model/runtime missing. Follow the explicit setup in docs/LOCAL_AGENT.md.\n"
        )
    with model.open("rb") as source:
        checksum = hashlib.file_digest(source, "sha256").hexdigest()
    if model.stat().st_size != manifest["bytes"] or checksum != manifest["sha256"]:
        parser.exit(2, "Model checksum/size mismatch; inference was not started.\n")
    runtime_platform = (platform.system(), platform.machine())
    if runtime_platform == ("Darwin", "arm64"):
        expected_files = {"llama-server": manifest["runtime"]["macos_arm64_server_sha256"]}
    elif runtime_platform == ("Linux", "x86_64"):
        expected_files = manifest["runtime"]["linux_x64_cuda_12_8"]["files_sha256"]
    else:
        parser.exit(2, "No pinned runtime for this platform; inference was not started.\n")
    # An alternate location must hold the same pinned runtime, never bypass provenance.
    for name, expected in expected_files.items():
        candidate = runtime if name == "llama-server" else runtime.parent / name
        if not candidate.is_file():
            parser.exit(2, "Pinned runtime member missing; inference was not started.\n")
        with candidate.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != expected:
            parser.exit(2, "Runtime checksum mismatch; inference was not started.\n")
    key_file = ROOT / ".data/runtime/inference.key"
    if not key_file.exists():
        descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as target:
            target.write(secrets.token_hex(32))
    if key_file.stat().st_mode & 0o077:
        parser.exit(2, "Local inference key must have owner-only permissions (0600).\n")
    (ROOT / ".data/runtime/launch.json").write_text(
        json.dumps(
            {
                "model_id": manifest["model_id"],
                "model_sha256": checksum,
                "runtime_tag": manifest["runtime"]["tag"],
                "runtime_commit": manifest["runtime"]["commit"],
                "runtime_platform": "/".join(runtime_platform),
                "runtime_sha256": expected_files["llama-server"],
                "gpu_layers": args.gpu_layers,
                "threads": 2,
                "context_size": 4096,
                "slots": 1,
                "note": "Launch configuration, not a live availability or memory measurement.",
            },
            indent=2,
        )
        + "\n"
    )
    subprocess.run(
        [
            str(runtime),
            "--model",
            str(model),
            "--alias",
            manifest["model_id"],
            "--host",
            "127.0.0.1",
            "--port",
            "8080",
            "--ctx-size",
            "4096",
            "--parallel",
            "1",
            "--threads",
            "2",
            "--n-gpu-layers",
            str(args.gpu_layers),
            "--jinja",
            "--reasoning",
            "off",
            "--offline",
            "--no-ui",
            "--cors-origins",
            "http://127.0.0.1:8000",
            "--no-cors-credentials",
            "--api-key-file",
            str(key_file),
        ],
        # Do not inherit global runtime settings that could enable built-in tools/MCP.
        env={name: value for name, value in os.environ.items() if not name.startswith("LLAMA_")},
        check=True,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130) from None
