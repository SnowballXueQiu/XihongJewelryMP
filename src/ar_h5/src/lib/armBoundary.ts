import type { Pose } from "../types/ar";
import type { ForearmGuide } from "./geometry";

type Point2 = { x: number; y: number };
type Color = { r: number; g: number; b: number };

export type PixelFrame = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type ConfidenceMask = {
  data: Float32Array;
  width: number;
  height: number;
};

export type ArmAnalysisFrame = {
  source: HTMLCanvasElement;
  pixels: PixelFrame;
  analysisScale: number;
};

export type ArmBoundaryDiagnostics = {
  maskSize: [number, number] | null;
  wristConfidence: number | null;
  centerConfidence: number | null;
  initialAxis: Point2;
  refinedAxis: Point2;
  expectedWidth: number;
  negativeProfile: number[];
  positiveProfile: number[];
};

export type ArmBoundary = {
  center: Point2;
  width: number;
  negativeEdge: Point2;
  positiveEdge: Point2;
  axis: Point2;
  perpendicular: Point2;
  confidence: number;
  source: "segmentation" | "hybrid" | "color";
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

function findColorEdge(
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

function bilinearMaskSample(mask: ConfidenceMask, x: number, y: number) {
  const clampedX = clamp(x, 0, mask.width - 1);
  const clampedY = clamp(y, 0, mask.height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(mask.width - 1, x0 + 1);
  const y1 = Math.min(mask.height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const top = mask.data[y0 * mask.width + x0] * (1 - tx)
    + mask.data[y0 * mask.width + x1] * tx;
  const bottom = mask.data[y1 * mask.width + x0] * (1 - tx)
    + mask.data[y1 * mask.width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function sampleConfidence(
  mask: ConfidenceMask,
  frame: PixelFrame,
  point: Point2,
  axis: Point2,
) {
  let total = 0;
  let count = 0;
  for (let offset = -2; offset <= 2; offset += 1) {
    const x = point.x + axis.x * offset;
    const y = point.y + axis.y * offset;
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
    total += bilinearMaskSample(
      mask,
      (x / Math.max(1, frame.width - 1)) * (mask.width - 1),
      (y / Math.max(1, frame.height - 1)) * (mask.height - 1),
    );
    count += 1;
  }
  return count > 0 ? total / count : null;
}

function averageNumbers(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findMaskEdge(
  mask: ConfidenceMask,
  frame: PixelFrame,
  center: Point2,
  axis: Point2,
  perpendicular: Point2,
  direction: -1 | 1,
  expectedWidth: number,
): EdgeCandidate | null {
  const estimatedRadius = expectedWidth / 2;
  const minimumDistance = Math.max(5, Math.round(estimatedRadius * 0.42));
  const maximumDistance = Math.max(
    minimumDistance + 8,
    Math.round(expectedWidth * 1.18),
  );
  const window = Math.max(2, Math.round(expectedWidth * 0.025));
  const profile: number[] = [];

  for (let distance = 0; distance <= maximumDistance + window; distance += 1) {
    const confidence = sampleConfidence(
      mask,
      frame,
      {
        x: center.x + perpendicular.x * distance * direction,
        y: center.y + perpendicular.y * distance * direction,
      },
      axis,
    );
    if (confidence === null) break;
    profile.push(confidence);
  }
  if (profile.length <= minimumDistance + window * 2) return null;

  const interiorEnd = Math.max(4, Math.floor(minimumDistance * 0.72));
  const interior = median(profile.slice(0, interiorEnd));
  if (interior < 0.06) return null;
  const noise = median(
    profile
      .slice(1, interiorEnd)
      .map((value, index) => Math.abs(value - profile[index])),
  );
  const minimumDrop = Math.max(0.025, noise * 3.5 + 0.012);
  let best: { distance: number; score: number; drop: number; outside: number } | null = null;
  const upperBound = Math.min(maximumDistance, profile.length - window - 1);

  for (let distance = minimumDistance; distance <= upperBound; distance += 1) {
    const inside = averageNumbers(profile.slice(distance - window, distance));
    const outside = averageNumbers(profile.slice(distance + 1, distance + window + 1));
    const drop = inside - outside;
    const departure = interior - outside;
    if (drop < minimumDrop || departure < minimumDrop * 1.25) continue;
    if (outside > Math.max(0.62, interior * 0.86)) continue;
    const score = drop * 0.72 + departure * 0.28;
    if (!best || score > best.score) best = { distance, score, drop, outside };
  }
  if (!best) return null;

  const signal = Math.min(best.score, interior - best.outside);
  const interiorFactor = clamp(interior / 0.24, 0.5, 1);
  return {
    distance: best.distance,
    confidence: clamp((signal - minimumDrop) / 0.28 + 0.52, 0, 1) * interiorFactor,
  };
}

function buildBoundary(
  center: Point2,
  axis: Point2,
  perpendicular: Point2,
  expectedWidth: number,
  negative: EdgeCandidate,
  positive: EdgeCandidate,
  source: ArmBoundary["source"],
): ArmBoundary | null {
  const width = negative.distance + positive.distance;
  const widthRatio = width / expectedWidth;
  const symmetry = Math.min(negative.distance, positive.distance)
    / Math.max(negative.distance, positive.distance);
  if (widthRatio < 0.68 || widthRatio > 2.4 || symmetry < 0.26) return null;

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

  const sourceFactor = source === "segmentation" ? 1 : source === "hybrid" ? 0.82 : 0.72;
  return {
    center: refinedCenter,
    width,
    negativeEdge,
    positiveEdge,
    axis,
    perpendicular,
    confidence: Math.min(negative.confidence, positive.confidence)
      * (0.6 + symmetry * 0.4)
      * sourceFactor,
    source,
  };
}

export function detectArmBoundary(
  frame: PixelFrame,
  center: Point2,
  axis: Point2,
  expectedWidth: number,
  skinMask?: ConfidenceMask | null,
): ArmBoundary | null {
  if (!Number.isFinite(expectedWidth) || expectedWidth < 12) return null;
  const axisLength = Math.hypot(axis.x, axis.y);
  if (axisLength < 0.5) return null;
  const normalizedAxis = { x: axis.x / axisLength, y: axis.y / axisLength };
  const perpendicular = { x: -normalizedAxis.y, y: normalizedAxis.x };
  const maskNegative = skinMask
    ? findMaskEdge(skinMask, frame, center, normalizedAxis, perpendicular, -1, expectedWidth)
    : null;
  const maskPositive = skinMask
    ? findMaskEdge(skinMask, frame, center, normalizedAxis, perpendicular, 1, expectedWidth)
    : null;
  if (maskNegative && maskPositive) {
    return buildBoundary(
      center,
      normalizedAxis,
      perpendicular,
      expectedWidth,
      maskNegative,
      maskPositive,
      "segmentation",
    );
  }

  const colorNegative = findColorEdge(
    frame,
    center,
    normalizedAxis,
    perpendicular,
    -1,
    expectedWidth,
  );
  const colorPositive = findColorEdge(
    frame,
    center,
    normalizedAxis,
    perpendicular,
    1,
    expectedWidth,
  );
  const negative = maskNegative ?? colorNegative;
  const positive = maskPositive ?? colorPositive;
  if (!negative || !positive) return null;
  return buildBoundary(
    center,
    normalizedAxis,
    perpendicular,
    expectedWidth,
    negative,
    positive,
    maskNegative || maskPositive ? "hybrid" : "color",
  );
}

function rotatePoint(point: Point2, angle: number): Point2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function refineForearmAxis(
  skinMask: ConfidenceMask,
  frame: PixelFrame,
  wrist: Point2,
  initialAxis: Point2,
  palmLength: number,
  expectedWidth: number,
) {
  const initialLength = Math.hypot(initialAxis.x, initialAxis.y);
  if (initialLength < 0.5 || palmLength < 8 || expectedWidth < 12) return initialAxis;
  const normalizedInitial = {
    x: initialAxis.x / initialLength,
    y: initialAxis.y / initialLength,
  };
  let best: { axis: Point2; score: number } | null = null;
  const maximumAngle = (55 * Math.PI) / 180;
  const angleStep = (5 * Math.PI) / 180;
  const sectionOffsets = [0.12, 0.34, 0.56];

  for (let angle = -maximumAngle; angle <= maximumAngle + 0.0001; angle += angleStep) {
    const axis = rotatePoint(normalizedInitial, angle);
    const perpendicular = { x: -axis.y, y: axis.x };
    const widths: number[] = [];
    const shifts: number[] = [];
    const confidences: number[] = [];
    const centerConfidences: number[] = [];

    for (const offset of sectionOffsets) {
      const center = {
        x: wrist.x + axis.x * palmLength * offset,
        y: wrist.y + axis.y * palmLength * offset,
      };
      const negative = findMaskEdge(
        skinMask,
        frame,
        center,
        axis,
        perpendicular,
        -1,
        expectedWidth,
      );
      const positive = findMaskEdge(
        skinMask,
        frame,
        center,
        axis,
        perpendicular,
        1,
        expectedWidth,
      );
      if (!negative || !positive) continue;
      const width = negative.distance + positive.distance;
      const ratio = width / expectedWidth;
      const symmetry = Math.min(negative.distance, positive.distance)
        / Math.max(negative.distance, positive.distance);
      if (ratio < 0.68 || ratio > 2.4 || symmetry < 0.24) continue;
      const centerConfidence = sampleConfidence(skinMask, frame, center, axis);
      widths.push(width);
      shifts.push((positive.distance - negative.distance) / 2);
      confidences.push(Math.min(negative.confidence, positive.confidence));
      centerConfidences.push(centerConfidence ?? 0);
    }
    if (widths.length < 2) continue;

    const centerWidth = median(widths);
    const widthDeviation = median(widths.map((width) => Math.abs(width - centerWidth)))
      / Math.max(1, centerWidth);
    const centerlineError = averageNumbers(shifts.map(Math.abs)) / Math.max(1, centerWidth);
    const anglePenalty = Math.abs(angle) / maximumAngle;
    const widthRatioError = Math.abs(Math.log(centerWidth / expectedWidth));
    const score = averageNumbers(confidences)
      + averageNumbers(centerConfidences) * 0.25
      - widthDeviation * 1.05
      - centerlineError * 0.9
      - widthRatioError * 0.58
      - anglePenalty * anglePenalty * 0.2;
    if (!best || score > best.score) best = { axis, score };
  }

  return best?.axis ?? normalizedInitial;
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

function normalize3(vector: number[]) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross3(a: number[], b: number[]) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function quaternionFromBasis(
  xAxis: number[],
  yAxis: number[],
  zAxis: number[],
): Pose["orientation"] {
  const m00 = xAxis[0];
  const m01 = yAxis[0];
  const m02 = zAxis[0];
  const m10 = xAxis[1];
  const m11 = yAxis[1];
  const m12 = zAxis[1];
  const m20 = xAxis[2];
  const m21 = yAxis[2];
  const m22 = zAxis[2];
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = 0.25 * scale;
    x = (m21 - m12) / scale;
    y = (m02 - m20) / scale;
    z = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / scale;
    x = 0.25 * scale;
    y = (m01 + m10) / scale;
    z = (m02 + m20) / scale;
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / scale;
    x = (m01 + m10) / scale;
    y = 0.25 * scale;
    z = (m12 + m21) / scale;
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / scale;
    x = (m02 + m20) / scale;
    y = (m12 + m21) / scale;
    z = 0.25 * scale;
  }

  const length = Math.hypot(x, y, z, w) || 1;
  const sign = w < 0 ? -1 : 1;
  return [
    (x / length) * sign,
    (y / length) * sign,
    (z / length) * sign,
    (w / length) * sign,
  ];
}

export function constrainBraceletOrientation(
  orientation: Pose["orientation"],
  armAxis: Point2,
): Pose["orientation"] {
  const axisLength = Math.hypot(armAxis.x, armAxis.y) || 1;
  const screenAxis = { x: armAxis.x / axisLength, y: armAxis.y / axisLength };
  const previousZ = rotateByQuaternion([0, 0, 1], orientation);
  const projectedLength = clamp(Math.hypot(previousZ[0], previousZ[1]), 0.08, 1);
  const zAxis = normalize3([
    screenAxis.x * projectedLength,
    -screenAxis.y * projectedLength,
    previousZ[2],
  ]);
  let xAxis = normalize3([-screenAxis.y, -screenAxis.x, 0]);
  const previousX = rotateByQuaternion([1, 0, 0], orientation);
  if (previousX[0] * xAxis[0] + previousX[1] * xAxis[1] + previousX[2] * xAxis[2] < 0) {
    xAxis = xAxis.map((value) => -value);
  }
  const yAxis = normalize3(cross3(zAxis, xAxis));
  return quaternionFromBasis(xAxis, yAxis, zAxis);
}

export function braceletAlignmentErrorDegrees(
  orientation: Pose["orientation"],
  armAxis: Point2,
) {
  const localX = rotateByQuaternion([1, 0, 0], orientation);
  const projectedLength = Math.hypot(localX[0], localX[1]);
  const axisLength = Math.hypot(armAxis.x, armAxis.y);
  if (projectedLength < 0.0001 || axisLength < 0.0001) return 90;
  const dot = (localX[0] * armAxis.x + localX[1] * -armAxis.y)
    / (projectedLength * axisLength);
  return Math.abs(90 - (Math.acos(clamp(Math.abs(dot), 0, 1)) * 180) / Math.PI);
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
  const orientation = constrainBraceletOrientation(pose.orientation, boundary.axis);
  const planeProjection = Math.max(
    0.34,
    planeProjectionOnArmNormal(orientation, boundary.perpendicular, modelPlaneSize),
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
    boundarySource: boundary.source,
    armAxis: [boundary.axis.x, boundary.axis.y],
    alignmentErrorDegrees: braceletAlignmentErrorDegrees(orientation, boundary.axis),
    orientation,
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
  private diagnostics: ArmBoundaryDiagnostics | null = null;

  prepare(
    source: CanvasImageSource,
    stageWidth: number,
    stageHeight: number,
    mirrored: boolean,
  ): ArmAnalysisFrame | null {
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

    return {
      source: this.canvas,
      pixels: this.context.getImageData(0, 0, width, height),
      analysisScale,
    };
  }

  estimate(
    analysis: ArmAnalysisFrame,
    guide: ForearmGuide,
    expectedWidth: number,
    skinMask?: ConfidenceMask | null,
  ): ArmBoundary | null {
    const { pixels: frame, analysisScale } = analysis;
    const searchWidth = Math.max(expectedWidth, guide.palmLength * 0.9);
    const scaledWrist = {
      x: guide.wrist.x * analysisScale,
      y: guide.wrist.y * analysisScale,
    };
    const scaledPalmLength = guide.palmLength * analysisScale;
    const scaledSearchWidth = searchWidth * analysisScale;
    const axis = skinMask
      ? refineForearmAxis(
          skinMask,
          frame,
          scaledWrist,
          guide.axis,
          scaledPalmLength,
          scaledSearchWidth,
        )
      : guide.axis;
    const center = {
      x: scaledWrist.x + axis.x * scaledPalmLength * 0.18,
      y: scaledWrist.y + axis.y * scaledPalmLength * 0.18,
    };
    const perpendicular = { x: -axis.y, y: axis.x };
    const profileDistances = [0, 0.25, 0.5, 0.75, 1, 1.25].map(
      (factor) => scaledSearchWidth * factor,
    );
    const profile = (direction: -1 | 1) => skinMask
      ? profileDistances.map((distance) => sampleConfidence(
          skinMask,
          frame,
          {
            x: center.x + perpendicular.x * distance * direction,
            y: center.y + perpendicular.y * distance * direction,
          },
          axis,
        ) ?? -1)
      : [];
    this.diagnostics = {
      maskSize: skinMask ? [skinMask.width, skinMask.height] : null,
      wristConfidence: skinMask
        ? sampleConfidence(skinMask, frame, scaledWrist, axis)
        : null,
      centerConfidence: skinMask
        ? sampleConfidence(skinMask, frame, center, axis)
        : null,
      initialAxis: guide.axis,
      refinedAxis: axis,
      expectedWidth: scaledSearchWidth,
      negativeProfile: profile(-1),
      positiveProfile: profile(1),
    };
    const boundary = detectArmBoundary(
      frame,
      center,
      axis,
      scaledSearchWidth,
      skinMask,
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
      source: boundary.source,
    };
  }

  getDiagnostics() {
    return this.diagnostics;
  }
}
