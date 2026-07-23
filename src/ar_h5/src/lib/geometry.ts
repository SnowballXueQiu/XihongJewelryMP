import type { Landmark, Pose, ViewportMapping } from "../types/ar";

type Point2 = { x: number; y: number };
type Point3 = { x: number; y: number; z: number };
type QuaternionTuple = [number, number, number, number];

const PALM_INDICES = [5, 9, 13, 17] as const;
const PALM_SCALE_PAIRS = [
  [0, 5],
  [0, 9],
  [0, 13],
  [0, 17],
  [5, 9],
  [9, 13],
  [13, 17],
  [5, 17],
] as const;
const WRIST_OUTER_WIDTH_TO_PALM_WIDTH = 0.92;

export type ForearmGuide = {
  wrist: Point2;
  palmCenter: Point2;
  axis: Point2;
  anchor: Point2;
  palmLength: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

const average = (...points: Point2[]): Point2 => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

const normalize = (point: Point2): Point2 => {
  const length = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / length, y: point.y / length };
};

const subtract3 = (a: Point3, b: Point3): Point3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const multiply3 = (point: Point3, scalar: number): Point3 => ({
  x: point.x * scalar,
  y: point.y * scalar,
  z: point.z * scalar,
});

const dot3 = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;

const cross3 = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const length3 = (point: Point3) => Math.hypot(point.x, point.y, point.z);

const normalize3 = (point: Point3): Point3 => {
  const length = length3(point) || 1;
  return multiply3(point, 1 / length);
};

const distance3 = (a: Point3, b: Point3) => length3(subtract3(a, b));

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const average3 = (...points: Point3[]): Point3 => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
});

function robustWorldPalmWidth(worldLandmarks: Landmark[]) {
  const palmPoints = PALM_INDICES.map((index) => worldLandmarks[index]);
  let bestFit: { indices: number[]; score: number } | null = null;

  for (let from = 0; from < palmPoints.length - 1; from += 1) {
    for (let to = from + 1; to < palmPoints.length; to += 1) {
      const step = 1 / (to - from);
      const slope = multiply3(subtract3(palmPoints[to], palmPoints[from]), step);
      const origin = subtract3(palmPoints[from], multiply3(slope, from));
      const residuals = palmPoints
        .map((point, index) => ({
          index,
          residual: distance3(point, {
            x: origin.x + slope.x * index,
            y: origin.y + slope.y * index,
            z: origin.z + slope.z * index,
          }),
        }))
        .sort((a, b) => a.residual - b.residual);
      const score = residuals.slice(0, 3).reduce((sum, item) => sum + item.residual, 0);
      if (!bestFit || score < bestFit.score) {
        bestFit = { indices: residuals.slice(0, 3).map((item) => item.index), score };
      }
    }
  }

  const inlierIndices = bestFit?.indices ?? [0, 1, 2, 3];
  const meanIndex = inlierIndices.reduce((sum, index) => sum + index, 0)
    / inlierIndices.length;
  const meanPoint = average3(...inlierIndices.map((index) => palmPoints[index]));
  const denominator = inlierIndices.reduce(
    (sum, index) => sum + (index - meanIndex) ** 2,
    0,
  );
  const fittedStep = inlierIndices.reduce((sum, index) => {
    const weight = index - meanIndex;
    const offset = subtract3(palmPoints[index], meanPoint);
    return {
      x: sum.x + offset.x * weight,
      y: sum.y + offset.y * weight,
      z: sum.z + offset.z * weight,
    };
  }, { x: 0, y: 0, z: 0 });
  const fittedWidth = length3(multiply3(fittedStep, 3 / Math.max(denominator, 0.001)));
  const palmLengths = PALM_INDICES
    .map((index) => distance3(worldLandmarks[0], worldLandmarks[index]))
    .sort((a, b) => a - b);
  const referencePalmLength = palmLengths[Math.floor((palmLengths.length - 1) / 2)];
  return clamp(
    fittedWidth,
    referencePalmLength * 0.5,
    referencePalmLength * 1.4,
  );
}

