import type { FaceMode } from "../types/ar";

export function shouldFlipModel(faceMode: FaceMode) {
  return faceMode !== "back";
}

export function nextManualFaceMode(faceMode: FaceMode): FaceMode {
  return faceMode === "back" ? "front" : "back";
}
