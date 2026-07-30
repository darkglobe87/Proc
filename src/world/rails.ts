/**
 * Rails — the thing you grind.
 *
 * Straight segments floating above the terrain. Straight, not curved, on purpose: the
 * maths stays a line equation while the mechanic (a third movement state that holds speed
 * and builds flow) is delivered in full. Curved rails can come later if they earn it.
 */

import type { Terrain } from './terrain';
import type { RailSpec } from './chunks';

export interface Rail {
  id: number;
  /** Left end. */
  x1: number;
  y1: number;
  /** Right end. */
  x2: number;
  y2: number;
}

/** How close the body angle must be to the rail angle to land a grind, in radians. */
export const RAIL_ANGLE_TOLERANCE = (38 * Math.PI) / 180;
/** Vertical distance within which a descending player snaps onto the rail. */
export const RAIL_SNAP = 12;

export function resolveRail(terrain: Terrain, spec: RailSpec, chunkIndex: number): Rail {
  const x1 = spec.x;
  const x2 = spec.x + spec.length;
  // Anchored to the ground at its start so a rail always sits a readable height above the
  // dune it spans, rather than drifting into the terrain when the ground rises under it.
  const y1 = terrain.heightAt(x1) - spec.clearance;
  return {
    id: chunkIndex * 100_000 + spec.slot * 100,
    x1,
    y1,
    x2,
    y2: y1 + spec.tilt * spec.length,
  };
}

export function railAngle(rail: Rail): number {
  return Math.atan2(rail.y2 - rail.y1, rail.x2 - rail.x1);
}

/** Rail y at an x within its span, or null outside it. */
export function railYAt(rail: Rail, x: number): number | null {
  if (x < rail.x1 || x > rail.x2) return null;
  const t = (x - rail.x1) / (rail.x2 - rail.x1);
  return rail.y1 + (rail.y2 - rail.y1) * t;
}

/**
 * Whether a descending player crosses onto this rail between two positions.
 *
 * Requires downward motion and a crossing from above, so running along underneath a rail
 * never snaps you up onto it.
 */
export function railCrossing(
  rail: Rail,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } | null {
  if (toY < fromY) return null; // rising

  const toRailY = railYAt(rail, toX);
  if (toRailY === null) return null;

  const fromRailY = railYAt(rail, fromX) ?? toRailY;
  const wasAbove = fromY <= fromRailY + RAIL_SNAP;
  const nowBelow = toY >= toRailY;

  if (!wasAbove || !nowBelow) return null;
  return { x: toX, y: toRailY };
}
