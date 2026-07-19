export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type Handedness = "Left" | "Right" | "Unknown";

export type HandFrame = {
  landmarks: Landmark[];
  worldLandmarks?: Landmark[];
  handedness: Handedness;
  score: number;
  timestamp: number;
};

export type FaceMode = "auto" | "front" | "back";

export type TrackingPhase =
  | "idle"
  | "loading"
  | "searching"
  | "tracking"
  | "lost"
  | "error";

export type TrackingStatus = {
  phase: TrackingPhase;
  message: string;
  fps?: number;
  facing?: "front" | "back";
};

export type Pose = {
  x: number;
  y: number;
  scale: number;
  scaleCorrection: number;
  armWidth?: number;
  boundaryConfidence?: number;
  targetSpan?: number;
  planeProjection?: number;
  orientation: [number, number, number, number];
  frontFacing: boolean;
  facingConfidence: number;
  confidence: number;
};

export type ViewportMapping = {
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  mirrored: boolean;
};

export type ProductCalibration = {
  baseRotation: [number, number, number];
  positionOffset: [number, number, number];
  sizeMultiplier: number;
  frontFlip: [number, number, number];
  modelOuterWidthMeters: number;
  modelPlaneSize: [number, number];
  frontAxis: "+z";
};

export type JewelryProduct = {
  id: string;
  name: string;
  subtitle: string;
  modelUrl: string;
  accent: string;
  metal: "silver" | "gold" | "mixed";
  anchor: "wrist" | "finger";
  finger?: "index" | "middle" | "ring" | "pinky";
  calibration: ProductCalibration;
};

export type UserCalibration = {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
};
