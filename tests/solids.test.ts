import { describe, expect, it } from 'vitest';
import { groundFollowAt, resolveHorizontal, sweepVertical, type Solid } from '../src/world/solids';
import type { Terrain } from '../src/world/terrain';

const HALF = 9;
const HEIGHT = 30;

function box(overrides: Partial<Solid> = {}): Solid {
  return { id: 1, x: 100, y: 200, width: 60, height: 12, kind: 'solid', ...overrides };
}

/** A fake `Terrain` — sweepVertical only ever calls `heightAt`. */
function terrainOf(heightAt: (x: number) => number): Terrain {
  return { heightAt } as unknown as Terrain;
}

function flat(height: number): Terrain {
  return terrainOf(() => height);
}

describe('resolveHorizontal', () => {
  it('passes through when nothing is in the way', () => {
    const result = resolveHorizontal([], 0, 0, HALF, HEIGHT, 40);
    expect(result).toEqual({ x: 40, blocked: false });
  });

  it('never blocks on a one-way platform — only solids do', () => {
    const oneway = box({ kind: 'oneway' });
    const result = resolveHorizontal([oneway], 40, 200, HALF, HEIGHT, 40);
    expect(result.blocked).toBe(false);
  });

  it('stops at the left face of a solid when moving right', () => {
    const solid = box(); // spans x=70..130 at y in [188, 200]
    const result = resolveHorizontal([solid], 0, 195, HALF, HEIGHT, 100);
    expect(result.blocked).toBe(true);
    expect(result.x).toBeCloseTo(70 - HALF, 6);
  });

  it('stops at the right face of a solid when moving left', () => {
    const solid = box();
    const result = resolveHorizontal([solid], 200, 195, HALF, HEIGHT, -100);
    expect(result.blocked).toBe(true);
    expect(result.x).toBeCloseTo(130 + HALF, 6);
  });

  it('ignores a solid the body does not vertically overlap', () => {
    const solid = box({ y: 1000 }); // far below the body's span
    const result = resolveHorizontal([solid], 0, 195, HALF, HEIGHT, 100);
    expect(result.blocked).toBe(false);
    expect(result.x).toBe(100);
  });
});

describe('sweepVertical', () => {
  it('lands on the terrain when falling through it', () => {
    const result = sweepVertical(flat(20), [], HALF, 0, 0, 0, 50);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(20);
  });

  it('does not ground a body that never reaches the terrain', () => {
    const result = sweepVertical(flat(200), [], HALF, 0, 0, 0, 5);
    expect(result.grounded).toBe(false);
    expect(result.y).toBe(5);
  });

  it('lands on a one-way platform when falling onto it from above', () => {
    const oneway = box({ kind: 'oneway', y: 100, height: 10 }); // top at y=90
    const result = sweepVertical(flat(999), [oneway], HALF, 100, 80, 100, 120);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(90);
  });

  it('passes through a one-way platform when rising into it from below', () => {
    const oneway = box({ kind: 'oneway', y: 100, height: 10 });
    const result = sweepVertical(flat(999), [oneway], HALF, 100, 120, 100, 80);
    expect(result.grounded).toBe(false);
    expect(result.bonked).toBe(false);
    expect(result.y).toBe(80);
  });

  it('never catches a one-way platform when already below it and falling further', () => {
    // "Was above, now below" must be judged from where the body started, not just
    // whether it ends up below — otherwise walking out from underneath one would
    // snap the body up onto it the instant it starts to fall.
    const oneway = box({ kind: 'oneway', y: 100, height: 10 }); // top at 90
    const result = sweepVertical(flat(999), [oneway], HALF, 100, 150, 100, 200);
    expect(result.grounded).toBe(false);
  });

  it('bonks on the underside of a solid when rising into it', () => {
    const solid = box({ kind: 'solid', y: 100, height: 10 }); // underside at y=100
    const result = sweepVertical(flat(999), [solid], HALF, 100, 130, 100, 60);
    expect(result.bonked).toBe(true);
    expect(result.y).toBe(100);
  });

  it('prefers the first surface crossed when several are in range', () => {
    // A closer, higher platform must win over the terrain far beneath it.
    const oneway = box({ kind: 'oneway', y: 50, height: 10 }); // top at 40
    const result = sweepVertical(flat(500), [oneway], HALF, 100, 0, 100, 200);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(40);
  });

  it('resolves immediately when already penetrating the terrain at the start', () => {
    const result = sweepVertical(flat(20), [], HALF, 0, 25, 0, 40);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(20);
  });

  /**
   * Regression test for a real bug found in play: falling landed cleanly thousands
   * of times, then one fall tunnelled straight through the ground and free-fell
   * forever. The original implementation compared `toY` against a single
   * `terrainHeight` sampled only at the final x — correct for flat ground, but wrong
   * whenever the ground under the *end* of a step differs from the ground under
   * where the crossing actually happened, which any slope does to some degree every
   * step. Once one fall was judged "still above ground" by one step too many, `y` was
   * left below the surface, and the next step's guard — "was above the ground at the
   * start" — could never be true again, since `y` only grows deeper from there: the
   * single missed frame became a permanent one.
   *
   * This terrain makes that failure obvious rather than a narrow numeric coincidence:
   * a small ledge for the first 10px of x, then a floor so far down it may as well not
   * exist. A real crossing happens almost immediately, onto the ledge — but an
   * endpoint-only check, sampling only the terrain under the *end* of this single big
   * fall, would compare against the distant floor and conclude nothing had been
   * crossed at all.
   */
  it('catches an early landing instead of tunnelling through to a much lower endpoint sample', () => {
    const terrain = terrainOf((x) => (x <= 10 ? 0 : 1000));
    // One big step, the kind a fast fall combined with horizontal speed produces —
    // arriving far to the right and far down, well past the small ledge near the start.
    const result = sweepVertical(terrain, [], HALF, 0, -5, 100, 800);
    expect(result.grounded).toBe(true);
    expect(result.y).toBeCloseTo(0, 0); // landed on the ledge, not fallen past it
  });
});

describe('groundFollowAt', () => {
  it('follows the terrain when no ledge is nearby', () => {
    const result = groundFollowAt([], 0, HALF, 20, 24);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(24);
  });

  it('becomes unsupported when the terrain is far below and nothing else is close', () => {
    const result = groundFollowAt([], 0, HALF, 20, 500);
    expect(result.grounded).toBe(false);
  });

  it('prefers a ledge the body is already resting on over distant terrain', () => {
    const ledge = box({ kind: 'oneway', x: 0, y: 100, height: 10, width: 60 }); // top at 90
    const result = groundFollowAt([ledge], 0, HALF, 90, 1000);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(90);
  });

  it('drops the ledge once the body has stepped past its horizontal span', () => {
    const ledge = box({ kind: 'oneway', x: 0, y: 100, height: 10, width: 60 }); // spans -30..30
    const result = groundFollowAt([ledge], 40, HALF, 90, 1000);
    expect(result.grounded).toBe(false);
  });

  it('does not snap onto a ledge far from the body’s current height', () => {
    const ledge = box({ kind: 'oneway', x: 0, y: 100, height: 10, width: 60 }); // top at 90
    // Body is standing on the ground, far above this ledge's height.
    const result = groundFollowAt([ledge], 0, HALF, -400, -400);
    expect(result.grounded).toBe(true);
    expect(result.y).toBe(-400); // the terrain, not the distant ledge
  });
});
