import type { FaceMode } from "../types/ar";

export function shouldFlipModel(faceMode: FaceMode) {
  return faceMode === "back";
}
