export type CameraPlacement = {
  position: [number, number, number];
  worldPerPixel: number;
};

export function pixelPoseToCamera(
  x: number,
  y: number,
  width: number,
  height: number,
  projection: ArrayLike<number>,
  depth = 0.7,
): CameraPlacement {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const projectionX = Math.abs(projection[0]) > 0.0001 ? projection[0] : 1;
  const projectionY = Math.abs(projection[5]) > 0.0001 ? projection[5] : 1;
  const principalX = projection[8] || 0;
  const principalY = projection[9] || 0;
  const ndcX = (x / safeWidth) * 2 - 1;
  const ndcY = 1 - (y / safeHeight) * 2;
  const worldPerPixelX = 2 * depth / (Math.abs(projectionX) * safeWidth);
  const worldPerPixelY = 2 * depth / (Math.abs(projectionY) * safeHeight);

  return {
    position: [
      ((ndcX + principalX) * depth) / projectionX,
      ((ndcY + principalY) * depth) / projectionY,
      -depth,
    ],
    worldPerPixel: Math.sqrt(worldPerPixelX * worldPerPixelY),
  };
}
