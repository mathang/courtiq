/** Smooth presentation curves shared by the ball and character; no outcome decisions. */
export const unit = (t: number): number => Math.max(0, Math.min(1, t));
export function ease(t: number): number {
  const u = unit(t);
  return u * u * (3 - 2 * u);
}
export function smoothMotion(t: number): number {
  const u = unit(t);
  return u * u * u * (u * (u * 6 - 15) + 10);
}
export type MotionKey = readonly [
  time: number,
  value: number,
  velocity: number,
];
export function motionCurve(t: number, keys: readonly MotionKey[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i];
    if (t > b[0]) continue;
    const d = b[0] - a[0],
      u = unit((t - a[0]) / d),
      u2 = u * u,
      u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * a[1] +
      (u3 - 2 * u2 + u) * d * a[2] +
      (-2 * u3 + 3 * u2) * b[1] +
      (u3 - u2) * d * b[2]
    );
  }
  return keys[keys.length - 1][1];
}
