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

export function mapLandmarkToViewport(
  landmark: Landmark,
  mapping: ViewportMapping,
): Point2 {
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
  mirrored: boolean,
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
  const mirrorSign = mirrored ? -1 : 1;
  return {
    frontFacing: normalizedCross * handednessSign * mirrorSign < 0,
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
  const worldPalmWidth = Math.hypot(
    worldLandmarks[17].x - worldLandmarks[5].x,
    worldLandmarks[17].y - worldLandmarks[5].y,
    worldLandmarks[17].z - worldLandmarks[5].z,
  );
  const estimatedWidth = pixelsPerMeter * worldPalmWidth;
  const correction = estimatedWidth / Math.max(observedWidth, 1);
  return { width: estimatedWidth, correction };
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
  const { wrist, palmCenter, palmLength } = guide;
  const palmScale = correctedPalmWidth(screenPoints, worldLandmarks);
  if (!Number.isFinite(palmScale.width) || palmLength < 10 || palmScale.width < 6) return null;
  const points3 = orientationPoints(landmarks, worldLandmarks, screenPoints, mapping);
  const wrist3 = points3[0];
  const palmCenter3 = average3(...PALM_INDICES.map((index) => points3[index]));
  const orientation = createLimbOrientation(points3, wrist3, palmCenter3, handedness);
  const facing = palmFacingCamera(landmarks, handedness, mapping.mirrored);

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
  const orientation = createLimbOrientation(
    points3,
    points3[mcpIndex],
    points3[pipIndex],
    handedness,
  );
  const facing = palmFacingCamera(landmarks, handedness, mapping.mirrored);

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
    confidence,
  };
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

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

  update(next: Pose, timestamp: number): Pose {
    if (!this.pose || timestamp - this.timestamp > 450) {
      this.pose = { ...next, orientation: [...next.orientation] as QuaternionTuple };
      this.timestamp = timestamp;
      return this.pose;
    }

    const deltaSeconds = Math.max(0.001, (timestamp - this.timestamp) / 1000);
    const positionAmount = 1 - Math.exp(-deltaSeconds * 15);
    const rotationAmount = 1 - Math.exp(-deltaSeconds * 12);
    const currentLogScale = Math.log(this.pose.scale);
    const requestedLogScale = Math.log(next.scale);
    const maxLogScaleStep = deltaSeconds * 3.2;
    const targetLogScale = clamp(
      requestedLogScale,
      currentLogScale - maxLogScaleStep,
      currentLogScale + maxLogScaleStep,
    );
    const scaleDelta = Math.abs(targetLogScale - currentLogScale);
    const scaleSpeed = 11 + Math.min(5, scaleDelta * 18);
    const scaleAmount = 1 - Math.exp(-deltaSeconds * scaleSpeed);

    this.pose = {
      x: lerp(this.pose.x, next.x, positionAmount),
      y: lerp(this.pose.y, next.y, positionAmount),
      scale: Math.exp(lerp(currentLogScale, targetLogScale, scaleAmount)),
      scaleCorrection: lerp(this.pose.scaleCorrection, next.scaleCorrection, scaleAmount),
      armWidth: next.armWidth === undefined
        ? undefined
        : lerp(this.pose.armWidth ?? next.armWidth, next.armWidth, scaleAmount),
      boundaryConfidence: next.boundaryConfidence,
      targetSpan: next.targetSpan,
      planeProjection: next.planeProjection,
      boundarySource: next.boundarySource,
      armAxis: next.armAxis,
      alignmentErrorDegrees: next.alignmentErrorDegrees,
      orientation: slerpQuaternion(this.pose.orientation, next.orientation, rotationAmount),
      frontFacing: next.facingConfidence >= 0.14 ? next.frontFacing : this.pose.frontFacing,
      facingConfidence: next.facingConfidence,
      confidence: lerp(this.pose.confidence, next.confidence, positionAmount),
    };
    this.timestamp = timestamp;
    return this.pose;
  }

  reset() {
    this.pose = null;
    this.timestamp = 0;
  }
}
