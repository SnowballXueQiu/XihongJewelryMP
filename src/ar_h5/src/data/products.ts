import type { JewelryProduct, UserCalibration } from "../types/ar";

export const PRODUCTS: JewelryProduct[] = [
  {
    id: "bracelet-1",
    name: "链节手链",
    subtitle: "金色",
    modelUrl: "/models/bracelet-1.glb",
    accent: "#d2a52e",
    metal: "gold",
    anchor: "wrist",
    calibration: {
      baseRotation: [0, 0, 0],
      positionOffset: [0, 0, 0],
      sizeMultiplier: 0.98,
      frontFlip: [Math.PI, 0, 0],
      modelOuterWidthMeters: 0.103104,
      modelPlaneSize: [1, 0.996],
      frontAxis: "+z",
    },
  },
  {
    id: "bracelet-2",
    name: "开口手镯",
    subtitle: "金色",
    modelUrl: "/models/bracelet-2.glb",
    accent: "#d2a52e",
    metal: "gold",
    anchor: "wrist",
    calibration: {
      baseRotation: [0, 0, 0],
      positionOffset: [0, 0, 0],
      sizeMultiplier: 1.02,
      frontFlip: [Math.PI, 0, 0],
      modelOuterWidthMeters: 0.101196,
      modelPlaneSize: [1, 0.774],
      frontAxis: "+z",
    },
  },
];

export const DEFAULT_USER_CALIBRATION: UserCalibration = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};
