"""Build a deterministic source-only archive from a clean committed checkout.

No working-tree file contents, credentials, databases or built assets are read.
Usage: python scripts/bundle_source.py /absolute/path/to/source.tar.gz
"""

import argparse
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
FILES = frozenset(
    {
        "ATTRIBUTIONS.md",
        "LICENSE",
        "deploy/Dockerfile",
        "Makefile",
        "pyproject.toml",
        "uv.lock",
        "package.json",
        "package-lock.json",
        "eslint.config.js",
        "playwright.config.ts",
        "apps/web/index.html",
        "apps/web/tsconfig.json",
        "apps/web/vite.config.ts",
        "apps/controller/package.json",
        "apps/controller/tsconfig.json",
        "apps/controller/README.md",
        "apps/web/public/imagery/site-aerial.jpg",
        "apps/web/public/imagery/north-inspection.png",
        "apps/web/public/imagery/source.json",
        "apps/web/public/licenses/DM-Sans-OFL.txt",
        "apps/web/public/licenses/IBM-Plex-Mono-OFL.txt",
        "config/local-model.json",
        "data/fixtures/post-rain.json",
        "data/fixtures/shift-docket.json",
        "docs/verification/local-agent.json",
        "docs/verification/gpu-agent.json",
    }
)
SOURCE_RULES = (
    ("apps/api/src/terraready/", {".py"}),
    ("apps/web/src/", {".ts", ".tsx", ".css"}),
    ("apps/controller/src/", {".ts"}),
    ("apps/controller/tests/", {".mjs"}),
    ("scripts/", {".py"}),
    ("tests/api/", {".py"}),
    ("tests/e2e/", {".ts", ".png"}),
)


def allowed(name: str) -> bool:
    path = PurePosixPath(name)
    if any(
        part.startswith(".") or part in {"dist", "node_modules", "__pycache__"}
        for part in path.parts
    ):
        return False
    return name in FILES or any(
        name.startswith(prefix) and path.suffix in suffixes for prefix, suffixes in SOURCE_RULES
    )


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)


def require_clean(root: Path) -> None:
    # Status inspects metadata only. Ignored files are neither opened nor archived.
    if git(root, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"):
        raise ValueError("Refusing dirty checkout; commit implementation and use a clean checkout.")


def build_bundle(root: Path, output: Path) -> dict[str, object]:
    require_clean(root)
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    tree = git(root, "rev-parse", f"{commit}^{{tree}}").decode().strip()
    entries = []
    for item in git(root, "ls-tree", "-r", "-z", commit).split(b"\0"):
        if not item:
            continue
        metadata, raw_name = item.split(b"\t", 1)
        name = raw_name.decode("utf-8")
        if allowed(name):
            mode, kind, blob = metadata.decode().split()
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise ValueError("Refusing selected symlink or non-regular source entry.")
            entries.append((name, mode, blob))
    if not entries:
        raise ValueError("No allowlisted source files in this commit.")

    records = []
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name, mode, blob in sorted(entries):
            contents = git(root, "cat-file", "blob", blob)
            info = tarfile.TarInfo(name)
            info.size = len(contents)
            info.mode = int(mode, 8) & 0o777
            tar.addfile(info, io.BytesIO(contents))
            records.append(
                {
                    "path": name,
                    "git_blob": blob,
                    "mode": mode,
                    "bytes": len(contents),
                    "sha256": hashlib.sha256(contents).hexdigest(),
                }
            )
        manifest: dict[str, object] = {
            "format": "terraready-source-v1",
            "commit": commit,
            "tree": tree,
            "files": records,
            "scope": "Source only; no Linux/CUDA execution or network-isolation claim.",
        }
        contents = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
        info = tarfile.TarInfo("BUNDLE_MANIFEST.json")
        info.mode = 0o644
        info.size = len(contents)
        tar.addfile(info, io.BytesIO(contents))

    require_clean(root)
    if git(root, "rev-parse", "HEAD").decode().strip() != commit:
        raise ValueError("HEAD changed during packaging; no archive written.")
    # Exclusive creation prevents accidentally overwriting another artifact.
    with (
        output.open("xb") as target,
        gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0) as compressed,
    ):
        compressed.write(archive.getvalue())
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        manifest = build_bundle(ROOT, args.output)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(2, f"Bundle refused: {error}\n")
    print(f"Source bundle created from {manifest['commit']}; no upload performed.")


if __name__ == "__main__":
    main()
