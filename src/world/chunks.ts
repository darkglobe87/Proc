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

/*
 * Placements for everything that is not terrain: collectibles, decor, ledges.
 *
 * These are *specs*, carrying no y coordinate. Resolving them into world positions needs
 * ground height, but `Terrain` owns this module — so the spec/resolve split keeps the
 * dependency one-way, with `world.ts` doing the resolution. It also keeps a single
 * deterministic generation point: features and spawns come out of the same per-chunk
 * stream, so there is one place that has to be right about determinism rather than four.
 */

/**
 * A chime arc.
 *
 * There is deliberately no height parameter. An arc traces exactly one full-height jump,
 * so "jump here and hold" is always the right answer — vary the apex and some arcs ask for
 * a jump higher than the player can physically make, while others sit below the arc a held
 * jump actually flies. Either way the arc stops being a line you can follow, which is the
 * only reason it exists. Variety comes from the terrain underneath.
 */
export interface ChimeArcSpec {
  kind: 'chimeArc';
  /** Stable within a chunk, so collected state survives eviction. */
  slot: number;
  /** World x where the arc begins. */
  x: number;
  count: number;
}

/** A decorative silhouette — a rock, a spire, a ruined pillar. Purely scenery. */
export interface DecorSpec {
  kind: 'decor';
  slot: number;
  x: number;
  width: number;
  height: number;
  /** Selects the silhouette shape; interpretation belongs to the renderer. */
  variant: number;
}

/**
 * A one-way ledge: a flat platform floating above the terrain, standable from above
 * and passable from below and the sides.
 */
export interface LedgeSpec {
  kind: 'ledge';
  slot: number;
  x: number;
  width: number;
  /** How far above the ground beneath its centre the ledge floats. */
  clearance: number;
  thickness: number;
}

export type SpawnSpec = ChimeArcSpec | DecorSpec | LedgeSpec;

export interface Chunk {
  index: number;
  features: Feature[];
  spawns: SpawnSpec[];
}

export const CHUNK_WIDTH = 900;

/** Widest a feature may be. Keeps `featuresNear` to a 3-chunk window. */
const MAX_FEATURE_WIDTH = 460;

/**
 * Furthest a spawn can reach beyond its anchor x. Chime arcs are the long ones, so
 * queries must look this far either side to avoid missing one that starts in a
 * neighbouring chunk.
 */
export const MAX_SPAWN_REACH = 700;

/** Minimum gap between decor pieces, so a chunk doesn't read as one cluttered pile. */
const DECOR_SPACING = 200;

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

  /**
   * Every spawn spec anchored near a range. Returns a fresh array; safe to retain.
   *
   * The window is widened by {@link MAX_SPAWN_REACH} because a chime arc anchored in
   * the previous chunk can still extend into this one.
   */
  spawnsIn(fromX: number, toX: number): SpawnSpec[] {
    const first = chunkIndexAt(fromX - MAX_SPAWN_REACH);
    const last = chunkIndexAt(toX + MAX_SPAWN_REACH);
    const found: SpawnSpec[] = [];
    for (let index = first; index <= last; index++) {
      for (const spawn of this.chunk(index).spawns) found.push(spawn);
    }
    return found;
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
    if (index < CALM_CHUNKS) return { index, features, spawns: [] };

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

    return { index, features, spawns: this.generateSpawns(start, rng) };
  }

  /**
   * Places collectibles, decor and ledges.
   *
   * No longer reads `features` at all: decor doesn't care what the terrain is doing
   * underneath it (standing on a slope is exactly where a rock or a ruin would actually
   * be), and only obstacle-as-hazard fairness ever needed to know where a launch landed.
   * Drawing from the same chunk stream as everything else keeps the whole chunk
   * reproducible regardless.
   */
  private generateSpawns(start: number, rng: Rng): SpawnSpec[] {
    const spawns: SpawnSpec[] = [];
    let slot = 0;

    // Arc *hints*, spread across the chunk. Only a hint: `arcLaunch` picks the real launch
    // point at resolution time, since it is the only place that can see the terrain — and it
    // rejects most candidates as unjumpable. Offering several is what keeps chimes at a
    // reasonable density despite that.
    const ARC_HINTS = 3;
    for (let hint = 0; hint < ARC_HINTS; hint++) {
      const slice = CHUNK_WIDTH / ARC_HINTS;
      spawns.push({
        kind: 'chimeArc',
        slot: slot++,
        x: start + hint * slice + rng.range(0, slice * 0.5),
        count: rng.int(4, 8),
      });
    }

    // At least one piece of scenery per chunk, so the world reads as lived-in rather
    // than empty between the occasional feature — there is no fairness budget to spend
    // now that nothing here is dangerous.
    const decorCount = rng.int(1, 4);
    const placed: number[] = [];
    for (let attempt = 0; attempt < decorCount * 4 && placed.length < decorCount; attempt++) {
      const x = rng.range(start + 60, start + CHUNK_WIDTH - 60);
      if (placed.some((other) => Math.abs(other - x) < DECOR_SPACING)) continue;
      placed.push(x);
      spawns.push({
        kind: 'decor',
        slot: slot++,
        x,
        width: rng.range(16, 30),
        height: rng.range(34, 64),
        variant: rng.int(0, 3),
      });
    }

    if (rng.bool(0.4)) {
      spawns.push({
        kind: 'ledge',
        slot: slot++,
        x: rng.range(start + 100, start + CHUNK_WIDTH - 220),
        width: rng.range(120, 220),
        clearance: rng.range(50, 100),
        thickness: rng.range(10, 16),
      });
    }

    return spawns;
  }
}
