/**
 * Obstacles — the hazard.
 *
 * Ground-standing silhouettes that end a run on contact. Their fairness comes from
 * generation (`chunks.ts` keeps them out of ramp landing zones and spaces them apart),
 * so this module only has to resolve a spec onto the ground and answer collision.
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

export function resolveObstacle(
  terrain: Terrain,
  spec: ObstacleSpec,
  chunkIndex: number,
): Obstacle {
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
