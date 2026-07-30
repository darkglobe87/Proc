/**
 * Deterministic random number generation.
 *
 * Every procedural system in the game draws from here and never from
 * `Math.random`, so a run is fully reproducible from its seed. The key idea is
 * {@link Rng.fork}: each subsystem derives its own named stream, so a change in
 * how many numbers the terrain consumes cannot shift the twist order or the
 * music. Without that, adding one obstacle type would silently invalidate every
 * shared seed.
 */

/** Mixes a string into a well-distributed 32-bit seed (xmur3). */
export function hashString(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Mixes two 32-bit values into one. Used to combine a seed with a stream name. */
function mixSeeds(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 2654435761);
  h = Math.imul(h ^ b, 1597334677);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * A single deterministic stream. Cheap to construct, so forking freely is fine.
 *
 * mulberry32: 32 bits of state, passes practrand at this scale, and is fast
 * enough to call thousands of times per frame on a mid-range phone.
 */
export class Rng {
  private state: number;

  constructor(public readonly seed: number) {
    this.state = seed >>> 0;
  }

  /** Raw 32-bit draw. */
  uint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.uint32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max). */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min));
  }

  /** True with probability `p`. */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Either -1 or 1. */
  sign(): number {
    return this.bool() ? 1 : -1;
  }

  /** Uniform choice. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[this.int(0, items.length)] as T;
  }

  /**
   * Choice weighted by `weight(item)`. Non-positive weights are skipped, which
   * is how the twist scheduler excludes twists that conflict with the active one.
   */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) {
      const w = weight(item);
      if (w > 0) total += w;
    }
    if (total <= 0) throw new Error('Rng.weighted: no item has positive weight');

    let roll = this.next() * total;
    for (const item of items) {
      const w = weight(item);
      if (w <= 0) continue;
      roll -= w;
      if (roll < 0) return item;
    }
    // Only reachable through floating-point drift on the final item.
    return items[items.length - 1] as T;
  }

  /** Fisher-Yates, in place. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const a = items[i] as T;
      items[i] = items[j] as T;
      items[j] = a;
    }
    return items;
  }

  /**
   * Normally distributed value (Box-Muller). Deliberately stateless — it
   * discards the second variate instead of caching it, so {@link clone} always
   * reproduces the same sequence.
   */
  gaussian(mean = 0, stdev = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * A new independent stream identified by `name`. The same seed and name always
   * give the same stream, and consumption here never affects the parent.
   */
  fork(name: string): Rng {
    return new Rng(mixSeeds(this.seed, hashString(name)));
  }

  /** A copy positioned exactly where this stream currently sits. */
  clone(): Rng {
    const copy = new Rng(this.seed);
    copy.state = this.state;
    return copy;
  }

  /** Current position, for save/restore of an in-flight stream. */
  get position(): number {
    return this.state;
  }

  set position(state: number) {
    this.state = state >>> 0;
  }
}

/**
 * Crockford base32 — no I, L, O or U, so a seed read aloud or typed from a
 * screenshot cannot be ambiguous.
 */
const SEED_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEED_CHARS = 7; // 7 * 5 bits = 35, enough for a uint32

/** Formats a seed as a shareable code, e.g. `K3F-9QW2`. */
export function encodeSeed(seed: number): string {
  let value = seed >>> 0;
  let out = '';
  for (let i = 0; i < SEED_CHARS; i++) {
    out = SEED_ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

/** Parses a shareable code. Returns null if it is not a valid seed. */
export function decodeSeed(code: string): number | null {
  const cleaned = code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // Fold the characters Crockford treats as interchangeable.
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');

  if (cleaned.length === 0 || cleaned.length > SEED_CHARS) return null;

  let value = 0;
  for (const char of cleaned) {
    const digit = SEED_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 32 + digit;
  }
  return value > 0xffffffff ? null : value >>> 0;
}

/** A fresh unpredictable seed for a normal run. */
export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] as number) >>> 0;
}

/**
 * The seed everyone shares for a given day (UTC), so the Daily Run is the same
 * course for every player.
 */
export function dailySeed(date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return hashString(`mirage-daily-${y}-${m}-${d}`);
}
