/**
 * Solids — the second collision layer.
 *
 * `Terrain.heightAt(x)` is single-valued: exactly one ground height per x. That is
 * exactly right for the natural dune landscape and cannot express a ledge, an
 * overhang or a room — anything *built*, where more than one surface can exist at the
 * same x. Rather than replace the heightfield (and the dune silhouette it produces)
 * with a tile grid, built structure is a second, independent layer of boxes that the
 * player resolves against in the same step as the terrain.
 *
 * Resolution is axis-separated — x first, then y — which is the standard platformer
 * order and the reason a flush ledge does not snag a corner: horizontal motion is
 * settled before vertical motion ever runs, so a body sliding past a box cannot catch
 * on the seam where its top meets its side.
 */

import type { Terrain } from './terrain';
import type { LedgeSpec } from './chunks';

export interface Solid {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * 'oneway' is passable from below and standable from above — ledges, scaffolds.
   * 'solid' blocks from every side.
   */
  kind: 'solid' | 'oneway';
}

function left(solid: Solid): number {
  return solid.x - solid.width / 2;
}

function right(solid: Solid): number {
  return solid.x + solid.width / 2;
}

function top(solid: Solid): number {
  return solid.y - solid.height;
}

function bottom(solid: Solid): number {
  return solid.y;
}

/**
 * Resolves a ledge spec onto the ground beneath its centre.
 *
 * Anchored to the terrain at its centre rather than its left edge, unlike the old
 * rail's anchor at `x1` — a ledge is stood *on*, not grazed at a shallow angle, so
 * keeping it level with the ground at its middle is what stops a long ledge over a dip
 * from reading as tilted relative to the dune underneath it.
 */
export function resolveLedge(terrain: Terrain, spec: LedgeSpec, chunkIndex: number): Solid {
  const y = terrain.heightAt(spec.x + spec.width / 2) - spec.clearance;
  return {
    id: chunkIndex * 100_000 + spec.slot * 100,
    x: spec.x + spec.width / 2,
    y: y + spec.thickness,
    width: spec.width,
    height: spec.thickness,
    kind: 'oneway',
  };
}

/**
 * Resolves horizontal motion against every `solid`-kind box in the way.
 *
 * `oneway` platforms never block horizontally — the standard platformer convention,
 * since a scaffold you can stand on top of would otherwise be an invisible wall to
 * anyone approaching from the side.
 *
 * @param bodyY the body's vertical span *before* this step's vertical resolution —
 *   horizontal always runs first, so this is simply the position it is still at.
 */
export function resolveHorizontal(
  solids: readonly Solid[],
  bodyX: number,
  bodyY: number,
  halfWidth: number,
  bodyHeight: number,
  dx: number,
): { x: number; blocked: boolean } {
  if (dx === 0) return { x: bodyX, blocked: false };

  const bodyTop = bodyY - bodyHeight;
  const bodyBottom = bodyY;
  let travel = dx;
  let blocked = false;
  const nextX = bodyX + dx;

  for (const solid of solids) {
    if (solid.kind !== 'solid') continue;
    // Vertical overlap test against the body's span before this step's horizontal move.
    if (bodyTop >= bottom(solid) || bodyBottom <= top(solid)) continue;

    if (dx > 0 && bodyX <= left(solid) && nextX + halfWidth > left(solid)) {
      const limit = left(solid) - halfWidth - bodyX;
      if (limit < travel) {
        travel = limit;
        blocked = true;
      }
    } else if (dx < 0 && bodyX >= right(solid) && nextX - halfWidth < right(solid)) {
      const limit = right(solid) + halfWidth - bodyX;
      if (limit > travel) {
        travel = limit;
        blocked = true;
      }
    }
  }

  return { x: bodyX + travel, blocked };
}

export interface SweepResult {
  y: number;
  grounded: boolean;
  /** Hit the underside of a solid while rising — a ceiling. */
  bonked: boolean;
}

/** Horizontal/vertical distance per sweep sample. */
const SAMPLE_PX = 6;
/** Bisection passes once a crossing is bracketed. Six gives sub-pixel accuracy. */
const REFINE_STEPS = 6;
/**
 * How far below a surface counts as genuinely underground at the *start* of a sweep.
 *
 * Essential, not defensive: a jump or a fall off an edge begins with the body standing
 * exactly on a surface, so an inclusive test would report contact on the first sample
 * of every flight and slam it straight back down. Only real penetration — a
 * teleporting twist, a bad spawn — should short-circuit the sweep.
 */
const SURFACE_EPSILON = 0.5;

