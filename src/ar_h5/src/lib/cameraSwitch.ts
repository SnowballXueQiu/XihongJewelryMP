import type { XR8CameraDirection } from "../types/eighthWall";

type FailedCameraSwitch = {
  active: boolean;
  currentEpoch: number;
  switchEpoch: number;
  currentDirection: XR8CameraDirection;
  failedDirection: XR8CameraDirection;
};

export function shouldRollbackFailedCameraSwitch({
  active,
  currentEpoch,
  switchEpoch,
  currentDirection,
  failedDirection,
}: FailedCameraSwitch) {
  if (active) return currentEpoch === switchEpoch;
  return currentDirection === failedDirection;
}
