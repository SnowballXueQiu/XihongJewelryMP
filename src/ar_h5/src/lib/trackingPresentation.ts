export type PosePresentation = {
  confirmed: boolean;
  elapsed: number;
  opacity: number;
  shouldReset: boolean;
};

export function posePresentationState(
  validFrames: number,
  lastSeen: number,
  timestamp: number,
  hasPose: boolean,
): PosePresentation {
  const elapsed = lastSeen > 0
    ? timestamp - lastSeen
    : Number.POSITIVE_INFINITY;
  const confirmed = hasPose && validFrames >= 2;
  const opacity = !confirmed
    ? 0
    : elapsed <= 100
      ? 1
      : elapsed < 320
        ? 1 - (elapsed - 100) / 220
        : 0;

  return {
    confirmed,
    elapsed,
    opacity,
    shouldReset: hasPose && elapsed > 450,
  };
}
