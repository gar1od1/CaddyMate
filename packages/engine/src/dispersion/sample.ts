/**
 * Deterministic draws from a pattern's mixture (main + miss), for the
 * strategy engine's Monte-Carlo evaluation (§9.2). Same seed ⇒ same shots on
 * every device.
 */
import { fromStandardNormal } from './render.js';
import type { ClubPattern, SampledShot } from './types.js';

/** Mulberry32: a small, fast, well-mixed 32-bit seeded PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` shots from the pattern. Each draw picks the miss component with
 * probability `miss.p_miss` (independent normals on its mean/sd), otherwise
 * the main pattern via Box–Muller and the correlated two-piece mapping.
 */
export function sampleShots(pattern: ClubPattern, n: number, seed: number): SampledShot[] {
  const rand = mulberry32(seed);
  const out: SampledShot[] = [];
  const count = Math.max(0, Math.floor(n));
  for (let i = 0; i < count; i++) {
    const isMiss = rand() < pattern.miss.p_miss;
    // Box–Muller; 1 − U ∈ (0, 1] keeps the log finite.
    const r = Math.sqrt(-2 * Math.log(1 - rand()));
    const th = 2 * Math.PI * rand();
    const u = r * Math.cos(th);
    const v = r * Math.sin(th);
    if (isMiss) {
      const m = pattern.miss;
      out.push({
        alongM: m.distance.mean + m.distance.sd * u,
        lateralM: m.lateral.mean + m.lateral.sd * v,
        miss: true,
      });
    } else {
      out.push({ ...fromStandardNormal(pattern, u, v), miss: false });
    }
  }
  return out;
}
