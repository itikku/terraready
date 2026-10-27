"""Build once from reviewed public source; boot the immutable runtime without downloads."""

import argparse
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.error import URLError

from hosted_boot import (
    NODE_NAME,
    NODE_SHA,
    NODE_URL,
    ROOT,
    UV_SHA,
    UV_URL,
    checksum,
    download,
    extract,
    report_failure,
    verify_source,
)

CUDA_WHEELS = (
    (
        "https://files.pythonhosted.org/packages/dc/61/"
        "e24b560ab2e2eaeb3c839129175fb330dfcfc29e5203196e5541a4c44682/"
        "nvidia_cublas_cu12-12.8.4.1-py3-none-manylinux_2_27_x86_64.whl",
        "8ac4e771d5a348c551b2a426eda6193c19aa630236b418086020df5ba9667142",
        594_346_921,
    ),
    (
        "https://files.pythonhosted.org/packages/0d/9b/"
        "a997b638fcd068ad6e4d53b8551a7d30fe8b404d6f1804abf1df69838932/"
        "nvidia_cuda_runtime_cu12-12.8.90-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        "adade8dcbd0edf427b7204d480d6066d33902cab2a4707dcfc48a2d0fd44ab90",
        954_765,
    ),
)
STAGES = {"loading_model", "checking_workspace", "ready", "failed"}


def verify_linkage(binary: Path, env: dict[str, str]) -> None:
    links = subprocess.run(
        ["ldd", str(binary)], env=env, text=True, capture_output=True, check=False
    )
    # ldd reports missing symbol versions on stderr and missing libraries on
    # stdout. A CPU builder lacks only the NVIDIA driver supplied by the host.
    failures = [
        line
        for line in (links.stdout + "\n" + links.stderr).splitlines()
        if "not found" in line and not re.fullmatch(r"\s*libcuda\.so\.1\s+=>\s+not found\s*", line)
    ]
    if failures or links.returncode:
        names = sorted(
            set(
                re.findall(
                    r"\b(?:lib[A-Za-z0-9_+.-]+\.so(?:\.[0-9]+)*|"
                    r"GLIBC(?:XX)?_[0-9.]+|CXXABI_[0-9.]+)\b",
                    "\n".join(failures),
                )
            )
        )
        names = [name for name in names if len(name) <= 80][:8]
        # Only bounded library/version tokens are printed, never raw paths,
        # arbitrary linker text, environment values or exception messages.
        print(
            "Packaged linkage failed: "
            + json.dumps({"requirements": names, "exitCode": links.returncode}),
            flush=True,
        )
        raise ValueError("Packaged runtime linkage is incomplete or incompatible.")


def child_environment() -> dict[str, str]:
    # Membership/deletion happens before iterating values or spawning anything.
    if "RUNPOD_API_KEY" in os.environ:
        del os.environ["RUNPOD_API_KEY"]
    return {k: v for k, v in os.environ.items() if not k.startswith(("VITE_", "LLAMA_", "TR_"))}


def build(commit: str) -> None:
    """Only called in the Linux CI image build, never on a rented GPU."""
    env = child_environment()
    verify_source(ROOT, commit)
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        raise ValueError("The packaged runtime requires Linux x86_64.")
    data = ROOT / ".data"
    data.mkdir()
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
        [sys.executable, "-m", "uv", "sync", "--frozen", "--no-dev", "--python", sys.executable],
        cwd=ROOT,
        env=env,
        check=True,
    )
    node = tools / (NODE_NAME + ".tar.xz")
    download(NODE_URL, node, NODE_SHA, 60_000_000)
    extract(node, tools)
    env["PATH"] = str(tools / NODE_NAME / "bin") + os.pathsep + env.get("PATH", "/usr/bin:/bin")
    for command in (
        ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        ["npm", "run", "build"],
    ):
        subprocess.run(command, cwd=ROOT, env=env, check=True)
    manifest = json.loads((ROOT / "config/local-model.json").read_text())
    models = data / "models"
    models.mkdir()
    model_url = (
        "https://huggingface.co/"
        + manifest["repository"]
        + "/resolve/"
        + manifest["revision"]
        + "/"
        + manifest["file"]
    )
    runtime = data / "runtime"
    runtime.mkdir()
    pinned = manifest["runtime"]["linux_x64_cuda_12_8"]
    archive = tools / pinned["archive"]
    download(pinned["source"], archive, pinned["archive_sha256"], pinned["archive_bytes"])
    extract(archive, runtime)
    for url, sha, size in CUDA_WHEELS:
        path = tools / url.rsplit("/", 1)[1]
        download(url, path, sha, size)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "uv",
                "pip",
                "install",
                "--python",
                str(ROOT / ".venv/bin/python"),
                "--no-deps",
                str(path),
            ],
            env=env,
            check=True,
        )
    servers = list(runtime.rglob("llama-server"))
    if len(servers) != 1:
        raise ValueError("Pinned runtime server missing or ambiguous.")
    for binary in (servers[0], servers[0].parent / "libggml-cuda.so"):
        verify_linkage(binary, env)
    print("Packaged server/CUDA linkage verified; GPU driver is host-supplied.", flush=True)
    download(model_url, models / manifest["file"], manifest["sha256"], manifest["bytes"])
    web = ROOT / "apps/web/dist"
    records = [
        {"path": p.relative_to(web).as_posix(), "sha256": checksum(p)}
        for p in sorted(web.rglob("*"))
        if p.is_file()
    ]
    (ROOT / "IMAGE_MANIFEST.json").write_text(
        json.dumps(
            {
                "format": "terraready-runtime-v1",
                "commit": commit,
                "web": records,
            },
            sort_keys=True,
        )
        + "\n"
    )
    shutil.rmtree(tools)
    shutil.rmtree(ROOT / "node_modules")
    shutil.rmtree(ROOT / "apps/controller/node_modules", ignore_errors=True)


