/**
 * Decor — scenery with no rules attached.
 *
 * Ground-standing silhouettes (rocks, spires, ruined pillars) with nothing to say about
 * fairness or collision: there is nothing to dodge, so there is nothing to get wrong.
 * Placement only has to look right, which is a much smaller job than the runner's old
 * obstacle system had, where the same shapes were hazards and generation had to prove a
 * jump could always clear them.
 */

import type { Terrain } from './terrain';
import type { DecorSpec } from './chunks';

export interface Decor {
  id: number;
  /** Centre x. */
  x: number;
  /** Ground y at the base — the shape rises from here toward smaller y. */
  y: number;
  width: number;
  height: number;
  variant: number;
}

/** Anchors a spec to the ground beneath it. Always succeeds — nothing here to reject. */
export function resolveDecor(terrain: Terrain, spec: DecorSpec, chunkIndex: number): Decor {
  return {
    id: chunkIndex * 100_000 + spec.slot * 100,
    x: spec.x,
    y: terrain.heightAt(spec.x),
    width: spec.width,
    height: spec.height,
    variant: spec.variant,
  };
}
