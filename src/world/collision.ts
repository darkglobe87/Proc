/**
 * Ground contact.
 *
 * A fixed 60 Hz step at 600 px/s advances 10 px, and a fast dive adds far more
 * vertically — enough to pass straight through a crest between two samples. So flight
 * is swept rather than point-tested: the path is subdivided, the first crossing found,
 * then bisected to a precise contact point.
 *
 * Tunnelling is not a cosmetic bug here. Passing through terrain puts the player under
 * the ground, where every subsequent test also fails, and the run is unrecoverable.
 */

import type { Terrain } from './terrain';

export interface GroundContact {
  /** World x where the player met the ground. */
  x: number;
  /** Ground y at that point. */
  y: number;
  /** Surface slope there, for judging the landing. */
  slope: number;
  /** Fraction along the swept segment, 0..1. */
  t: number;
}

/** Horizontal distance per sweep sample. */
const SAMPLE_PX = 6;
/** Bisection passes once a crossing is bracketed. Six gives sub-pixel accuracy. */
const REFINE_STEPS = 6;
/**
 * How far below the surface counts as genuinely underground.
 *
 * This tolerance is essential, not defensive: a jump or a crest launch begins with the
 * player standing *exactly* on the surface, so an inclusive test would report contact
 * on the first sweep of every flight and slam them straight back down. Only a real
 * penetration — from a teleporting twist, say — should short-circuit the sweep.
 */
const SURFACE_EPSILON = 0.5;

/**
 * Finds where the segment from (fromX, fromY) to (toX, toY) first meets the ground.
 * Returns null if the whole segment stays above it.
 */
export function sweepToGround(
  terrain: Terrain,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): GroundContact | null {
  // Genuinely below ground at the start — a teleporting twist, or a bad spawn. Resolve
  // immediately rather than sweeping. See SURFACE_EPSILON for why this is not `>=`.
  if (fromY > terrain.heightAt(fromX) + SURFACE_EPSILON) {
    return { x: fromX, y: terrain.heightAt(fromX), slope: terrain.slopeAt(fromX), t: 0 };
  }

  const span = Math.abs(toX - fromX);
  const steps = Math.max(1, Math.ceil(span / SAMPLE_PX));

  let previousT = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;

    if (y >= terrain.heightAt(x)) {
      // Bracketed between previousT (above) and t (below or touching).
      let lo = previousT;
      let hi = t;
      for (let step = 0; step < REFINE_STEPS; step++) {
        const mid = (lo + hi) / 2;
        const midX = fromX + (toX - fromX) * mid;
        const midY = fromY + (toY - fromY) * mid;
        if (midY >= terrain.heightAt(midX)) hi = mid;
        else lo = mid;
      }
      const contactX = fromX + (toX - fromX) * hi;
      return {
        x: contactX,
        y: terrain.heightAt(contactX),
        slope: terrain.slopeAt(contactX),
        t: hi,
      };
    }
    previousT = t;
  }

  return null;
}
