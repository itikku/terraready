import hashlib
import importlib.util
import json
import subprocess
import tarfile
from pathlib import Path

import pytest


@pytest.fixture
def bundle_repo(tmp_path):
    spec = importlib.util.spec_from_file_location(
        "bundle_source_test", Path(__file__).resolve().parents[2] / "scripts/bundle_source.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = tmp_path / "source"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    module.git(root, "config", "user.email", "synthetic@example.invalid")
    module.git(root, "config", "user.name", "Synthetic test")
    (root / "package.json").write_text('{"name":"synthetic"}\n')
    (root / ".gitignore").write_text(".data/\n.env.local\n")
    module.git(root, "add", ".")
    module.git(root, "commit", "-qm", "Synthetic source")
    return module, root, tmp_path


def test_bundle_reproducible_provenance_and_exclusions_without_reading_ignored_files(bundle_repo):
    module, root, tmp = bundle_repo
    # Even committed forbidden files must not appear in the bundle.
    forbidden = [
        ".env.production",
        "apps/web/dist/index.html",
        "apps/web/src/.env.local",
        "config/inference.key",
        "docs/private.txt",
        "node_modules/package.json",
    ]
    for name in forbidden:
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("SYNTHETIC EXCLUDED BYTES")
    module.git(root, "add", ".")
    module.git(root, "commit", "-qm", "Synthetic exclusion cases")
    ignored = [root / ".env.local", root / ".data/lancedb/table"]
    for p in ignored:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("SYNTHETIC IGNORED BYTES")
        p.chmod(0)
    try:
        first = tmp / "first.tar.gz"
        manifest = module.build_bundle(root, first)
        second = tmp / "second.tar.gz"
        module.build_bundle(root, second)
        assert first.read_bytes() == second.read_bytes()
        assert manifest["commit"] == module.git(root, "rev-parse", "HEAD").decode().strip()
        assert manifest["tree"] == module.git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        with tarfile.open(first) as archive:
            assert archive.getnames() == ["package.json", "BUNDLE_MANIFEST.json"]
            saved = json.load(archive.extractfile("BUNDLE_MANIFEST.json"))
            assert saved == manifest
            for record in saved["files"]:
                content = archive.extractfile(record["path"]).read()
                assert len(content) == record["bytes"]
                assert hashlib.sha256(content).hexdigest() == record["sha256"]
                assert module.git(root, "cat-file", "blob", record["git_blob"]) == content
        with pytest.raises(FileExistsError):
            module.build_bundle(root, first)
    finally:
        for p in ignored:
            p.chmod(0o600)


@pytest.mark.parametrize("change", ["modified", "staged", "untracked"])
def test_dirty_checkout_refused_before_reading_blobs(bundle_repo, monkeypatch, change):
    module, root, tmp = bundle_repo
    p = root / ("untracked.txt" if change == "untracked" else "package.json")
    p.write_text("synthetic change")
    if change == "staged":
        module.git(root, "add", ".")
    original = module.git

    def guard(root, *args):
        assert "cat-file" not in args
        return original(root, *args)

    monkeypatch.setattr(module, "git", guard)
    with pytest.raises(ValueError, match="dirty"):
        module.build_bundle(root, tmp / "refused.tar.gz")
    assert not (tmp / "refused.tar.gz").exists()


def test_committed_selected_symlink_refused_without_opening_target(bundle_repo):
    module, root, tmp = bundle_repo
    p = root / "scripts/linked.py"
    p.parent.mkdir()
    p.symlink_to("/nonexistent/sensitive-file")
    module.git(root, "add", ".")
    module.git(root, "commit", "-qm", "Synthetic symlink")
    with pytest.raises(ValueError, match="symlink"):
        module.build_bundle(root, tmp / "refused.tar.gz")
    assert not (tmp / "refused.tar.gz").exists()


def test_approved_source_assets_and_unknown_extensions(bundle_repo):
    module, _, _ = bundle_repo
    for name in [
        "apps/api/src/terraready/main.py",
        "apps/web/src/map/OfflineSiteMap.tsx",
        "apps/web/public/imagery/site-aerial.jpg",
        "tests/e2e/__screenshots__/workspace.spec.ts/site-workspace.png",
        "scripts/bundle_source.py",
        "uv.lock",
    ]:
        assert module.allowed(name)
    for name in ["apps/web/src/private.key", "scripts/.env.py", "apps/web/src/dist/cached.ts"]:
        assert not module.allowed(name)
