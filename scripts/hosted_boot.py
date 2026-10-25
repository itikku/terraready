"""Fresh Linux GPU bootstrap from a reviewed source-only bundle, never a local checkout.

Downloads are explicit and checksum-pinned. This script must run inside the
dedicated ephemeral Pod; it neither creates nor terminates provider resources.
"""

import hashlib
import json
import os
import platform
import subprocess
import sys
import tarfile
import time
import traceback
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]
UV_URL = (
    "https://files.pythonhosted.org/packages/3a/ad/"
    "3c2a81d66d1839063662e5b6c0002ec31f8ee987dbc5295747627ca6160a/"
    "uv-0.13.5-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl"
)
UV_SHA = "fa8d26e08e34c29c0c4e820cf3181757086d547240b4f4d31ff1d8bd810ca946"
NODE_NAME = "node-v24.22.1-linux-x64"
NODE_URL = f"https://nodejs.org/dist/v24.22.1/{NODE_NAME}.tar.xz"
NODE_SHA = "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"


def checksum(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify_source(root: Path, commit: str) -> None:
    manifest = json.loads((root / "BUNDLE_MANIFEST.json").read_text())
    if (
        manifest.get("format") != "terraready-source-v1"
        or len(commit) != 40
        or any(c not in "0123456789abcdef" for c in commit)
        or manifest.get("commit") != commit
    ):
        raise ValueError("Source provenance mismatch.")
    expected = {"BUNDLE_MANIFEST.json"}
    for entry in manifest["files"]:
        name = entry["path"]
        parts = PurePosixPath(name).parts
        if (
            not parts
            or PurePosixPath(name).is_absolute()
            or any(p.startswith(".") or p in {"..", "node_modules", "dist"} for p in parts)
            or name in expected
        ):
            raise ValueError("Invalid source member.")
        expected.add(name)
    # Inspect names/types first. Unexpected environment/storage files are never opened.
    actual = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("Source symlink refused.")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != expected:
        raise ValueError("Source contains missing or unexpected files.")
    for entry in manifest["files"]:
        path = root / entry["path"]
        if path.stat().st_size != entry["bytes"] or checksum(path) != entry["sha256"]:
            raise ValueError("Source member checksum mismatch.")


def download(url: str, path: Path, sha256: str, maximum: int) -> None:
    if not url.startswith("https://") or path.exists():
        raise ValueError("Invalid download destination.")
    print(f"Hosted startup: downloading {path.name}", flush=True)
    # The base image's system HTTPS client already fetched the verified source.
    # Use its CA store rather than inheriting a Python distribution's CA bundle.
    with path.open("xb") as target:
        subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--max-time",
                "600",
                "--max-filesize",
                str(maximum),
                url,
            ],
            stdout=target,
            env={
                k: v for k, v in os.environ.items() if not k.startswith(("TR_", "VITE_", "LLAMA_"))
            },
            check=True,
        )
    if path.stat().st_size > maximum:
        raise ValueError("Download exceeds expected size.")
    if checksum(path) != sha256:
        raise ValueError("Download checksum mismatch.")


def extract(archive: Path, target: Path) -> None:
    # Python's data filter rejects escaping paths/links and special files.
    with tarfile.open(archive) as source:
        source.extractall(target, filter="data")


def main() -> None:
    print("Hosted startup: validating Linux configuration", flush=True)
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        raise ValueError("The hosted bootstrap requires a fresh Linux x86_64 Pod.")
    if os.environ.get("RUNPOD_API_KEY"):
        raise ValueError("Provider management credentials must stay in the controller.")
    secret = os.environ.get("TR_ORIGIN_SECRET", "")
    if len(secret) != 64 or any(c not in "0123456789abcdef" for c in secret):
        raise ValueError("New gateway secret missing.")
    print("Hosted startup: verifying source manifest", flush=True)
    verify_source(ROOT, os.environ.get("TR_SOURCE_COMMIT", ""))
    print("Hosted startup: source manifest verified", flush=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VITE_", "LLAMA_", "TR_"))}
    env["UV_NO_ENV_FILE"] = "1"
    os.umask(0o077)
    data = ROOT / ".data"
    data.mkdir()  # A partial/reused bootstrap must fail rather than reset state.
    tools = data / "tools"
    tools.mkdir()
    wheel = tools / UV_URL.rsplit("/", 1)[1]
    download(UV_URL, wheel, UV_SHA, 17_211_825)
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-index", "--no-deps", str(wheel)],
        env=env,
        check=True,
    )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "uv",
            "sync",
            "--frozen",
            "--no-dev",
            "--managed-python",
            "--python",
            "3.12.12",
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )
    node_archive = tools / (NODE_NAME + ".tar.xz")
    download(NODE_URL, node_archive, NODE_SHA, 60_000_000)
    extract(node_archive, tools)
    env["PATH"] = str(tools / NODE_NAME / "bin") + os.pathsep + env.get("PATH", "/usr/bin:/bin")
    for command in (
        ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        ["npm", "run", "build"],
    ):
        subprocess.run(command, cwd=ROOT, env=env, check=True)
    manifest = json.loads((ROOT / "config/local-model.json").read_text())
    model_dir = data / "models"
    model_dir.mkdir()
    model_url = (
        "https://huggingface.co/"
        + manifest["repository"]
        + "/resolve/"
        + manifest["revision"]
        + "/"
        + manifest["file"]
    )
    download(model_url, model_dir / manifest["file"], manifest["sha256"], manifest["bytes"])
    runtime_dir = data / "runtime"
    runtime_dir.mkdir()
    pinned = manifest["runtime"]["linux_x64_cuda_12_8"]
    archive = tools / pinned["archive"]
    download(pinned["source"], archive, pinned["archive_sha256"], pinned["archive_bytes"])
    extract(archive, runtime_dir)
    servers = list(runtime_dir.rglob("llama-server"))
    if len(servers) != 1:
        raise ValueError("Pinned runtime server missing or ambiguous.")
    # Existing launcher verifies every pinned shared-library/server hash, creates
    # a fresh owner-only inference key and binds the real model to loopback.
    python = str(ROOT / ".venv/bin/python")
    model = subprocess.Popen(
        [python, "scripts/serve_model.py", "--runtime", str(servers[0])],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(120):
            if model.poll() is not None:
                raise ValueError("Pinned model failed to start.")
            try:
                with urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=1) as r:
                    if r.status == 200:
                        break
            except (URLError, TimeoutError):
                pass
            time.sleep(1)
        else:
            raise ValueError("Model readiness timed out.")
        env["TR_ORIGIN_SECRET"] = secret
        subprocess.run(
            [
                python,
                "-m",
                "uvicorn",
                "scripts.hosted_api:create",
                "--factory",
                "--host",
                "0.0.0.0",
                "--port",
                "8000",
                "--workers",
                "1",
                "--no-access-log",
            ],
            cwd=ROOT,
            env=env,
            check=True,
        )
    finally:
        model.terminate()
        try:
            model.wait(timeout=5)
        except subprocess.TimeoutExpired:
            model.kill()
            model.wait()


def report_failure(error: BaseException) -> None:
    frames = traceback.extract_tb(error.__traceback__)
    where = f" at {Path(frames[-1].filename).name}:{frames[-1].lineno}" if frames else ""
    # Class and source location only: never the exception message or locals.
    print(
        f"Hosted startup failed ({type(error).__name__}{where}); "
        "controller must terminate this run.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.SubprocessError) as error:
        report_failure(error)
        raise SystemExit(1) from None