export function mapLandmarkToViewport(
  landmark: Landmark,
  mapping: ViewportMapping,
): Point2 {
  if (mapping.viewport) {
    return {
      x: mapping.viewport.x
        + (mapping.mirrored ? 1 - landmark.x : landmark.x) * mapping.viewport.width,
      y: mapping.viewport.y + landmark.y * mapping.viewport.height,
    };
  }
  const scale = Math.max(
    mapping.width / mapping.sourceWidth,
    mapping.height / mapping.sourceHeight,
  );
  const renderedWidth = mapping.sourceWidth * scale;
  const renderedHeight = mapping.sourceHeight * scale;
  const offsetX = (mapping.width - renderedWidth) / 2;
  const offsetY = (mapping.height - renderedHeight) / 2;
  const sourceX = (mapping.mirrored ? 1 - landmark.x : landmark.x) * mapping.sourceWidth;

  return {
    x: sourceX * scale + offsetX,
    y: landmark.y * mapping.sourceHeight * scale + offsetY,
  };
}

function forearmGuideFromScreenPoints(screenPoints: Point2[]): ForearmGuide | null {
  if (screenPoints.length < 21) return null;
  const wrist = screenPoints[0];
  const palmCenter = average(...PALM_INDICES.map((index) => screenPoints[index]));
  const palmLength = distance(wrist, screenPoints[9]);
  if (!Number.isFinite(palmLength) || palmLength < 10) return null;
  const axis = normalize({
    x: wrist.x - palmCenter.x,
    y: wrist.y - palmCenter.y,
  });
  const centerOffset = palmLength * 0.18;
  return {
    wrist,
    palmCenter,
    axis,
    anchor: {
      x: wrist.x + axis.x * centerOffset,
      y: wrist.y + axis.y * centerOffset,
    },
    palmLength,
  };
}

export function calculateForearmGuide(
  landmarks: Landmark[],
  mapping: ViewportMapping,
): ForearmGuide | null {
  if (landmarks.length < 21) return null;
  return forearmGuideFromScreenPoints(
    landmarks.map((point) => mapLandmarkToViewport(point, mapping)),
  );
}

function palmFacingCamera(
  landmarks: Landmark[],
  handedness: "Left" | "Right" | "Unknown",
): { frontFacing: boolean; facingConfidence: number } {
  const wrist = landmarks[0];
  const index = landmarks[5];
  const pinky = landmarks[17];
  const indexVector = { x: index.x - wrist.x, y: index.y - wrist.y };
  const pinkyVector = { x: pinky.x - wrist.x, y: pinky.y - wrist.y };
  const cross = indexVector.x * pinkyVector.y - indexVector.y * pinkyVector.x;
  const normalizedCross = cross / Math.max(
    Math.hypot(indexVector.x, indexVector.y) * Math.hypot(pinkyVector.x, pinkyVector.y),
    0.0001,
  );
  const handednessSign = handedness === "Left" ? -1 : 1;
  return {
    frontFacing: normalizedCross * handednessSign < 0,
    facingConfidence: Math.abs(normalizedCross),
  };
}

