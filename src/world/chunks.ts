/**
 * Discrete terrain features, decided per fixed-width chunk.
 *
 * The critical property: a chunk's contents derive **only** from its index and the
 * run seed, never from when or in what order it was first generated. So a chunk can
 * be evicted and regenerated identically — which the Rewind twist (which scrolls the
 * world backwards) and re-entering an easter-egg pocket both depend on. Generating
 * from a running stream instead would make content depend on visit order and quietly
 * break both.
 */

import type { Rng } from '../core/rng';

export type FeatureKind = 'crest' | 'pit' | 'ramp' | 'plateau';

export interface Feature {
  kind: FeatureKind;
  /** World x of the feature's centre. */
  x: number;
  /** Total span. Must stay below CHUNK_WIDTH so only adjacent chunks can matter. */
  width: number;
  /** Peak deformation in pixels; sign is applied by the shape, not stored here. */
  amplitude: number;
}

export interface Chunk {
  index: number;
  features: Feature[];
}

export const CHUNK_WIDTH = 900;

/** Widest a feature may be. Keeps `featuresNear` to a 3-chunk window. */
const MAX_FEATURE_WIDTH = 460;

/** Chunks before this are left flat so a run always opens calmly. */
const CALM_CHUNKS = 1;

/** How many chunks either side of the player to keep generated. */
const KEEP_RADIUS = 4;

interface FeatureSpec {
  kind: FeatureKind;
  weight: number;
  minWidth: number;
  maxWidth: number;
  minAmplitude: number;
  maxAmplitude: number;
}

const SPECS: readonly FeatureSpec[] = [
  { kind: 'crest', weight: 3, minWidth: 240, maxWidth: 420, minAmplitude: 40, maxAmplitude: 90 },
  { kind: 'ramp', weight: 2, minWidth: 220, maxWidth: 330, minAmplitude: 45, maxAmplitude: 95 },
  { kind: 'plateau', weight: 2, minWidth: 250, maxWidth: 460, minAmplitude: 30, maxAmplitude: 60 },
  { kind: 'pit', weight: 1.5, minWidth: 180, maxWidth: 320, minAmplitude: 34, maxAmplitude: 74 },
];

export function chunkIndexAt(x: number): number {
  return Math.floor(x / CHUNK_WIDTH);
}

export class ChunkField {
  private readonly cache = new Map<number, Chunk>();
  private readonly scratch: Feature[] = [];

  constructor(private readonly rng: Rng) {}

  /** The chunk at `index`, generating and memoising it on first request. */
  chunk(index: number): Chunk {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const generated = this.generate(index);
    this.cache.set(index, generated);
    return generated;
  }

  /**
   * Features that could influence height at `x`.
   *
   * Returns a **reused array** — `heightAt` calls this on every sample, and
   * allocating a fresh array hundreds of times per frame is exactly the GC churn the
   * Android budget cannot absorb. Iterate it immediately; never retain it.
   */
  featuresNear(x: number): readonly Feature[] {
    const centre = chunkIndexAt(x);
    this.scratch.length = 0;
    for (let index = centre - 1; index <= centre + 1; index++) {
      for (const feature of this.chunk(index).features) {
        const half = feature.width / 2;
        if (x > feature.x - half && x < feature.x + half) this.scratch.push(feature);
      }
    }
    return this.scratch;
  }

  /** Every feature overlapping a range. Returns a fresh array; safe to retain. */
  featuresIn(fromX: number, toX: number): Feature[] {
    const first = chunkIndexAt(fromX - MAX_FEATURE_WIDTH);
    const last = chunkIndexAt(toX + MAX_FEATURE_WIDTH);
    const found: Feature[] = [];
    for (let index = first; index <= last; index++) {
      for (const feature of this.chunk(index).features) {
        const half = feature.width / 2;
        if (feature.x + half > fromX && feature.x - half < toX) found.push(feature);
      }
    }
    return found;
  }

  /** Forgets distant chunks. They regenerate identically if revisited. */
  prune(aroundX: number): void {
    const centre = chunkIndexAt(aroundX);
    for (const index of this.cache.keys()) {
      if (Math.abs(index - centre) > KEEP_RADIUS) this.cache.delete(index);
    }
  }

  /** Number of chunks currently held. Exposed for tests and diagnostics. */
  get residentCount(): number {
    return this.cache.size;
  }

  private generate(index: number): Chunk {
    const features: Feature[] = [];
    if (index < CALM_CHUNKS) return { index, features };

    // Keyed by index alone — this is what makes regeneration reproducible.
    const rng = this.rng.fork(`chunk:${index}`);
    const start = index * CHUNK_WIDTH;

    const count = rng.int(1, 4);
    // Lay features out in non-overlapping slots so their deformations sum cleanly
    // instead of compounding into a cliff.
    const slotWidth = CHUNK_WIDTH / count;

    for (let slot = 0; slot < count; slot++) {
      const spec = rng.weighted(SPECS, (candidate) => candidate.weight);
      const width = rng.range(spec.minWidth, spec.maxWidth);
      const half = width / 2;

      const slotStart = start + slot * slotWidth;
      const centreMin = slotStart + half;
      const centreMax = slotStart + slotWidth - half;
      // Slot too tight for this feature: skip rather than let it bleed into its
      // neighbour, which would stack two deformations into an unrunnable wall.
      if (centreMax <= centreMin) continue;

      features.push({
        kind: spec.kind,
        x: rng.range(centreMin, centreMax),
        width,
        amplitude: rng.range(spec.minAmplitude, spec.maxAmplitude),
      });
    }

    return { index, features };
  }
}