def verify_packaged(commit: str) -> Path:
    """A digest-pinned image carries its clean source identity and built asset hashes."""
    image = json.loads((ROOT / "IMAGE_MANIFEST.json").read_text())
    if (
        image.get("format") != "terraready-runtime-v1"
        or image.get("commit") != commit
        or len(commit) != 40
        or any(c not in "0123456789abcdef" for c in commit)
    ):
        raise ValueError("Packaged source identity mismatch.")
    source = json.loads((ROOT / "BUNDLE_MANIFEST.json").read_text())
    if source.get("format") != "terraready-source-v1" or source.get("commit") != commit:
        raise ValueError("Packaged source manifest mismatch.")
    for entry in source["files"]:
        name = entry["path"]
        parts = PurePosixPath(name).parts
        if (
            not parts
            or PurePosixPath(name).is_absolute()
            or any(p.startswith(".") or p == ".." for p in parts)
        ):
            raise ValueError("Invalid packaged source member.")
        path = ROOT / name
        if (
            path.is_symlink()
            or path.stat().st_size != entry["bytes"]
            or checksum(path) != entry["sha256"]
        ):
            raise ValueError("Packaged source checksum mismatch.")
    web = ROOT / "apps/web/dist"
    expected = set()
    for entry in image["web"]:
        name = entry["path"]
        parts = PurePosixPath(name).parts
        if (
            not parts
            or PurePosixPath(name).is_absolute()
            or any(p.startswith(".") or p == ".." for p in parts)
        ):
            raise ValueError("Invalid packaged frontend member.")
        expected.add(name)
        path = web / name
        if path.is_symlink() or checksum(path) != entry["sha256"]:
            raise ValueError("Packaged frontend checksum mismatch.")
    if {p.relative_to(web).as_posix() for p in web.rglob("*") if p.is_file()} != expected:
        raise ValueError("Unexpected packaged frontend member.")
    servers = list((ROOT / ".data/runtime").rglob("llama-server"))
    if len(servers) != 1:
        raise ValueError("Pinned runtime server missing or ambiguous.")
    # serve_model.py checks the pinned model and every runtime member before execution.
    return servers[0]


def progress(stage: str) -> None:
    if stage not in STAGES:
        raise ValueError("Unknown startup stage.")
    path = ROOT / ".data/startup.json"
    pending = path.with_suffix(".pending")
    pending.write_text(json.dumps({"stage": stage, "changedAt": int(time.time() * 1000)}))
    pending.replace(path)
    print("Hosted startup: " + stage, flush=True)


def workspace_ready(secret: str) -> bool:
    stamp, nonce = str(int(time.time())), secrets.token_hex(16)
    canonical = "\n".join(
        [
            "terraready-origin-v1",
            stamp,
            nonce,
            "0" * 64,
            "GET",
            "/ready",
            hashlib.sha256(b"").hexdigest(),
        ]
    )
    signature = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        "http://127.0.0.1:8000/ready",
        headers={
            "X-TR-Time": stamp,
            "X-TR-Nonce": nonce,
            "X-TR-Visitor": "0" * 64,
            "X-TR-Signature": signature,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as response:
            return response.status == 200
    except (URLError, TimeoutError):
        return False


def run() -> None:
    env = child_environment()
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        raise ValueError("The packaged runtime requires Linux x86_64.")
    secret = os.environ.get("TR_ORIGIN_SECRET", "")
    if len(secret) != 64 or any(c not in "0123456789abcdef" for c in secret):
        raise ValueError("New gateway secret missing.")
    runtime = verify_packaged(os.environ.get("TR_SOURCE_COMMIT", ""))
    os.umask(0o077)
    if (ROOT / ".data/startup.json").exists() or (ROOT / ".data/hosted").exists():
        raise ValueError("A reused runtime must not reset an existing session.")
    progress("loading_model")
    python = str(ROOT / ".venv/bin/python")
    api_env = {**env, "TR_ORIGIN_SECRET": secret}
    api = subprocess.Popen(
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
        env=api_env,
    )
    model = None
    try:
        model = subprocess.Popen(
            [python, "scripts/serve_model.py", "--runtime", str(runtime)],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(120):
            if model.poll() is not None or api.poll() is not None:
                raise ValueError("Packaged service failed to start.")
            try:
                with urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError):
                pass
            time.sleep(1)
        else:
            raise ValueError("Model readiness timed out.")
        progress("checking_workspace")
        for _ in range(30):
            if workspace_ready(secret):
                break
            if api.poll() is not None:
                raise ValueError("Workspace failed to start.")
            time.sleep(1)
        else:
            raise ValueError("Workspace readiness timed out.")
        progress("ready")
        if api.wait() != 0:
            raise ValueError("Workspace stopped unexpectedly.")
    except BaseException:
        progress("failed")
        raise
    finally:
        for process in (api, model):
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "run"])
    parser.add_argument("--commit", default="")
    args = parser.parse_args()
    try:
        build(args.commit) if args.command == "build" else run()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        report_failure(error)
        raise SystemExit(1) from None