function quaternionFromBasis(xAxis: Point3, yAxis: Point3, zAxis: Point3): QuaternionTuple {
  const m00 = xAxis.x;
  const m01 = yAxis.x;
  const m02 = zAxis.x;
  const m10 = xAxis.y;
  const m11 = yAxis.y;
  const m12 = zAxis.y;
  const m20 = xAxis.z;
  const m21 = yAxis.z;
  const m22 = zAxis.z;
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

function orientationPoints(
  landmarks: Landmark[],
  worldLandmarks: Landmark[] | undefined,
  screenPoints: Point2[],
  mapping: ViewportMapping,
): Point3[] {
  if (worldLandmarks && worldLandmarks.length >= 21) {
    return worldLandmarks.map((point) => ({
      x: (mapping.mirrored ? -1 : 1) * point.x,
      y: -point.y,
      z: -point.z,
    }));
  }

  const videoScale = Math.max(
    mapping.width / mapping.sourceWidth,
    mapping.height / mapping.sourceHeight,
  );
  const depthScale = mapping.sourceWidth * videoScale;
  return landmarks.map((point, index) => ({
    x: screenPoints[index].x,
    y: -screenPoints[index].y,
    z: -point.z * depthScale,
  }));
}

function createLimbOrientation(
  points: Point3[],
  start: Point3,
  end: Point3,
  handedness: "Left" | "Right" | "Unknown",
): QuaternionTuple {
  const limbAxis = normalize3(subtract3(start, end));
  const handednessSign = handedness === "Left" ? -1 : 1;
  const rawAcross = multiply3(subtract3(points[17], points[5]), handednessSign);
  let acrossAxis = subtract3(rawAcross, multiply3(limbAxis, dot3(rawAcross, limbAxis)));

  if (length3(acrossAxis) < 0.0001) {
    const fallback = Math.abs(limbAxis.x) < 0.8
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 1, z: 0 };
    acrossAxis = subtract3(fallback, multiply3(limbAxis, dot3(fallback, limbAxis)));
  }

  acrossAxis = normalize3(acrossAxis);
  const surfaceAxis = normalize3(cross3(limbAxis, acrossAxis));
  acrossAxis = normalize3(cross3(surfaceAxis, limbAxis));
  return quaternionFromBasis(acrossAxis, surfaceAxis, limbAxis);
}

function createFingerOrientation(
  points: Point3[],
  start: Point3,
  end: Point3,
  handedness: "Left" | "Right" | "Unknown",
): QuaternionTuple {
  const fingerAxis = normalize3(subtract3(start, end));
  const fromWristToIndex = subtract3(points[5], points[0]);
  const fromWristToPinky = subtract3(points[17], points[0]);
  const handednessSign = handedness === "Left" ? -1 : 1;
  const rawSurface = multiply3(
    cross3(fromWristToIndex, fromWristToPinky),
    handednessSign,
  );
  let surfaceAxis = subtract3(
    rawSurface,
    multiply3(fingerAxis, dot3(rawSurface, fingerAxis)),
  );

  if (length3(surfaceAxis) < 0.0001) {
    return createLimbOrientation(points, start, end, handedness);
  }

  surfaceAxis = normalize3(surfaceAxis);
  let sideAxis = normalize3(cross3(surfaceAxis, fingerAxis));
  surfaceAxis = normalize3(cross3(fingerAxis, sideAxis));
  sideAxis = normalize3(cross3(surfaceAxis, fingerAxis));
  return quaternionFromBasis(sideAxis, surfaceAxis, fingerAxis);
}

function correctedPalmWidth(
  screenPoints: Point2[],
  worldLandmarks: Landmark[] | undefined,
): { width: number; correction: number } {
  const observedWidth = distance(screenPoints[5], screenPoints[17]);
  if (!worldLandmarks || worldLandmarks.length < 21) {
    return { width: observedWidth, correction: 1 };
  }

  const ratios: number[] = [];
  for (const [fromIndex, toIndex] of PALM_SCALE_PAIRS) {
    const fromWorld = worldLandmarks[fromIndex];
    const toWorld = worldLandmarks[toIndex];
    const dx = toWorld.x - fromWorld.x;
    const dy = toWorld.y - fromWorld.y;
    const dz = toWorld.z - fromWorld.z;
    const projectedWorldLength = Math.hypot(dx, dy);
    const worldLength = Math.hypot(dx, dy, dz);
    if (worldLength < 0.001 || projectedWorldLength / worldLength < 0.18) continue;
    const screenLength = distance(screenPoints[fromIndex], screenPoints[toIndex]);
    if (screenLength < 4) continue;
    const ratio = screenLength / projectedWorldLength;
    if (Number.isFinite(ratio) && ratio > 0) ratios.push(ratio);
  }

  if (ratios.length < 3) return { width: observedWidth, correction: 1 };
  const centerRatio = median(ratios);
  const medianDeviation = median(ratios.map((ratio) => Math.abs(ratio - centerRatio)));
  const allowedDeviation = Math.max(centerRatio * 0.16, medianDeviation * 3.5);
  const stableRatios = ratios.filter(
    (ratio) => Math.abs(ratio - centerRatio) <= allowedDeviation,
  );
  const pixelsPerMeter = median(stableRatios.length >= 3 ? stableRatios : ratios);
  const worldPalmWidth = robustWorldPalmWidth(worldLandmarks);
  const rawCorrection = (pixelsPerMeter * worldPalmWidth) / Math.max(observedWidth, 1);
  const observedPalmLength = distance(screenPoints[0], screenPoints[9]);
  const screenAspect = observedWidth / Math.max(observedPalmLength, 1);
  // Large depth compensation is plausible only when the 2D hand is visibly side-on.
  const sideViewEvidence = clamp((0.72 - screenAspect) / 0.52, 0, 1);
  const maximumCorrection = 1.25 + sideViewEvidence * 10.75;
  const correction = clamp(rawCorrection, 0.88, maximumCorrection);
  return { width: observedWidth * correction, correction };
}

