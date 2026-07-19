import { Focus, LoaderCircle, ScanLine, TriangleAlert } from "lucide-react";
import type { TrackingStatus } from "../types/ar";

type Props = {
  status: TrackingStatus;
  faceMode: "auto" | "front" | "back";
};

export function StatusIndicator({ status, faceMode }: Props) {
  const Icon =
    status.phase === "tracking"
      ? ScanLine
      : status.phase === "loading"
        ? LoaderCircle
        : status.phase === "error"
          ? TriangleAlert
          : Focus;

  return (
    <div className={`tracking-status tracking-status--${status.phase}`} role="status" aria-live="polite">
      <Icon size={16} strokeWidth={2} className={status.phase === "loading" ? "is-spinning" : undefined} />
      <span>{status.message}</span>
      {status.phase === "tracking" && faceMode === "auto" && status.facing ? (
        <span className="tracking-status__side">{status.facing === "front" ? "手心" : "手背"}</span>
      ) : null}
    </div>
  );
}
