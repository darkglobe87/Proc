import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Terrain } from '../src/world/terrain';
import { CHUNK_WIDTH, ChunkField, chunkIndexAt } from '../src/world/chunks';

const BASELINE = 400;

function terrain(seed = 12345): Terrain {
  return new Terrain(new Rng(seed), BASELINE);
}

/** Cheap order-sensitive digest of a float series. */
function digest(values: Iterable<number>): number {
  let hash = 2166136261;
  for (const value of values) {
    // Quantise so the digest is not hostage to last-bit float noise.
    hash ^= Math.round(value * 1000) | 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function* samples(t: Terrain, from: number, to: number, step: number): Generator<number> {
  for (let x = from; x < to; x += step) yield t.heightAt(x);
}

describe('Terrain', () => {
  it('is identical for the same seed', () => {
    const a = digest(samples(terrain(777), 0, 10_000, 1));
    const b = digest(samples(terrain(777), 0, 10_000, 1));
    expect(a).toBe(b);
  });

  it('differs between seeds', () => {
    expect(digest(samples(terrain(1), 0, 5_000, 1))).not.toBe(
      digest(samples(terrain(2), 0, 5_000, 1)),
    );
  });

  it('does not depend on the order x is sampled in', () => {
    // Sampling forwards then backwards must agree. This is what would break if a
    // feature's influence leaked outside its own width, or if chunk generation
    // consumed a shared running stream.
    const t = terrain(4242);
    const forward: number[] = [];
    for (let x = 0; x < 6_000; x += 3) forward.push(t.heightAt(x));

    const backward: number[] = [];
    const fresh = terrain(4242);
    for (let x = 5_999 - ((5_999 - 0) % 3); x >= 0; x -= 3) backward.push(fresh.heightAt(x));
    backward.reverse();

    expect(backward.length).toBe(forward.length);
    for (let i = 0; i < forward.length; i++) {
      expect(backward[i]).toBeCloseTo(forward[i] as number, 6);
    }
  });

  it('survives pruning with identical output', () => {
    // Eviction and regeneration must be invisible; Rewind and easter-egg re-entry
    // both rely on it.
    const t = terrain(31337);
    const before: number[] = [];
    for (let x = 0; x < 8_000; x += 7) before.push(t.heightAt(x));

    t.prune(50_000); // evict everything we just touched
    t.prune(0);

    const after: number[] = [];
    for (let x = 0; x < 8_000; x += 7) after.push(t.heightAt(x));
    expect(after).toEqual(before);
  });

  describe('continuity', () => {
    it('has no vertical discontinuities', () => {
      // A continuous function's step shrinks with the sample step. Any real cliff —
      // a feature shape not returning to zero at its edge, say — shows up as a jump
      // far larger than the slope could account for at this resolution.
      const t = terrain(99);
      const step = 0.25;
      let worst = 0;
      let worstX = 0;
      let previous = t.heightAt(-2_000);
      for (let x = -2_000; x < 20_000; x += step) {
        const current = t.heightAt(x);
        const delta = Math.abs(current - previous);
        if (delta > worst) {
          worst = delta;
          worstX = x;
        }
        previous = current;
      }
      expect(worst, `largest jump ${worst.toFixed(3)}px at x=${worstX}`).toBeLessThan(2);
    });

    it('stays runnable — no near-vertical ground', () => {
      // The player must be able to traverse everything. Ramps are deliberately steep
      // on their trailing face, so this bounds rather than forbids steepness.
      const t = terrain(2024);
      let steepest = 0;
      let steepestX = 0;
      for (let x = 0; x < 30_000; x += 2) {
        const slope = Math.abs(t.slopeAt(x));
        if (slope > steepest) {
          steepest = slope;
          steepestX = x;
        }
      }
      const degrees = (Math.atan(steepest) * 180) / Math.PI;
      expect(degrees, `steepest ${degrees.toFixed(1)}° at x=${steepestX}`).toBeLessThan(75);
    });

    it('opens on calm ground', () => {
      // The first chunk carries no features, so a run never starts mid-ramp.
      const t = terrain(5);
      for (let x = 0; x < CHUNK_WIDTH * 0.9; x += 5) {
        const degrees = (Math.atan(Math.abs(t.slopeAt(x))) * 180) / Math.PI;
        expect(degrees).toBeLessThan(45);
      }
    });
  });

  describe('slopeAt', () => {
    it('agrees with a finite difference of heightAt', () => {
      const t = terrain(8);
      for (let x = 100; x < 4_000; x += 137) {
        const numeric = (t.heightAt(x + 0.05) - t.heightAt(x - 0.05)) / 0.1;
        expect(t.slopeAt(x)).toBeCloseTo(numeric, 1);
      }
    });

    it('signs downhill-to-the-right as positive', () => {
      // Screen space grows downward, so ground falling away to the right has a
      // positive slope. Getting this backwards would invert every landing judgement.
      const t = terrain(11);
      for (let x = 0; x < 3_000; x += 13) {
        const rising = t.heightAt(x + 1) > t.heightAt(x - 1);
        if (Math.abs(t.slopeAt(x)) > 0.05) {
          expect(t.slopeAt(x) > 0).toBe(rising);
        }
      }
    });
  });
});

describe('ChunkField', () => {
  it('generates a chunk identically regardless of visit order', () => {
    // The property Rewind depends on: reaching a chunk from the right must produce
    // what reaching it from the left did.
    const forward = new ChunkField(new Rng(64));
    for (let i = 0; i <= 6; i++) forward.chunk(i);

    const backward = new ChunkField(new Rng(64));
    for (let i = 6; i >= 0; i--) backward.chunk(i);

    for (let i = 0; i <= 6; i++) {
      expect(backward.chunk(i)).toEqual(forward.chunk(i));
    }
  });

  it('regenerates an evicted chunk identically', () => {
    const field = new ChunkField(new Rng(3));
    const original = structuredClone(field.chunk(5));
    field.prune(500_000);
    expect(field.chunk(5)).toEqual(original);
  });

  it('bounds resident chunks while scrolling', () => {
    // Without pruning this map grows for the whole run.
    const field = new ChunkField(new Rng(7));
    for (let x = 0; x < 200_000; x += 300) {
      field.featuresNear(x);
      field.prune(x);
    }
    expect(field.residentCount).toBeLessThan(16);
  });

  it('keeps features inside their own chunk', () => {
    // Features must not straddle a chunk boundary, or the 3-chunk lookup window in
    // featuresNear could miss one and height would depend on where it was sampled.
    const field = new ChunkField(new Rng(21));
    for (let index = 1; index < 40; index++) {
      const chunk = field.chunk(index);
      for (const feature of chunk.features) {
        const half = feature.width / 2;
        expect(chunkIndexAt(feature.x - half)).toBe(index);
        expect(chunkIndexAt(feature.x + half - 0.001)).toBe(index);
      }
    }
  });

  it('does not overlap features within a chunk', () => {
    const field = new ChunkField(new Rng(88));
    for (let index = 1; index < 60; index++) {
      const features = [...field.chunk(index).features].sort((a, b) => a.x - b.x);
      for (let i = 1; i < features.length; i++) {
        const left = features[i - 1] as (typeof features)[number];
        const right = features[i] as (typeof features)[number];
        expect(right.x - right.width / 2).toBeGreaterThanOrEqual(left.x + left.width / 2 - 0.001);
      }
    }
  });
});
