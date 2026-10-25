# Camera images: explicit stub and bring-your-own snapshots

The default demo has **no connected camera, live picture feed or automatic image analysis**. Its north-road picture is a fixed AI-generated illustration. The UI labels the camera as a **demo stub**, and all operating measurements remain synthetic fixtures.

The extension point accepts **still snapshots**, not video streams. A supplied image is visual context only: it does not create a trusted soil observation, alter readiness, satisfy a prerequisite or authorize work. Snapshot capture time is reported by the adapter; TerraReady does not attest to its clock or authenticity. A newer image does not make old ground measurements fresh.

## Use a camera exporter without a vendor dependency

`FolderCameraProvider` reads a fixed file handoff from a directory you explicitly configure. Your camera software, RTSP/ONVIF bridge or vendor SDK owns acquisition and authentication. TerraReady does not discover devices or fetch a browser-supplied URL.

For the default site's north-access zone, the producer writes:

```text
<camera-root>/post-rain/north-access/snapshot.png
<camera-root>/post-rain/north-access/snapshot.json
```

The metadata file has exactly these fields (replace all example values with the actual capture):

```json
{
  "camera_id": "north-road-camera",
  "snapshot_id": "capture-001",
  "captured_at": "2026-10-25T15:00:00Z",
  "media_type": "image/png",
  "sha256": "<64 lowercase hexadecimal characters for the image bytes>"
}
```

Use `snapshot.jpg` with `image/jpeg` for JPEG. IDs contain lowercase letters, digits and hyphens, start with a letter, and are at most 64 characters. Capture time must include its timezone. Each image is at most **5 MiB**; metadata is at most **8 KiB**. PNG/JPEG signatures and SHA-256 must match; SVG, arbitrary file paths and device URLs are not accepted. Signature checks are not full image decoding or proof that the image came from hardware.

Publish the image first, then atomically replace `snapshot.json` with matching capture metadata/digest. An incomplete or mismatched pair displays **unavailable**, rather than presenting a new timestamp over an old image. Use a trusted directory dedicated to camera exports; the bridge rejects paths that resolve outside that configured root before opening them. This local file handoff is not an operating-system sandbox.

From a fresh, seeded checkout, explicitly opt into the bridge:

```sh
TERRAREADY_CAMERA_DIR=/absolute/path/to/camera-exports \
  .venv/bin/uvicorn scripts.camera_api:create --factory \
  --host 127.0.0.1 --port 8000
```

Stop your own existing API before reusing its port. Start the web interface normally with `make web`. Select the mapped zone and choose **Refresh camera snapshot**. A supplied image is labeled **Camera snapshot · not live video**, with camera ID and source-reported capture time. There is no background polling. An absent or failed camera shows an explicit unavailable state and historical aerial context, never a synthetic image disguised as a real capture.

Keep camera credentials inside your exporter or backend adapter's environment/secret facility. They do not belong in snapshot metadata, device IDs, browser code, image captions, Git or error messages. The supplied bridge needs only a directory, not camera credentials. Keep this unauthenticated POC on loopback; private camera images must not be served as a public demo. Snapshots are not written to LanceDB or assistant audit records by this interface.

## Implement another acquisition method

Implement the [CameraProvider protocol](../apps/api/src/terraready/camera.py) and inject it into the application factory:

```python
from terraready.main import create_app

# my_provider implements:
# latest_snapshot(scenario_id: str, zone_id: str) -> CameraSnapshot | None
app = create_app(camera_provider=my_provider)
```

Return a `CameraSnapshot` containing the metadata above and `data: bytes`. Return `None` when no snapshot exists. The adapter must impose finite device/network timeouts, bound reads, validate its configured camera-to-zone mapping and avoid logging secrets. Acquisition exceptions and invalid snapshots become a generic unavailable result; the API does not echo adapter exceptions. Custom adapters execute trusted backend code and are not a plugin sandbox.

The read-only browser contract is:

```text
GET /api/scenarios/{scenario_id}/zones/{zone_id}/camera
```

| Mode / status | Meaning |
| --- | --- |
| `demo_stub` / `stub` | Default provider; no camera connected, `snapshot: null` |
| `external_snapshot` / `available` | Bounded PNG/JPEG snapshot, including metadata and `image_base64` |
| `external_snapshot` / `unavailable` | No capture, invalid data or acquisition failure, `snapshot: null` |

Unknown sites/zones return `404` before calling the adapter. Responses use `Cache-Control: no-store`. The image bytes and metadata travel in one response so a refresh cannot combine metadata from one capture with another image. No endpoint accepts uploads, arbitrary camera URLs or credentials. Existing ground observations, planning fingerprints and human approval remain separate.

## What has been verified

Automated tests exercise provider injection, the folder handoff, PNG/JPEG handling, missing captures, digest/size/type/time/ID errors, path escapes, generic error handling and unchanged site/recovery state. Browser tests exercise the visible stub, supplied capture/provenance, unavailable/retry/loading behavior and zone changes. The full suite passed **296 backend tests and 49 browser tests**, with backend API statement/branch coverage **99.40%**. A separate check exercised the actual folder factory → API → browser path with a synthetic image, then removed the test metadata and verified unavailable status and unchanged recovery state. These use synthetic images and adapters, not physical camera hardware.

Actual device drivers, authentication, stream reliability, clock synchronization, retention/access control and any path from images to validated operational measurements remain integration work for the camera owner. The earlier GPU test predates this extension and does not establish camera-hardware support.

[Snapshot-adapter browser QA capture](images/camera-adapter-mobile.png) uses the same synthetic inspection illustration supplied through a test adapter. It demonstrates the contract and labeling, not a real camera.
