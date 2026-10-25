"""Optional image snapshots; never ground observations or model/approval authority."""

from base64 import b64encode
from hashlib import sha256
from typing import Literal, Protocol, Self

from pydantic import AwareDatetime, Field, model_validator

from terraready.models import Identifier, Model, PlanId

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MediaType = Literal["image/jpeg", "image/png"]


class SnapshotMetadata(Model):
    camera_id: Identifier
    snapshot_id: Identifier
    captured_at: AwareDatetime
    media_type: MediaType
    sha256: PlanId


class CameraSnapshot(SnapshotMetadata):
    data: bytes = Field(min_length=1, max_length=MAX_IMAGE_BYTES, repr=False)

    @model_validator(mode="after")
    def verified_image(self) -> Self:
        signature = b"\x89PNG\r\n\x1a\n" if self.media_type == "image/png" else b"\xff\xd8\xff"
        if not self.data.startswith(signature) or sha256(self.data).hexdigest() != self.sha256:
            raise ValueError("Image signature or digest mismatch")
        return self


class CameraProvider(Protocol):
    """Implementers own camera authentication, bounded I/O and acquisition.

    Return the latest immutable snapshot for this mapping, or None when absent.
    No browser-supplied device URLs, credentials or readiness measurements.
    """

    def latest_snapshot(self, scenario_id: str, zone_id: str) -> CameraSnapshot | None: ...


class DemoCameraProvider:
    def latest_snapshot(self, scenario_id: str, zone_id: str) -> CameraSnapshot | None:
        return None


class CameraImage(SnapshotMetadata):
    image_base64: str


class CameraView(Model):
    mode: Literal["demo_stub", "external_snapshot"]
    status: Literal["stub", "available", "unavailable"]
    snapshot: CameraImage | None = None

    @model_validator(mode="after")
    def consistent_status(self) -> Self:
        if self.mode == "demo_stub":
            if self.status != "stub" or self.snapshot is not None:
                raise ValueError("A demo stub cannot claim a camera capture")
        elif self.status == "stub" or (self.status == "available") != (self.snapshot is not None):
            raise ValueError("Camera status and capture disagree")
        return self


def camera_view(provider: CameraProvider, scenario_id: str, zone_id: str) -> CameraView:
    if isinstance(provider, DemoCameraProvider):
        return CameraView(mode="demo_stub", status="stub")
    try:
        frame = provider.latest_snapshot(scenario_id, zone_id)
        if frame is not None:
            # Revalidate the adapter boundary, including objects built without validation.
            frame = CameraSnapshot.model_validate(frame.model_dump())
            return CameraView(
                mode="external_snapshot",
                status="available",
                snapshot=CameraImage(
                    **frame.model_dump(exclude={"data"}),
                    image_base64=b64encode(frame.data).decode("ascii"),
                ),
            )
    except Exception:
        # Device exceptions can contain credential-bearing URLs; never echo/log them.
        pass
    return CameraView(mode="external_snapshot", status="unavailable")
