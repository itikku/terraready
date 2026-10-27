"""Immutable image contracts with synthetic files, never downloads or a real GPU."""

import hashlib
import importlib.util
import io
import json
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def image(monkeypatch):
    scripts = Path(__file__).resolve().parents[2] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    spec = importlib.util.spec_from_file_location("hosted_image_test", scripts / "hosted_image.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def packaged(root):
    content = b"synthetic source"
    (root / "app.py").write_bytes(content)
    (root / "BUNDLE_MANIFEST.json").write_text(
        json.dumps(
            {
                "format": "terraready-source-v1",
                "commit": "a" * 40,
                "files": [
                    {
                        "path": "app.py",
                        "bytes": len(content),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                ],
            }
        )
    )
    web = root / "apps/web/dist"
    web.mkdir(parents=True)
    (web / "index.html").write_bytes(b"synthetic built app")
    (root / "IMAGE_MANIFEST.json").write_text(
        json.dumps(
            {
                "format": "terraready-runtime-v1",
                "commit": "a" * 40,
                "web": [
                    {
                        "path": "index.html",
                        "sha256": hashlib.sha256(b"synthetic built app").hexdigest(),
                    }
                ],
            }
        )
    )
    runtime = root / ".data/runtime/llama-server"
    runtime.parent.mkdir(parents=True)
    runtime.write_bytes(b"synthetic pinned runtime")
    return runtime


def test_packaged_source_identity_and_built_assets_fail_closed(image, tmp_path):
    image.ROOT = tmp_path
    runtime = packaged(tmp_path)
    assert image.verify_packaged("a" * 40) == runtime
    with pytest.raises(ValueError, match="identity"):
        image.verify_packaged("b" * 40)
    (tmp_path / "apps/web/dist/unexpected.js").write_text("unexpected")
    with pytest.raises(ValueError, match="Unexpected"):
        image.verify_packaged("a" * 40)
    (tmp_path / "apps/web/dist/unexpected.js").unlink()
    (tmp_path / "app.py").write_text("modified")
    with pytest.raises(ValueError, match="checksum"):
        image.verify_packaged("a" * 40)


@pytest.mark.parametrize("member", ["../secret", "/secret", ".env.local"])
def test_packaged_manifest_rejects_escaping_private_paths_before_read(image, tmp_path, member):
    image.ROOT = tmp_path
    packaged(tmp_path)
    path = tmp_path / "BUNDLE_MANIFEST.json"
    manifest = json.loads(path.read_text())
    manifest["files"][0]["path"] = member
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="member"):
        image.verify_packaged("a" * 40)


def test_image_progress_is_atomic_bounded_and_contains_no_freeform_values(image, tmp_path):
    image.ROOT = tmp_path
    (tmp_path / ".data").mkdir()
    image.progress("loading_model")
    body = json.loads((tmp_path / ".data/startup.json").read_text())
    assert set(body) == {"stage", "changedAt"}
    assert body["stage"] == "loading_model" and type(body["changedAt"]) is int
    assert not (tmp_path / ".data/startup.pending").exists()
    with pytest.raises(ValueError, match="stage"):
        image.progress("freeform must not escape")


def test_fast_runtime_discards_provider_key_before_environment_copy(image, monkeypatch):
    class Environment(dict):
        def items(self):
            assert "RUNPOD_API_KEY" not in self
            return super().items()

        def get(self, key, default=None):
            assert key != "RUNPOD_API_KEY"
            return super().get(key, default)

    environment = Environment(
        RUNPOD_API_KEY="synthetic-never-read",
        VITE_MAPBOX_TOKEN="synthetic",
        LLAMA_ARG_TOOLS="synthetic",
        TR_SOURCE_COMMIT="a" * 40,
        PATH="/usr/bin",
    )
    monkeypatch.setattr(image.os, "environ", environment)
    assert image.child_environment() == {"PATH": "/usr/bin"}
    assert "RUNPOD_API_KEY" not in environment


def test_fast_boot_uses_prebuilt_files_and_only_signed_ready_request(image, tmp_path, monkeypatch):
    image.ROOT = tmp_path
    runtime = packaged(tmp_path)
    monkeypatch.setattr(image.platform, "system", lambda: "Linux")
    monkeypatch.setattr(image.platform, "machine", lambda: "x86_64")
    monkeypatch.setenv("TR_ORIGIN_SECRET", "a" * 64)
    monkeypatch.setenv("TR_SOURCE_COMMIT", "a" * 40)
    monkeypatch.setenv("RUNPOD_API_KEY", "synthetic-never-inherit")
    monkeypatch.setattr(image, "download", lambda *args: pytest.fail("No runtime downloads"))
    calls = []

    class Process:
        terminated = False

        def poll(self):
            return None

        def wait(self, **kwargs):
            return 0

        def terminate(self):
            self.terminated = True

    processes = []

    def start(args, **kwargs):
        calls.append((args, kwargs["env"]))
        process = Process()
        processes.append(process)
        return process

    monkeypatch.setattr(image.subprocess, "Popen", start)
    requests = []

    def respond(req, **kwargs):
        requests.append(req)
        response = io.BytesIO(b"{}")
        response.status = 200
        return response

    monkeypatch.setattr(image.urllib.request, "urlopen", respond)
    image.run()
    assert len(calls) == 2
    assert "uvicorn" in calls[0][0] and "serve_model.py" in " ".join(calls[1][0])
    assert str(runtime) in calls[1][0]
    assert calls[0][1]["TR_ORIGIN_SECRET"] == "a" * 64
    assert "TR_ORIGIN_SECRET" not in calls[1][1]
    assert all("RUNPOD_API_KEY" not in env for _, env in calls)
    assert all(p.terminated for p in processes)
    assert requests[0] == "http://127.0.0.1:8080/health"
    assert requests[1].full_url == "http://127.0.0.1:8000/ready"
    assert requests[1].get_header("X-tr-signature")
    assert json.loads((tmp_path / ".data/startup.json").read_text())["stage"] == "ready"
    with pytest.raises(ValueError, match="reused"):
        image.run()


def test_runtime_image_context_and_workflow_do_not_copy_local_files():
    root = Path(__file__).resolve().parents[2]
    docker = (root / "deploy/Dockerfile").read_text()
    workflow = (root / ".github/workflows/runtime-image.yml").read_text()
    assert "python:3.12.12-slim-trixie@sha256:" in docker
    assert "runpod/pytorch" not in docker
    assert "scripts/hosted_image.py build" in docker
    assert "bundle_source.py" in workflow and '"$RUNNER_TEMP/terraready-context"' in workflow
    assert "workflow_dispatch:" in workflow and "packages: write" in workflow
    assert "docker login" in workflow and "GITHUB_TOKEN" in workflow
    assert "RUNPOD_API_KEY" not in workflow


def test_linkage_allows_only_the_exact_host_driver_gap(image, monkeypatch):
    def check(args, **kwargs):
        assert args == ["ldd", "/runtime/libggml-cuda.so"]
        assert kwargs["capture_output"] and not kwargs["check"]
        return subprocess.CompletedProcess(
            args, 0, "libcuda.so.1 => not found\nlibcublas.so.12 => /runtime/libcublas.so.12\n", ""
        )

    monkeypatch.setattr(image.subprocess, "run", check)
    image.verify_linkage(Path("/runtime/libggml-cuda.so"), {})


@pytest.mark.parametrize(
    "stdout,stderr",
    [
        ("libcublas.so.12 => not found", ""),
        (
            "",
            "/synthetic-private-path/libggml-cuda.so: /lib/libc.so.6: "
            "version `GLIBC_2.38' not found "
            "(required by /synthetic-private-path/libggml-cuda.so)",
        ),
        ("", "libcuda.so.1: version `GLIBC_2.50' not found (required by libc.so.6)"),
    ],
)
def test_linkage_rejects_missing_libraries_and_versions_with_safe_diagnostics(
    image, monkeypatch, capsys, stdout, stderr
):
    monkeypatch.setattr(
        image.subprocess,
        "run",
        lambda args, **kwargs: subprocess.CompletedProcess(args, 0, stdout, stderr),
    )
    with pytest.raises(ValueError, match="incomplete or incompatible"):
        image.verify_linkage(Path("/runtime/libggml-cuda.so"), {})
    output = capsys.readouterr().out
    assert "Packaged linkage failed" in output
    assert "libcublas.so.12" in output or "GLIBC_2." in output
    assert "/synthetic-private-path" not in output
    assert len(output) < 1024


def test_linker_failure_without_known_requirement_still_fails_without_raw_output(
    image, monkeypatch, capsys
):
    monkeypatch.setattr(
        image.subprocess,
        "run",
        lambda args, **kwargs: subprocess.CompletedProcess(args, 1, "", "synthetic-private-value"),
    )
    with pytest.raises(ValueError, match="incomplete or incompatible"):
        image.verify_linkage(Path("/runtime/libggml-cuda.so"), {})
    output = capsys.readouterr().out
    assert '"exitCode": 1' in output
    assert "synthetic-private-value" not in output
