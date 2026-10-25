import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def launcher(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "serve_model_test", Path(__file__).resolve().parents[2] / "scripts/serve_model.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = tmp_path
    model = tmp_path / ".data/models/model.gguf"
    model.parent.mkdir(parents=True)
    model.write_bytes(b"synthetic model bytes, not weights")
    runtime = tmp_path / ".data/runtime/llama-test/llama-server"
    runtime.parent.mkdir(parents=True)
    runtime.write_bytes(b"synthetic executable bytes, never executed")
    manifest = {
        "file": "model.gguf",
        "model_id": "test-only",
        "bytes": model.stat().st_size,
        "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        "runtime": {
            "tag": "test",
            "commit": "a" * 40,
            "macos_arm64_server_sha256": hashlib.sha256(runtime.read_bytes()).hexdigest(),
        },
    }
    (tmp_path / "config").mkdir()
    (tmp_path / "config/local-model.json").write_text(json.dumps(manifest))
    monkeypatch.setattr("sys.argv", ["serve_model.py"])
    monkeypatch.setattr(module.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(module.platform, "machine", lambda: "arm64")
    calls = []
    monkeypatch.setattr(
        module.subprocess, "run", lambda *args, **kwargs: calls.append((args, kwargs))
    )
    return module, model, runtime, calls


def test_launcher_checks_files_locks_down_runtime_and_records_actual_configuration(
    launcher, monkeypatch
):
    module, model, runtime, calls = launcher
    monkeypatch.setenv("LLAMA_ARG_AGENT", "true")
    monkeypatch.setenv("LLAMA_ARG_TOOLS", "exec_shell_command")
    module.main()
    argv, kwargs = calls[0]
    command = argv[0]
    assert command[0] == str(runtime)
    assert command[command.index("--host") + 1] == "127.0.0.1"
    assert command[command.index("--n-gpu-layers") + 1] == "99"
    assert "--offline" in command and "--no-ui" in command
    assert "--api-key-file" in command and "--cors-origins" in command
    assert not any(key.startswith("LLAMA_") for key in kwargs["env"])
    key = module.ROOT / ".data/runtime/inference.key"
    assert len(key.read_text()) == 64
    assert key.stat().st_mode & 0o077 == 0
    assert json.loads((key.parent / "launch.json").read_text())["gpu_layers"] == 99
    # Restart preserves the local key; no credentials ever enter the command line.
    original = key.read_text()
    module.main()
    assert key.read_text() == original
    assert original not in " ".join(command)


@pytest.mark.parametrize(
    "fault",
    [
        "missing_model",
        "missing_runtime",
        "model_hash",
        "model_size",
        "runtime_hash",
        "key_permissions",
    ],
)
def test_launcher_refuses_invalid_assets_or_key_permissions_before_execution(launcher, fault):
    module, model, runtime, calls = launcher
    if fault == "missing_model":
        model.unlink()
    elif fault == "missing_runtime":
        runtime.unlink()
    elif fault == "model_hash":
        model.write_bytes(b"x" * model.stat().st_size)
    elif fault == "model_size":
        model.write_bytes(b"x")
    elif fault == "runtime_hash":
        runtime.write_bytes(b"changed")
    else:
        key = module.ROOT / ".data/runtime/inference.key"
        key.write_text("test key")
        key.chmod(0o644)
    with pytest.raises(SystemExit) as caught:
        module.main()
    assert caught.value.code == 2
    assert calls == []


def test_explicit_cpu_option_is_recorded(launcher, monkeypatch):
    module, _, _, _ = launcher
    monkeypatch.setattr("sys.argv", ["serve_model.py", "--gpu-layers", "0"])
    module.main()
    assert json.loads((module.ROOT / ".data/runtime/launch.json").read_text())["gpu_layers"] == 0


def test_alternate_runtime_location_requires_same_hash(launcher, monkeypatch):
    module, _, runtime, calls = launcher
    alternate = runtime.parent / "alternate-server"
    alternate.write_bytes(runtime.read_bytes())
    monkeypatch.setattr("sys.argv", ["serve_model.py", "--runtime", str(alternate)])
    module.main()
    saved = json.loads((module.ROOT / ".data/runtime/launch.json").read_text())
    assert saved["runtime_platform"] == "Darwin/arm64"
    assert saved["runtime_commit"] == "a" * 40
    assert saved["runtime_sha256"] == hashlib.sha256(alternate.read_bytes()).hexdigest()
    calls.clear()
    alternate.write_bytes(b"unapproved binary")
    with pytest.raises(SystemExit) as caught:
        module.main()
    assert caught.value.code == 2
    assert not calls


@pytest.mark.parametrize("fault", [None, "library_changed", "library_missing", "server_changed"])
def test_linux_verifies_server_and_bundled_shared_libraries(launcher, monkeypatch, fault):
    module, _, runtime, calls = launcher
    monkeypatch.setattr(module.platform, "system", lambda: "Linux")
    monkeypatch.setattr(module.platform, "machine", lambda: "x86_64")
    library = runtime.parent / "libllama-server-impl.so"
    library.write_bytes(b"synthetic library")
    p = module.ROOT / "config/local-model.json"
    manifest = json.loads(p.read_text())
    manifest["runtime"]["linux_x64_cuda_12_8"] = {
        "files_sha256": {
            "llama-server": hashlib.sha256(runtime.read_bytes()).hexdigest(),
            library.name: hashlib.sha256(library.read_bytes()).hexdigest(),
        }
    }
    p.write_text(json.dumps(manifest))
    if fault == "library_changed":
        library.write_bytes(b"changed library")
    elif fault == "library_missing":
        library.unlink()
    elif fault == "server_changed":
        runtime.write_bytes(b"changed server")
    if fault:
        with pytest.raises(SystemExit) as caught:
            module.main()
        assert caught.value.code == 2
        assert not calls
        assert not (module.ROOT / ".data/runtime/inference.key").exists()
    else:
        module.main()
        assert len(calls) == 1
        saved = json.loads((module.ROOT / ".data/runtime/launch.json").read_text())
        assert saved["runtime_platform"] == "Linux/x86_64"


def test_unpinned_platform_refused(launcher, monkeypatch):
    module, _, _, calls = launcher
    monkeypatch.setattr(module.platform, "machine", lambda: "unsupported-test-platform")
    with pytest.raises(SystemExit) as caught:
        module.main()
    assert caught.value.code == 2
    assert not calls