export function calculateWristPose(
  landmarks: Landmark[],
  worldLandmarks: Landmark[] | undefined,
  mapping: ViewportMapping,
  handedness: "Left" | "Right" | "Unknown",
  confidence: number,
): Pose | null {
  if (landmarks.length < 21) return null;

  const screenPoints = landmarks.map((point) => mapLandmarkToViewport(point, mapping));
  const guide = forearmGuideFromScreenPoints(screenPoints);
  if (!guide) return null;
  const { palmLength } = guide;
  const palmScale = correctedPalmWidth(screenPoints, worldLandmarks);
  if (!Number.isFinite(palmScale.width) || palmLength < 10 || palmScale.width < 6) return null;
  const points3 = orientationPoints(landmarks, worldLandmarks, screenPoints, mapping);
  const wrist3 = points3[0];
  const palmCenter3 = average3(...PALM_INDICES.map((index) => points3[index]));
  const orientation = createLimbOrientation(points3, wrist3, palmCenter3, handedness);
  const facing = palmFacingCamera(landmarks, handedness);

  return {
    x: guide.anchor.x,
    y: guide.anchor.y,
    scale: clamp(
      palmScale.width * WRIST_OUTER_WIDTH_TO_PALM_WIDTH,
      24,
      Math.min(mapping.width, mapping.height) * 0.88,
    ),
    scaleCorrection: palmScale.correction,
    orientation,
    ...facing,
    confidence,
  };
}

const FINGER_LANDMARKS = {
  index: [5, 6],
  middle: [9, 10],
  ring: [13, 14],
  pinky: [17, 18],
} as const;

export function calculateFingerPose(
  landmarks: Landmark[],
  worldLandmarks: Landmark[] | undefined,
  mapping: ViewportMapping,
  handedness: "Left" | "Right" | "Unknown",
  finger: keyof typeof FINGER_LANDMARKS = "ring",
  confidence = 1,
): Pose | null {
  if (landmarks.length < 21) return null;
  const [mcpIndex, pipIndex] = FINGER_LANDMARKS[finger];
  const screenPoints = landmarks.map((point) => mapLandmarkToViewport(point, mapping));
  const mcp = screenPoints[mcpIndex];
  const pip = screenPoints[pipIndex];
  const fingerLength = distance(mcp, pip);
  const palmScale = correctedPalmWidth(screenPoints, worldLandmarks);
  if (!Number.isFinite(fingerLength) || fingerLength < 8 || palmScale.width < 6) return null;

  const direction = normalize({ x: pip.x - mcp.x, y: pip.y - mcp.y });
  const points3 = orientationPoints(landmarks, worldLandmarks, screenPoints, mapping);
  const orientation = createFingerOrientation(
    points3,
    points3[mcpIndex],
    points3[pipIndex],
    handedness,
  );
  const nextIndex = Math.min(20, pipIndex + 1);
  const proximal = normalize3(subtract3(points3[pipIndex], points3[mcpIndex]));
  const middle = normalize3(subtract3(points3[nextIndex], points3[pipIndex]));
  const fingerBendDegrees = Math.acos(clamp(dot3(proximal, middle), -1, 1))
    * 180 / Math.PI;
  const facing = palmFacingCamera(landmarks, handedness);

  return {
    x: mcp.x + direction.x * fingerLength * 0.28,
    y: mcp.y + direction.y * fingerLength * 0.28,
    scale: clamp(
      palmScale.width * 0.27,
      18,
      Math.min(mapping.width, mapping.height) * 0.34,
    ),
    scaleCorrection: palmScale.correction,
    orientation,
    ...facing,
    confidence: confidence * (fingerBendDegrees > 60 ? 0.72 : 1),
    fingerBendDegrees,
  };
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

const smoothingAlpha = (cutoff: number, deltaSeconds: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / deltaSeconds);
};