/**
 * Sweeps a fall or rise from `(fromX, fromY)` to `(toX, toY)`, for the **airborne**
 * state.
 *
 * This samples terrain height *along the path*, not just at the endpoints. That
 * distinction matters: gravity and horizontal speed can both move the body a large
 * distance in one step, and the terrain is not flat, so the ground under the body at
 * the end of a step can be metres away from the ground under it at the start. Comparing
 * `toY` against a single `terrainHeight` sampled only at the final x is exactly the kind
 * of shortcut that reads as "still airborne" for one step too many on any real slope —
 * the body tunnels a little further underground than the surface it just crossed, and
 * every later step is judged against the *next* x's terrain, whose height has no reason
 * to agree, so contact is never detected again and the fall never ends. Sampling every
 * {@link SAMPLE_PX} along the actual path and bisecting the first bracketed crossing
 * (the same technique the terrain-only runner used) is what makes that impossible: the
 * ground actually under the body is what gets checked, every few pixels of the way.
 *
 * One-way tops and solid undersides are checked at the same samples, so whichever
 * surface — terrain, a ledge, a ceiling — is physically crossed first along the path
 * is the one that wins, with no special-casing between them.
 */
export function sweepVertical(
  terrain: Terrain,
  solids: readonly Solid[],
  halfWidth: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): SweepResult {
  const rising = toY < fromY;
  const falling = toY > fromY;

  // Genuinely below ground at the start — resolve immediately rather than sweeping
  // forward from an already-impossible position. See SURFACE_EPSILON for why this is
  // not `>=`.
  const startTerrain = terrain.heightAt(fromX);
  if (fromY > startTerrain + SURFACE_EPSILON) {
    return { y: startTerrain, grounded: true, bonked: false };
  }

  const span = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  const steps = Math.max(1, Math.ceil(span / SAMPLE_PX));

  const at = (t: number): { x: number; y: number } => ({
    x: fromX + (toX - fromX) * t,
    y: fromY + (toY - fromY) * t,
  });

  /** Bisects the crossing bracketed between `lo` and `hi`, and returns its t. */
  const refine = (lo: number, hi: number, crossed: (t: number) => boolean): number => {
    let low = lo;
    let high = hi;
    for (let step = 0; step < REFINE_STEPS; step++) {
      const mid = (low + high) / 2;
      if (crossed(mid)) high = mid;
      else low = mid;
    }
    return high;
  };

  let previousT = 0;
  let previousY = fromY;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const { x, y } = at(t);

    if (falling) {
      const th = terrain.heightAt(x);
      if (y >= th) {
        const hit = refine(previousT, t, (mt) => {
          const p = at(mt);
          return p.y >= terrain.heightAt(p.x);
        });
        const cx = at(hit).x;
        return { y: terrain.heightAt(cx), grounded: true, bonked: false };
      }
    }

    for (const solid of solids) {
      if (x + halfWidth <= left(solid) || x - halfWidth >= right(solid)) continue;

      if (falling) {
        const surface = top(solid);
        if (previousY <= surface + 0.5 && y >= surface) {
          return { y: surface, grounded: true, bonked: false };
        }
      } else if (rising && solid.kind === 'solid') {
        const underside = bottom(solid);
        if (previousY >= underside - 0.5 && y <= underside) {
          return { y: underside, grounded: false, bonked: true };
        }
      }
    }

    previousT = t;
    previousY = y;
  }

  return { y: toY, grounded: false, bonked: false };
}

/** How far above or below the current stance a ledge may sit and still hold the player. */
const LEDGE_TOLERANCE = 24;
/** How far the ground may step per frame and still count as "still standing on it". */
const MAX_GROUND_STEP = 30;

/**
 * Finds what continues to support an already-**grounded** body this frame, once
 * horizontal motion has been applied.
 *
 * Deliberately not a sweep: the heightfield has no gaps, so following ordinary terrain
 * is just "go to `heightAt(x)`" — no crossing test needed. The one thing that check
 * alone would get wrong is a one-way ledge: without this, walking along one would
 * read as falling toward the terrain far beneath it every single frame. So a ledge the
 * body was already resting near, and still overlaps horizontally, is preferred over
 * the terrain below it; stepping past either its edge or {@link MAX_GROUND_STEP} of it
 * returns `grounded: false`, which the caller reads as "start falling", not a teleport
 * down to whatever is under you.
 */
export function groundFollowAt(
  solids: readonly Solid[],
  bodyX: number,
  halfWidth: number,
  currentY: number,
  terrainHeight: number,
): { y: number; grounded: boolean } {
  const bodyLeft = bodyX - halfWidth;
  const bodyRight = bodyX + halfWidth;
  for (const solid of solids) {
    if (bodyRight <= left(solid) || bodyLeft >= right(solid)) continue;
    if (solid.kind === 'oneway' || solid.kind === 'solid') {
      const surface = top(solid);
      if (Math.abs(currentY - surface) <= LEDGE_TOLERANCE) {
        return { y: surface, grounded: true };
      }
    }
  }

  if (Math.abs(currentY - terrainHeight) <= MAX_GROUND_STEP) {
    return { y: terrainHeight, grounded: true };
  }

  return { y: currentY, grounded: false };
}
