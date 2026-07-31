/**
 * Obstacles — the hazard.
 *
 * Ground-standing silhouettes that end a run on contact. Their fairness comes from
 * generation (`chunks.ts` keeps them out of ramp landing zones and spaces them apart)
 * and from resolution here: `chunks.ts` has no access to the terrain (it only ever
 * sees this chunk's own features, never the base dune curve or a neighbour's), so the
 * slope at a candidate x can only be checked once `Terrain` is available — the same
 * reason `chimes.ts`'s `arcLaunch` rejects candidates at resolve time rather than at
 * generation time.
 */

import type { Terrain } from './terrain';
import type { ObstacleSpec } from './chunks';

export interface Obstacle {
  id: number;
  /** Centre x. */
  x: number;
  /** Ground y at the base — the obstacle rises from here toward smaller y. */
  y: number;
  width: number;
  height: number;
  variant: number;
}

/**
 * Slope beyond which ground counts as "uphill" for obstacle placement.
 *
 * Clearing an obstacle means outrunning your own jump arc, and running uphill eats
 * into that margin on the far side — the rising ground meets the arc earlier than it
 * would on flat or falling ground, so the same jump that clears an obstacle on flat
 * ground can fall short on a rise. Sampling shows roughly a quarter of the terrain
 * sits beyond this threshold, so it excludes the stretches where that effect is
 * pronounced without making obstacles rare.
 */
export const UPHILL_SLOPE_LIMIT = 0.15;

/**
 * Resolves a spec onto the ground, or returns null to skip it entirely.
 *
 * A rejected obstacle is not retried at a different x: `chunks.ts` already spends a
 * bounded number of attempts choosing candidates with no notion of slope, so some
 * chunks simply end up with fewer obstacles than requested — quieter chunks are a
 * fine outcome, an unfairly hard one is not.
 */
export function resolveObstacle(
  terrain: Terrain,
  spec: ObstacleSpec,
  chunkIndex: number,
): Obstacle | null {
  // Negative slope is ground rising to the right — see Terrain.slopeAt.
  if (terrain.slopeAt(spec.x) < -UPHILL_SLOPE_LIMIT) return null;

  return {
    id: chunkIndex * 100_000 + spec.slot * 100,
    x: spec.x,
    y: terrain.heightAt(spec.x),
    width: spec.width,
    height: spec.height,
    variant: spec.variant,
  };
}

/**
 * Circle-versus-box overlap.
 *
 * The hit box is inset slightly against the drawn silhouette. A hazard that kills a pixel
 * before it visibly touches you feels broken and unfair, whereas the reverse goes
 * unnoticed — so the generosity is deliberate and one-directional.
 */
const FORGIVENESS = 3;

export function hitsObstacle(
  obstacle: Obstacle,
  circleX: number,
  circleY: number,
  radius: number,
): boolean {
  const halfWidth = Math.max(1, obstacle.width / 2 - FORGIVENESS);
  const top = obstacle.y - obstacle.height + FORGIVENESS;

  // Nearest point on the box to the circle centre.
  const nearestX = Math.max(obstacle.x - halfWidth, Math.min(circleX, obstacle.x + halfWidth));
  const nearestY = Math.max(top, Math.min(circleY, obstacle.y));

  const dx = circleX - nearestX;
  const dy = circleY - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Distance from a point to an obstacle's box, used to credit near-misses to flow.
 * Returns 0 when overlapping.
 */
export function distanceToObstacle(obstacle: Obstacle, x: number, y: number): number {
  const halfWidth = obstacle.width / 2;
  const top = obstacle.y - obstacle.height;
  const dx = Math.max(obstacle.x - halfWidth - x, 0, x - (obstacle.x + halfWidth));
  const dy = Math.max(top - y, 0, y - obstacle.y);
  return Math.hypot(dx, dy);
}
