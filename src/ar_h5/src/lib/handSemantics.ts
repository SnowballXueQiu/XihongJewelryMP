import type { Handedness } from "../types/ar";

export function unmirroredMediaPipeHandedness(label: string | undefined): Handedness {
  if (label === "Left") return "Right";
  if (label === "Right") return "Left";
  return "Unknown";
}
