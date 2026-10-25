import base64
import hashlib
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient
from terraready.camera import MAX_IMAGE_BYTES, CameraSnapshot, CameraView, camera_view
from terraready.camera_folder import FolderCameraProvider
from terraready.main import create_app
from terraready.storage import SiteStore

# Public synthetic illustration; no real camera/customer content.
IMAGE = Path(__file__).resolve().parents[2] / "apps/web/public/imagery/north-inspection.png"


def frame():
    data = IMAGE.read_bytes()
    return CameraSnapshot(
        camera_id="north-demo-test",
        snapshot_id="capture-1",
        captured_at=datetime(2026, 10, 25, tzinfo=UTC),
        media_type="image/png",
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
    )


class Provider:
    def __init__(self, result=None, error=False):
        self.result = result
        self.error = error
        self.calls = []

    def latest_snapshot(self, scenario_id, zone_id):
        self.calls.append((scenario_id, zone_id))
        if self.error:
            raise RuntimeError("synthetic-password-in-device-url")
        return self.result


def test_default_stub_and_external_frame_do_not_mutate_operating_snapshot(tmp_path, docket):
    db = tmp_path / "db"
    SiteStore(db).seed(docket)
    with TestClient(create_app(db)) as client:
        before = client.get("/api/scenarios/post-rain").json()
        recovery = client.get("/api/scenarios/post-rain/recovery").json()
        body = client.get("/api/scenarios/post-rain/zones/north-access/camera").json()
        assert body == {"mode": "demo_stub", "status": "stub", "snapshot": None}
    provider = Provider(frame())
    with TestClient(create_app(db, camera_provider=provider)) as client:
        response = client.get("/api/scenarios/post-rain/zones/north-access/camera")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert body["mode"] == "external_snapshot" and body["status"] == "available"
        assert body["snapshot"]["camera_id"] == "north-demo-test"
        assert base64.b64decode(body["snapshot"]["image_base64"]) == frame().data
        assert client.get("/api/scenarios/post-rain").json() == before
        assert client.get("/api/scenarios/post-rain/recovery").json() == recovery
    assert provider.calls == [("post-rain", "north-access")]


@pytest.mark.parametrize(
    "provider", [Provider(), Provider(error=True), Provider({"invalid": True})]
)
def test_missing_error_invalid_provider_is_unavailable_without_sensitive_details(provider):
    result = camera_view(provider, "post-rain", "north-access")
    assert result.model_dump() == {
        "mode": "external_snapshot",
        "status": "unavailable",
        "snapshot": None,
    }
    assert "password" not in result.model_dump_json()


@pytest.mark.parametrize(
    "path", ["/other/zones/north-access/camera", "/post-rain/zones/unknown/camera"]
)
def test_unknown_mapping_never_calls_provider(tmp_path, docket, path):
    db = tmp_path / "db"
    SiteStore(db).seed(docket)
    provider = Provider(frame())
    with TestClient(create_app(db, camera_provider=provider)) as client:
        assert client.get("/api/scenarios" + path).status_code == 404
    assert not provider.calls


@pytest.mark.parametrize(
    "fault", ["naive_time", "mime", "digest", "signature", "oversize", "id", "extra"]
)
def test_invalid_capture_rejected(fault):
    body = frame().model_dump()
    if fault == "naive_time":
        body["captured_at"] = "2026-10-25T00:00:00"
    elif fault == "mime":
        body["media_type"] = "image/svg+xml"
    elif fault == "digest":
        body["sha256"] = "0" * 64
    elif fault == "signature":
        body["data"] = b"<html>not an image</html>"
        body["sha256"] = hashlib.sha256(body["data"]).hexdigest()
    elif fault == "oversize":
        body["data"] = b"x" * (MAX_IMAGE_BYTES + 1)
    elif fault == "id":
        body["camera_id"] = "rtsp://credentials@host"
    else:
        body["device_url"] = "not-public"
    with pytest.raises(ValidationError):
        CameraSnapshot.model_validate(body)


def publish(root):
    directory = root / "post-rain/north-access"
    directory.mkdir(parents=True)
    captured = frame()
    (directory / "snapshot.json").write_text(captured.model_dump_json(exclude={"data"}))
    (directory / "snapshot.png").write_bytes(captured.data)
    return directory


def test_folder_handoff_and_absent_mapping(tmp_path):
    provider = FolderCameraProvider(tmp_path)
    assert provider.latest_snapshot("post-rain", "north-access") is None
    publish(tmp_path)
    assert provider.latest_snapshot("post-rain", "north-access") == frame()
    assert provider.latest_snapshot("post-rain", "west-stockpile") is None


@pytest.mark.parametrize(
    "fault",
    [
        "mismatch",
        "metadata_size",
        "escape",
        "image_escape",
        "traversal",
        "broken_json",
        "jpeg",
        "image_directory",
    ],
)
def test_folder_boundary_and_partial_publication_fail_safely(tmp_path, fault):
    root = tmp_path / "frames"
    directory = publish(root)
    provider = FolderCameraProvider(root)
    if fault == "mismatch":
        (directory / "snapshot.png").write_bytes(b"partial image")
    elif fault == "metadata_size":
        (directory / "snapshot.json").write_bytes(b" " * 8193)
    elif fault in {"escape", "image_escape"}:
        target = directory / ("snapshot.json" if fault == "escape" else "snapshot.png")
        target.unlink()
        target.symlink_to(tmp_path / "outside-never-opened")
    elif fault == "traversal":
        with pytest.raises(ValidationError):
            provider.latest_snapshot("../outside", "north-access")
        return
    elif fault == "image_directory":
        (directory / "snapshot.png").unlink()
        (directory / "snapshot.png").mkdir()
    elif fault == "broken_json":
        (directory / "snapshot.json").write_text("{")
    else:
        # JPEG transport branch, still synthetic bytes and not a hardware claim.
        content = b"\xff\xd8\xffsynthetic-jpeg-test"
        capture = frame().model_dump(exclude={"data"})
        capture.update(media_type="image/jpeg", sha256=hashlib.sha256(content).hexdigest())
        capture["captured_at"] = capture["captured_at"].isoformat()
        (directory / "snapshot.json").write_text(json.dumps(capture))
        (directory / "snapshot.jpg").write_bytes(content)
        assert provider.latest_snapshot("post-rain", "north-access").data == content
        return
    assert camera_view(provider, "post-rain", "north-access").status == "unavailable"


def test_opt_in_factory_requires_explicit_directory(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "camera_factory_test", Path(__file__).resolve().parents[2] / "scripts/camera_api.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    create = module.create

    monkeypatch.delenv("TERRAREADY_CAMERA_DIR", raising=False)
    with pytest.raises(ValueError, match="Set TERRAREADY_CAMERA_DIR"):
        create()
    monkeypatch.setenv("TERRAREADY_CAMERA_DIR", str(tmp_path))
    assert create().title == "TerraReady"


@pytest.mark.parametrize(
    "mode,status",
    [("demo_stub", "available"), ("external_snapshot", "stub"), ("external_snapshot", "available")],
)
def test_capture_status_cannot_claim_a_missing_frame(mode, status):
    with pytest.raises(ValidationError):
        CameraView(mode=mode, status=status)


@pytest.mark.parametrize(
    "mode,status", [("demo_stub", "stub"), ("external_snapshot", "unavailable")]
)
def test_stub_or_unavailable_cannot_include_a_capture(mode, status):
    capture = camera_view(Provider(frame()), "post-rain", "north-access").snapshot
    with pytest.raises(ValidationError):
        CameraView(mode=mode, status=status, snapshot=capture)
