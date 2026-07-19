import type { Pose } from "../types/ar";
import type { ForearmGuide } from "./geometry";

type Point2 = { x: number; y: number };
type Color = { r: number; g: number; b: number };

export type PixelFrame = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type ArmBoundary = {
  center: Point2;
  width: number;
  negativeEdge: Point2;
  positiveEdge: Point2;
  axis: Point2;
  perpendicular: Point2;
  confidence: number;
};

const ANALYSIS_LONG_EDGE = 480;
const JEWELRY_CLEARANCE = 1.08;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const colorDistance = (a: Color, b: Color) => {
  const meanRed = (a.r + b.r) / 2;
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return Math.sqrt(
    ((512 + meanRed) * red * red) / 256
      + 4 * green * green
      + ((767 - meanRed) * blue * blue) / 256,
  );
};

const averageColors = (colors: Color[]): Color => {
  const count = Math.max(1, colors.length);
  return {
    r: colors.reduce((sum, color) => sum + color.r, 0) / count,
    g: colors.reduce((sum, color) => sum + color.g, 0) / count,
    b: colors.reduce((sum, color) => sum + color.b, 0) / count,
  };
};

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

function sampleColor(
  frame: PixelFrame,
  point: Point2,
  axis: Point2,
): Color | null {
  const colors: Color[] = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    const x = Math.round(point.x + axis.x * offset);
    const y = Math.round(point.y + axis.y * offset);
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
    const index = (y * frame.width + x) * 4;
    if (frame.data[index + 3] < 32) continue;
    colors.push({
      r: frame.data[index],
      g: frame.data[index + 1],
      b: frame.data[index + 2],
    });
  }
  return colors.length >= 3 ? averageColors(colors) : null;
}

type EdgeCandidate = { distance: number; confidence: number };

function findEdge(
  frame: PixelFrame,
  center: Point2,
  axis: Point2,
  perpendicular: Point2,
  direction: -1 | 1,
  expectedWidth: number,
): EdgeCandidate | null {
  const estimatedRadius = expectedWidth / 2;
  const minimumDistance = Math.max(5, Math.round(estimatedRadius * 0.48));
  const maximumDistance = Math.max(
    minimumDistance + 8,
    Math.round(expectedWidth * 1.18),
  );
  const window = Math.max(2, Math.round(expectedWidth * 0.025));
  const profile: Color[] = [];

  for (let distance = 0; distance <= maximumDistance + window; distance += 1) {
    const color = sampleColor(
      frame,
      {
        x: center.x + perpendicular.x * distance * direction,
        y: center.y + perpendicular.y * distance * direction,
      },
      axis,
    );
    if (!color) break;
    profile.push(color);
  }
  if (profile.length <= minimumDistance + window * 2) return null;

  const interiorEnd = Math.max(4, Math.floor(minimumDistance * 0.75));
  const interiorReference = averageColors(profile.slice(0, interiorEnd));
  const interiorNoise = median(
    profile
      .slice(1, interiorEnd)
      .map((color, index) => colorDistance(color, profile[index])),
  );
  const threshold = Math.max(18, interiorNoise * 4.5 + 8);
  let best: { distance: number; score: number; shift: number } | null = null;

  const upperBound = Math.min(maximumDistance, profile.length - window - 1);
  for (let distance = minimumDistance; distance <= upperBound; distance += 1) {
    const inside = averageColors(profile.slice(distance - window, distance));
    const outside = averageColors(profile.slice(distance + 1, distance + window + 1));
    const contrast = colorDistance(inside, outside);
    const outsideShift = colorDistance(interiorReference, outside);
    const score = contrast * 0.72 + outsideShift * 0.28;
    if (contrast < threshold || outsideShift < threshold * 0.72) continue;
    if (!best || score > best.score) best = { distance, score, shift: outsideShift };
  }
  if (!best) return null;

  const strength = Math.min(best.score, best.shift);
  return {
    distance: best.distance,
    confidence: clamp((strength - threshold) / 70 + 0.48, 0, 1),
  };
}

export function detectArmBoundary(
  frame: PixelFrame,
  center: Point2,
  axis: Point2,
  expectedWidth: number,
): ArmBoundary | null {
  if (!Number.isFinite(expectedWidth) || expectedWidth < 12) return null;
  const axisLength = Math.hypot(axis.x, axis.y);
  if (axisLength < 0.5) return null;
  const normalizedAxis = { x: axis.x / axisLength, y: axis.y / axisLength };
  const perpendicular = { x: -normalizedAxis.y, y: normalizedAxis.x };
  const negative = findEdge(
    frame,
    center,
    normalizedAxis,
    perpendicular,
    -1,
    expectedWidth,
  );
  const positive = findEdge(
    frame,
    center,
    normalizedAxis,
    perpendicular,
    1,
    expectedWidth,
  );
  if (!negative || !positive) return null;

  const width = negative.distance + positive.distance;
  const widthRatio = width / expectedWidth;
  const symmetry = Math.min(negative.distance, positive.distance)
    / Math.max(negative.distance, positive.distance);
  if (widthRatio < 0.72 || widthRatio > 2.4 || symmetry < 0.28) return null;

  const centerShift = (positive.distance - negative.distance) / 2;
  const refinedCenter = {
    x: center.x + perpendicular.x * centerShift,
    y: center.y + perpendicular.y * centerShift,
  };
  const negativeEdge = {
    x: refinedCenter.x - perpendicular.x * width / 2,
    y: refinedCenter.y - perpendicular.y * width / 2,
  };
  const positiveEdge = {
    x: refinedCenter.x + perpendicular.x * width / 2,
    y: refinedCenter.y + perpendicular.y * width / 2,
  };

  return {
    center: refinedCenter,
    width,
    negativeEdge,
    positiveEdge,
    axis: normalizedAxis,
    perpendicular,
    confidence: Math.min(negative.confidence, positive.confidence)
      * (0.6 + symmetry * 0.4),
  };
}