class OneEuroScalar {
  private value = 0;
  private raw = 0;
  private derivative = 0;
  private timestamp = 0;
  private initialized = false;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly derivativeCutoff = 1,
  ) {}

  update(next: number, timestamp: number) {
    if (!this.initialized || timestamp - this.timestamp > 450) {
      this.value = next;
      this.raw = next;
      this.derivative = 0;
      this.timestamp = timestamp;
      this.initialized = true;
      return next;
    }

    const deltaSeconds = Math.max(0.001, (timestamp - this.timestamp) / 1000);
    const rawDerivative = (next - this.raw) / deltaSeconds;
    const derivativeAmount = smoothingAlpha(this.derivativeCutoff, deltaSeconds);
    this.derivative = lerp(this.derivative, rawDerivative, derivativeAmount);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value = lerp(this.value, next, smoothingAlpha(cutoff, deltaSeconds));
    this.raw = next;
    this.timestamp = timestamp;
    return this.value;
  }

  reset() {
    this.initialized = false;
    this.timestamp = 0;
  }
}

function slerpQuaternion(
  from: QuaternionTuple,
  to: QuaternionTuple,
  amount: number,
): QuaternionTuple {
  let [toX, toY, toZ, toW] = to;
  let dot = from[0] * toX + from[1] * toY + from[2] * toZ + from[3] * toW;
  if (dot < 0) {
    dot = -dot;
    toX = -toX;
    toY = -toY;
    toZ = -toZ;
    toW = -toW;
  }

  if (dot > 0.9995) {
    const result: QuaternionTuple = [
      lerp(from[0], toX, amount),
      lerp(from[1], toY, amount),
      lerp(from[2], toZ, amount),
      lerp(from[3], toW, amount),
    ];
    const length = Math.hypot(...result) || 1;
    return result.map((value) => value / length) as QuaternionTuple;
  }

  const theta = Math.acos(clamp(dot, -1, 1));
  const sinTheta = Math.sin(theta);
  const fromWeight = Math.sin((1 - amount) * theta) / sinTheta;
  const toWeight = Math.sin(amount * theta) / sinTheta;
  return [
    from[0] * fromWeight + toX * toWeight,
    from[1] * fromWeight + toY * toWeight,
    from[2] * fromWeight + toZ * toWeight,
    from[3] * fromWeight + toW * toWeight,
  ];
}

export class PoseSmoother {
  private pose: Pose | null = null;
  private timestamp = 0;
  private readonly xFilter = new OneEuroScalar(1.35, 0.008);
  private readonly yFilter = new OneEuroScalar(1.35, 0.008);
  private readonly logScaleFilter = new OneEuroScalar(1.1, 0.65);
  private scaleSamples: number[] = [];
  private pendingFacing: boolean | null = null;
  private pendingFacingFrames = 0;

