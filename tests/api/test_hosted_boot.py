"""Disposable bootstrap contracts: no real downloads, model, credentials or cloud."""

import hashlib
import importlib.util
import io
import json
import tarfile
from pathlib import Path

import pytest


@pytest.fixture
def boot():
    spec = importlib.util.spec_from_file_location(
        "hosted_boot_test", Path(__file__).resolve().parents[2] / "scripts/hosted_boot.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source(root):
    content = b"synthetic source only"
    (root / "app.py").write_bytes(content)
    manifest = {
        "format": "terraready-source-v1",
        "commit": "a" * 40,
        "files": [
            {"path": "app.py", "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        ],
    }
    (root / "BUNDLE_MANIFEST.json").write_text(json.dumps(manifest))
    return manifest


def test_source_requires_exact_committed_members_and_hashes(boot, tmp_path):
    source(tmp_path)
    boot.verify_source(tmp_path, "a" * 40)
    with pytest.raises(ValueError, match="provenance"):
        boot.verify_source(tmp_path, "b" * 40)
    (tmp_path / "app.py").write_text("tampered")
    with pytest.raises(ValueError, match="checksum"):
        boot.verify_source(tmp_path, "a" * 40)


@pytest.mark.parametrize("extra", [".env.local", ".data/history.db", "node_modules/cached.js"])
def test_unlisted_private_or_built_files_rejected_without_reading_them(
    boot, tmp_path, extra, monkeypatch
):
    source(tmp_path)
    target = tmp_path / extra
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("synthetic-forbidden-file")
    monkeypatch.setattr(
        boot, "checksum", lambda path: pytest.fail("No member should be opened yet")
    )
    with pytest.raises(ValueError, match="unexpected"):
        boot.verify_source(tmp_path, "a" * 40)


@pytest.mark.parametrize("name", ["../outside", "/outside", ".env.local", "dir/../file", "app.py"])
def test_escaping_secret_and_duplicate_source_records_refused(boot, tmp_path, name):
    manifest = source(tmp_path)
    manifest["files"].append({"path": name, "bytes": 0, "sha256": "a" * 64})
    (tmp_path / "BUNDLE_MANIFEST.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="member"):
        boot.verify_source(tmp_path, "a" * 40)


def test_source_symlinks_cannot_import_an_existing_file(boot, tmp_path):
    source(tmp_path)
    (tmp_path / "link.py").symlink_to(tmp_path / "app.py")
    with pytest.raises(ValueError, match="symlink"):
        boot.verify_source(tmp_path, "a" * 40)


def test_download_checks_hash_size_https_and_refuses_overwrite(boot, tmp_path, monkeypatch):
    payload = b"synthetic download"
    sha = hashlib.sha256(payload).hexdigest()
    calls = []

    def curl(args, **kwargs):
        calls.append((args, kwargs))
        kwargs["stdout"].write(payload)

    monkeypatch.setattr(boot.subprocess, "run", curl)
    path = tmp_path / "public-asset"
    boot.download("https://example.org/asset", path, sha, len(payload))
    assert path.read_bytes() == payload
    args, options = calls[0]
    assert args[0] == "curl" and "--fail" in args and "--max-filesize" in args
    assert args[args.index("--proto") + 1] == "=https"
    assert args[args.index("--proto-redir") + 1] == "=https"
    assert options["check"] is True
    assert all(not key.startswith("TR_") for key in options["env"])
    with pytest.raises(ValueError, match="destination"):
        boot.download("https://example.org/asset", path, sha, len(payload))
    with pytest.raises(ValueError, match="destination"):
        boot.download("http://example.org/asset", tmp_path / "insecure", sha, len(payload))
    with pytest.raises(ValueError, match="checksum"):
        boot.download("https://example.org/asset", tmp_path / "bad-hash", "a" * 64, len(payload))
    with pytest.raises(ValueError, match="size"):
        boot.download("https://example.org/asset", tmp_path / "large", sha, 2)


def test_archive_cannot_write_outside_runtime_directory(boot, tmp_path):
    archive = tmp_path / "archive.tar"
    with tarfile.open(archive, "w") as out:
        member = tarfile.TarInfo("../escape")
        member.size = 1
        out.addfile(member, io.BytesIO(b"x"))
    with pytest.raises(tarfile.FilterError):
        boot.extract(archive, tmp_path / "runtime")
    assert not (tmp_path / "escape").exists()


def test_failure_diagnostic_names_stage_location_without_leaking_exception_values(boot, capsys):
    try:
        raise ValueError("synthetic-sensitive-value-must-not-appear")
    except ValueError as error:
        boot.report_failure(error)
    output = capsys.readouterr().err
    assert "ValueError at test_hosted_boot.py:" in output
    assert "controller must terminate" in output
    assert "synthetic-sensitive-value" not in output


def test_boot_refuses_other_platforms_and_missing_gateway_before_any_download(
    boot, tmp_path, monkeypatch
):
    boot.ROOT = tmp_path
    monkeypatch.setattr(boot.platform, "system", lambda: "Darwin")
    with pytest.raises(ValueError, match="Linux"):
        boot.main()
    monkeypatch.setattr(boot.platform, "system", lambda: "Linux")
    monkeypatch.setattr(boot.platform, "machine", lambda: "x86_64")
    monkeypatch.setenv("RUNPOD_API_KEY", "synthetic-key")
    monkeypatch.delenv("TR_ORIGIN_SECRET", raising=False)
    with pytest.raises(ValueError, match="gateway"):
        boot.main()
    assert "RUNPOD_API_KEY" not in boot.os.environ
    assert not (tmp_path / ".data").exists()


@pytest.mark.parametrize("injected_key", [None, "", "synthetic-provider-key"])
def test_boot_uses_locked_build_fresh_keys_loopback_model_and_one_signed_api(
    boot, tmp_path, monkeypatch, injected_key, capsys
):
    boot.ROOT = tmp_path
    (tmp_path / "config").mkdir()
    original = Path(__file__).resolve().parents[2]
    (tmp_path / "config/local-model.json").write_bytes(
        (original / "config/local-model.json").read_bytes()
    )
    monkeypatch.setattr(boot.platform, "system", lambda: "Linux")
    monkeypatch.setattr(boot.platform, "machine", lambda: "x86_64")

    class GuardedEnvironment(dict):
        def __getitem__(self, key):
            assert key != "RUNPOD_API_KEY", "Provider key value must never be read"
            return super().__getitem__(key)

        def get(self, key, default=None):
            assert key != "RUNPOD_API_KEY", "Provider key value must never be read"
            return super().get(key, default)

        def items(self):
            assert "RUNPOD_API_KEY" not in self, "Discard key before copying child environments"
            return super().items()

    environment = GuardedEnvironment(
        TR_ORIGIN_SECRET="a" * 64,
        TR_SOURCE_COMMIT="b" * 40,
        VITE_MAPBOX_TOKEN="synthetic-not-for-build",
        LLAMA_ARG_TOOLS="synthetic-unwanted-setting",
    )
    if injected_key is not None:
        environment["RUNPOD_API_KEY"] = injected_key
    monkeypatch.setattr(boot.os, "environ", environment)
    checks = []
    monkeypatch.setattr(boot, "verify_source", lambda *args: checks.append(args))
    downloads = []

    def download(url, path, sha, size):
        assert "RUNPOD_API_KEY" not in environment
        downloads.append((url, sha, size))
        path.write_bytes(b"synthetic downloaded artifact")

    monkeypatch.setattr(boot, "download", download)

    def extract(archive, target):
        if archive.name.endswith(".xz"):
            (target / boot.NODE_NAME / "bin").mkdir(parents=True)
        else:
            (target / "llama-server").write_bytes(b"synthetic runtime")

    monkeypatch.setattr(boot, "extract", extract)
    calls = []
    monkeypatch.setattr(
        boot.subprocess, "run", lambda args, **kwargs: calls.append((args, dict(kwargs["env"])))
    )

    class Process:
        terminated = False

        def poll(self):
            return None

        def terminate(self):
            self.terminated = True

        def wait(self, **kwargs):
            return 0

    model = Process()

    def start(args, **kwargs):
        calls.append((args, dict(kwargs["env"])))
        return model

    monkeypatch.setattr(boot.subprocess, "Popen", start)
    health = io.BytesIO(b"{}")
    health.status = 200
    monkeypatch.setattr(boot.urllib.request, "urlopen", lambda *a, **k: health)
    boot.main()
    assert "RUNPOD_API_KEY" not in environment
    output = capsys.readouterr()
    assert "synthetic-provider-key" not in output.out + output.err
    assert checks == [(tmp_path, "b" * 40)]
    assert len(downloads) == 4
    assert all(
        url.startswith("https://") and len(sha) == 64 and size > 0 for url, sha, size in downloads
    )
    assert "--frozen" in calls[1][0] and "3.12.12" in calls[1][0]
    assert calls[2][0] == ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]
    assert "scripts/serve_model.py" in calls[-2][0]
    assert "scripts.hosted_api:create" in calls[-1][0]
    assert calls[-1][0][calls[-1][0].index("--workers") + 1] == "1"
    for _, env in calls:
        assert "RUNPOD_API_KEY" not in env
        assert "VITE_MAPBOX_TOKEN" not in env and "LLAMA_ARG_TOOLS" not in env
        assert "TR_SOURCE_COMMIT" not in env
    assert all("TR_ORIGIN_SECRET" not in env for _, env in calls[:-1])
    assert calls[-1][1]["TR_ORIGIN_SECRET"] == "a" * 64
    assert model.terminated