function rotateByQuaternion(
  vector: [number, number, number],
  quaternion: [number, number, number, number],
) {
  const [x, y, z] = vector;
  const [qx, qy, qz, qw] = quaternion;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function planeProjectionOnArmNormal(
  orientation: Pose["orientation"],
  perpendicular: Point2,
  modelPlaneSize: [number, number] = [1, 1],
) {
  const localX = rotateByQuaternion([1, 0, 0], orientation);
  const localY = rotateByQuaternion([0, 1, 0], orientation);
  const screenNormal = { x: perpendicular.x, y: -perpendicular.y };
  const xContribution = (localX[0] * screenNormal.x + localX[1] * screenNormal.y)
    * modelPlaneSize[0];
  const yContribution = (localY[0] * screenNormal.x + localY[1] * screenNormal.y)
    * modelPlaneSize[1];
  return Math.hypot(xContribution, yContribution);
}

export function applyArmBoundary(
  pose: Pose,
  boundary: ArmBoundary,
  sizeMultiplier = 1,
  modelPlaneSize: [number, number] = [1, 1],
): Pose {
  const targetSpan = boundary.width * JEWELRY_CLEARANCE;
  const planeProjection = Math.max(
    0.34,
    planeProjectionOnArmNormal(pose.orientation, boundary.perpendicular, modelPlaneSize),
  );
  return {
    ...pose,
    x: boundary.center.x,
    y: boundary.center.y,
    scale: targetSpan / (planeProjection * sizeMultiplier),
    armWidth: boundary.width,
    boundaryConfidence: boundary.confidence,
    targetSpan,
    planeProjection,
  };
}

function sourceDimensions(source: CanvasImageSource) {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if ("displayWidth" in source && "displayHeight" in source) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  if (
    "width" in source
    && "height" in source
    && typeof source.width === "number"
    && typeof source.height === "number"
  ) {
    return { width: source.width, height: source.height };
  }
  return { width: 0, height: 0 };
}

export class ArmBoundaryEstimator {
  private readonly canvas = document.createElement("canvas");
  private readonly context = this.canvas.getContext("2d", { willReadFrequently: true });

  estimate(
    source: CanvasImageSource,
    stageWidth: number,
    stageHeight: number,
    mirrored: boolean,
    guide: ForearmGuide,
    expectedWidth: number,
  ): ArmBoundary | null {
    if (!this.context || stageWidth < 1 || stageHeight < 1) return null;
    const sourceSize = sourceDimensions(source);
    if (sourceSize.width < 1 || sourceSize.height < 1) return null;
    const analysisScale = Math.min(
      1,
      ANALYSIS_LONG_EDGE / Math.max(stageWidth, stageHeight),
    );
    const width = Math.max(1, Math.round(stageWidth * analysisScale));
    const height = Math.max(1, Math.round(stageHeight * analysisScale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const coverScale = Math.max(width / sourceSize.width, height / sourceSize.height);
    const drawWidth = sourceSize.width * coverScale;
    const drawHeight = sourceSize.height * coverScale;
    const drawX = (width - drawWidth) / 2;
    const drawY = (height - drawHeight) / 2;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, width, height);
    if (mirrored) {
      this.context.translate(width, 0);
      this.context.scale(-1, 1);
    }
    this.context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    this.context.setTransform(1, 0, 0, 1, 0, 0);

    const frame = this.context.getImageData(0, 0, width, height);
    const searchWidth = Math.max(expectedWidth, guide.palmLength * 0.9);
    const boundary = detectArmBoundary(
      frame,
      {
        x: guide.anchor.x * analysisScale,
        y: guide.anchor.y * analysisScale,
      },
      guide.axis,
      searchWidth * analysisScale,
    );
    if (!boundary) return null;
    return {
      center: {
        x: boundary.center.x / analysisScale,
        y: boundary.center.y / analysisScale,
      },
      width: boundary.width / analysisScale,
      negativeEdge: {
        x: boundary.negativeEdge.x / analysisScale,
        y: boundary.negativeEdge.y / analysisScale,
      },
      positiveEdge: {
        x: boundary.positiveEdge.x / analysisScale,
        y: boundary.positiveEdge.y / analysisScale,
      },
      axis: boundary.axis,
      perpendicular: boundary.perpendicular,
      confidence: boundary.confidence,
    };
  }
}