  update(next: Pose, timestamp: number): Pose {
    if (!this.pose || timestamp - this.timestamp > 450) {
      this.pose = { ...next, orientation: [...next.orientation] as QuaternionTuple };
      this.xFilter.update(next.x, timestamp);
      this.yFilter.update(next.y, timestamp);
      this.logScaleFilter.update(Math.log(next.scale), timestamp);
      this.scaleSamples = Array(3).fill(Math.log(next.scale));
      this.timestamp = timestamp;
      return this.pose;
    }

    const deltaSeconds = Math.max(0.001, (timestamp - this.timestamp) / 1000);
    const currentLogScale = Math.log(this.pose.scale);
    this.scaleSamples.push(Math.log(next.scale));
    if (this.scaleSamples.length > 5) this.scaleSamples.shift();
    const requestedLogScale = median(this.scaleSamples);
    const maxLogScaleStep = deltaSeconds * 3.2;
    const targetLogScale = clamp(
      requestedLogScale,
      currentLogScale - maxLogScaleStep,
      currentLogScale + maxLogScaleStep,
    );
    const filteredLogScale = this.logScaleFilter.update(targetLogScale, timestamp);
    const metadataAmount = 1 - Math.exp(-deltaSeconds * 10);
    const dot = Math.abs(
      this.pose.orientation[0] * next.orientation[0]
      + this.pose.orientation[1] * next.orientation[1]
      + this.pose.orientation[2] * next.orientation[2]
      + this.pose.orientation[3] * next.orientation[3],
    );
    const angularSpeed = (2 * Math.acos(clamp(dot, -1, 1))) / deltaSeconds;
    const rotationCutoff = clamp(1.5 + angularSpeed * 0.55, 1.5, 12);
    const rotationAmount = 1 - Math.exp(-2 * Math.PI * rotationCutoff * deltaSeconds);

    let frontFacing = this.pose.frontFacing;
    if (next.facingConfidence >= 0.14 && next.frontFacing !== frontFacing) {
      if (this.pendingFacing === next.frontFacing) {
        this.pendingFacingFrames += 1;
      } else {
        this.pendingFacing = next.frontFacing;
        this.pendingFacingFrames = 1;
      }
      if (this.pendingFacingFrames >= 2) {
        frontFacing = next.frontFacing;
        this.pendingFacing = null;
        this.pendingFacingFrames = 0;
      }
    } else {
      this.pendingFacing = null;
      this.pendingFacingFrames = 0;
    }

    this.pose = {
      x: this.xFilter.update(next.x, timestamp),
      y: this.yFilter.update(next.y, timestamp),
      scale: Math.exp(filteredLogScale),
      scaleCorrection: lerp(this.pose.scaleCorrection, next.scaleCorrection, metadataAmount),
      armWidth: next.armWidth === undefined
        ? undefined
        : lerp(this.pose.armWidth ?? next.armWidth, next.armWidth, metadataAmount),
      boundaryConfidence: next.boundaryConfidence,
      targetSpan: next.targetSpan,
      planeProjection: next.planeProjection,
      boundarySource: next.boundarySource,
      armAxis: next.armAxis,
      alignmentErrorDegrees: next.alignmentErrorDegrees,
      orientation: slerpQuaternion(this.pose.orientation, next.orientation, rotationAmount),
      frontFacing,
      facingConfidence: next.facingConfidence,
      confidence: lerp(this.pose.confidence, next.confidence, metadataAmount),
      fingerBendDegrees: next.fingerBendDegrees,
    };
    this.timestamp = timestamp;
    return this.pose;
  }

  reset() {
    this.pose = null;
    this.timestamp = 0;
    this.xFilter.reset();
    this.yFilter.reset();
    this.logScaleFilter.reset();
    this.scaleSamples = [];
    this.pendingFacing = null;
    this.pendingFacingFrames = 0;
  }
}

export class HandednessStabilizer {
  private stable: "Left" | "Right" | "Unknown" = "Unknown";
  private pending: "Left" | "Right" | "Unknown" = "Unknown";
  private pendingFrames = 0;

  update(candidate: "Left" | "Right" | "Unknown", score: number) {
    if (this.stable === "Unknown") {
      if (candidate !== "Unknown" && score >= 0.75) this.stable = candidate;
      return this.stable;
    }
    if (candidate === "Unknown" || score < 0.75 || candidate === this.stable) {
      this.pending = "Unknown";
      this.pendingFrames = 0;
      return this.stable;
    }

    if (this.pending === candidate) {
      this.pendingFrames += 1;
    } else {
      this.pending = candidate;
      this.pendingFrames = 1;
    }
    if (this.pendingFrames >= 3) {
      this.stable = candidate;
      this.pending = "Unknown";
      this.pendingFrames = 0;
    }
    return this.stable;
  }

  reset() {
    this.stable = "Unknown";
    this.pending = "Unknown";
    this.pendingFrames = 0;
  }
}
