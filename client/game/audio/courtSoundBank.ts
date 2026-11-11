/** Original layered sound design for impacts and transitions. Recordings add Foley. */
export type DesignedSound =
  | "step"
  | "bounce"
  | "gather"
  | "flight"
  | "slam"
  | "net"
  | "rim"
  | "swat"
  | "answer"
  | "buzzer"
  | "combo"
  | "fire"
  | "air";
export function createCourtSound(
  kind: DesignedSound,
  rate: number,
): Float32Array {
  const duration =
    kind === "air"
      ? 3
      : kind === "slam"
        ? 0.62
        : kind === "fire"
          ? 0.52
          : kind === "net"
            ? 0.4
            : kind === "buzzer"
              ? 0.5
              : kind === "combo"
                ? 0.28
                : 0.24;
  const out = new Float32Array(Math.ceil(rate * duration));
  let seed = 7349,
    low = 0,
    phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate,
      u = t / duration;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += 0.16 * (noise - low);
    const high = noise - low;
    const attack = Math.min(1, t / 0.003);
    let value = 0;
    if (kind === "step" || kind === "gather" || kind === "bounce") {
      const pitch =
        kind === "bounce"
          ? 62 + 72 * Math.exp(-t * 44)
          : kind === "gather"
            ? 70
            : 90;
      phase += (2 * Math.PI * pitch) / rate;
      value =
        (Math.sin(phase) * 0.52 * Math.exp(-t * (kind === "bounce" ? 18 : 38)) +
          low * 0.55 * Math.exp(-t * 55) +
          high * 0.11 * Math.exp(-t * 110)) *
        attack;
    } else if (kind === "slam" || kind === "rim") {
      const spring = Math.sin(t * 2 * Math.PI * (286 + 18 * Math.sin(t * 36))) * 0.11 * Math.exp(-t * 9.5);
      value =
        (Math.sin(t * 2 * Math.PI * 61) * 0.46 * Math.exp(-t * 15) +
          Math.sin(t * 2 * Math.PI * 438) * 0.18 * Math.exp(-t * 11) +
          Math.sin(t * 2 * Math.PI * 731) * 0.12 * Math.exp(-t * 18) +
          spring +
          high * 0.2 * Math.exp(-t * 70)) *
        attack;
      if (kind === "rim") value *= 0.62;
    } else if (kind === "combo") {
      const sweep = 440 + 330 * Math.min(1, t / 0.14);
      phase += (2 * Math.PI * sweep) / rate;
      value =
        (Math.sin(phase) * 0.26 +
          Math.sin(phase * 1.5) * 0.14 +
          high * 0.18 * Math.exp(-t * 26)) *
        Math.exp(-t * 12) *
        attack;
    } else if (kind === "fire") {
      value =
        (Math.sin(t * 2 * Math.PI * 220) * 0.24 +
          Math.sin(t * 2 * Math.PI * 277.18) * 0.2 +
          Math.sin(t * 2 * Math.PI * 329.63) * 0.2 +
          Math.sin(t * 2 * Math.PI * 440) * 0.16 +
          high * 0.14 * Math.exp(-t * 9)) *
        Math.exp(-t * 5.2) *
        attack;
    } else if (kind === "net")
      value = high * 0.48 * Math.exp(-t * 11) * Math.sin(Math.PI * u) ** 0.6;
    else if (kind === "swat")
      value = (low * 0.6 + high * 0.16) * Math.exp(-t * 28) * attack;
    else if (kind === "flight")
      value = (low * 0.55 + high * 0.08) * Math.sin(Math.PI * u) ** 2;
    else if (kind === "answer")
      value =
        (Math.sin(t * 2 * Math.PI * 660) +
          0.4 * Math.sin(t * 2 * Math.PI * 990)) *
        0.12 *
        Math.exp(-t * 30) *
        attack;
    else if (kind === "buzzer")
      value =
        (Math.sin(t * 2 * Math.PI * 146) +
          0.25 * Math.sin(t * 2 * Math.PI * 438)) *
        0.14 *
        Math.exp(-t * 7) *
        attack;
    else value = low * 0.22 * Math.sin(Math.PI * u) ** 2;
    out[i] = Math.max(-0.8, Math.min(0.8, value));
  }
  return out;
}
