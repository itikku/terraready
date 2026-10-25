"""File handoff for a separately managed camera exporter. No camera/network client."""

import json
from pathlib import Path

from terraready.camera import MAX_IMAGE_BYTES, CameraSnapshot, SnapshotMetadata
from terraready.models import Identifier, Model


class CameraMapping(Model):
    scenario_id: Identifier
    zone_id: Identifier


class FolderCameraProvider:
    """Read snapshot.json and snapshot.png/jpg under root/scenario/zone.

    A producer publishes the image then its digest-bearing metadata. Partial or
    mismatched writes fail unavailable; existing ground observations are untouched.
    """

    def __init__(self, root: Path):
        self.root = root.resolve()

    def _read(self, path: Path, limit: int) -> bytes:
        # Reject symlink escapes before opening, including symlinked parent directories.
        if not path.resolve().is_relative_to(self.root):
            raise ValueError("Snapshot path outside configured root")
        if not path.is_file():
            raise ValueError("Snapshot must be a regular file")
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Snapshot file too large")
        return data

    def latest_snapshot(self, scenario_id: str, zone_id: str) -> CameraSnapshot | None:
        mapping = CameraMapping(scenario_id=scenario_id, zone_id=zone_id)
        directory = self.root / mapping.scenario_id / mapping.zone_id
        metadata_path = directory / "snapshot.json"
        if not metadata_path.exists():
            return None
        metadata = SnapshotMetadata.model_validate(json.loads(self._read(metadata_path, 8192)))
        suffix = "png" if metadata.media_type == "image/png" else "jpg"
        data = self._read(directory / f"snapshot.{suffix}", MAX_IMAGE_BYTES)
        return CameraSnapshot(**metadata.model_dump(), data=data)
