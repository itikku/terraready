import { useEffect, useRef, useState } from "react";
import { Expand, X } from "lucide-react";
import { getCamera } from "./api";
import type { CameraView, Observation } from "./types";

export default function CameraEvidence({
  zoneId,
  observation,
}: {
  zoneId: string;
  observation?: Observation;
}) {
  const [camera, setCamera] = useState<CameraView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [photo, setPhoto] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    getCamera(zoneId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setCamera(value);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [zoneId, attempt]);
  useEffect(() => {
    if (photo) dialog.current?.showModal();
    else dialog.current?.close();
  }, [photo]);
  const frame = camera?.status === "available" ? camera.snapshot : null;
  const stub = camera?.mode === "demo_stub" || loading;
  const image = frame
    ? `data:${frame.media_type};base64,${frame.image_base64}`
    : stub
      ? observation?.image_path
      : null;
  const title = frame ? "Camera snapshot" : "Synthetic inspection image";
  const close = () => {
    setPhoto(false);
    trigger.current?.focus();
  };
  return (
    <>
      <div className="evidence-picture">
        {image && !photoFailed ? (
          <button
            ref={trigger}
            aria-label={
              frame
                ? "Enlarge camera snapshot"
                : "Enlarge synthetic inspection image"
            }
            onClick={() => setPhoto(true)}
          >
            <img
              src={image}
              onError={() => setPhotoFailed(true)}
              alt={
                frame
                  ? `Camera snapshot from ${frame.camera_id}`
                  : "Synthetic illustration of a rutted, waterlogged construction access road"
              }
            />
            <span className="image-expand">
              <Expand size={14} />
            </span>
          </button>
        ) : (
          <div
            className="aerial-detail"
            style={{ backgroundImage: "url(/imagery/site-aerial.jpg)" }}
            role="img"
            aria-label="Historical aerial context, not a current ground inspection"
          />
        )}
        <span className="image-type">
          {image && !photoFailed
            ? frame
              ? "CAMERA SNAPSHOT · NOT LIVE VIDEO"
              : "SYNTHETIC INSPECTION"
            : "HISTORICAL AERIAL CONTEXT"}
        </span>
      </div>
      <div className="camera-source" role="group" aria-label="Camera source">
        {loading ? (
          <p role="status">Checking camera source…</p>
        ) : failed ||
          photoFailed ||
          (camera?.mode !== "demo_stub" && !frame) ? (
          <p>Camera snapshot unavailable. No live feed is shown.</p>
        ) : frame ? (
          <p>
            External snapshot · {frame.camera_id}
            <br />
            Captured{" "}
            {new Date(frame.captured_at).toLocaleString("en-US", {
              timeZone: "UTC",
            })}{" "}
            UTC, as reported by the adapter. No live video or automatic ground
            measurement.
          </p>
        ) : (
          <p>
            Demo camera stub · no camera connected. The inspection image is a
            fixed illustration.
          </p>
        )}
        <button
          className="secondary-button"
          onClick={() => {
            setLoading(true);
            setFailed(false);
            setPhotoFailed(false);
            setCamera(null);
            setAttempt(attempt + 1);
          }}
        >
          Refresh camera snapshot
        </button>
      </div>
      <dialog
        ref={dialog}
        className="photo-dialog"
        aria-label={title}
        onCancel={close}
        onClose={() => setPhoto(false)}
      >
        <button
          className="dialog-close"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
        <img
          src={image || ""}
          alt={
            frame
              ? "Enlarged camera snapshot"
              : "Enlarged synthetic inspection scene"
          }
        />
        <p>
          {frame
            ? `Camera ${frame.camera_id} · capture ${frame.snapshot_id} · ${frame.captured_at}. Source-reported capture; not a readiness measurement.`
            : observation?.image_caption}
        </p>
      </dialog>
    </>
  );
}
