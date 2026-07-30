/**
 * Chimes — the collectible.
 *
 * Not coins scattered on the ground: arcs of motes that trace the trajectory the player
 * is about to fly. Following an arc *is* the correct line, so the collectible teaches the
 * terrain rather than decorating it.
 *
 * Each chime carries a scale degree that rises along the arc, so collecting a full arc
 * plays an ascending run. That single field is what Milestone 6's composer consumes —
 * collecting becomes playing the music.
 */

import type { Terrain } from './terrain';
import type { ChimeArcSpec } from './chunks';
import { JUMP_MODEL, cruiseSpeedAt } from '../player/player';

export interface Chime {
  /** Stable across chunk eviction, so a regenerated chunk cannot resurrect a pickup. */
  id: number;
  x: number;
  y: number;
  /** Scale degree, ascending along the arc. Mapped to a pitch by the audio engine. */
  pitch: number;
  /** Position within its arc, and the arc's length, for scoring a full collect. */
  index: number;
  total: number;
}

/**
 * Collection radius. Generous on purpose: chimes reward taking the line, they do not test
 * precision. It also has to absorb the fact that the player's actual speed varies with
 * slope and landing boosts, so their real trajectory drifts from the modelled arc.
 */
export const CHIME_RADIUS = 24;

/** Integration step for arc generation. Matches the simulation's fixed step. */
const DT = 1 / 60;
/** Hard cap on integration, so a pathological case cannot spin forever. */
const MAX_STEPS = 400;

/** How far forward to look for a launch point. */
const LAUNCH_SEARCH = 320;
/** Slope beyond which a jump's arc no longer resembles the modelled one. */
const MAX_LAUNCH_SLOPE = 0.28;
/** An arc needs at least this many integration points to be worth placing. */
const MIN_PATH_POINTS = 10;
/**
 * Clear run-up required before a launch point, free of any curvature that could throw the
 * player into the air.
 *
 * The player's speed varies by tens of percent with slope and landing boosts, so exactly
 * *predicting* where they will be grounded is not possible. Instead placement is made
 * conservative: a corridor that cannot launch even a player at full speed is grounded for a
 * player at any speed.
 *
 * Sized to exceed the longest flight a natural launch can produce. A shorter window lets a
 * crest just outside it put the player airborne across the entire arc — which is precisely
 * the bug this constant exists to prevent.
 */
const CLEAR_RUN_UP = 480;

/**
 * Where an arc launches from, or null if there is nowhere suitable near the hint.
 *
 * The spec's anchor is only a hint, since `chunks.ts` cannot see the terrain. The subtle
 * failure is one that no amount of inspecting the anchor can reveal: a crest a few hundred
 * pixels earlier can have the player airborne across the arc's entire span, so the jump it
 * depicts never happens and the arc hangs in the air untouchable.
 *
 * So a launch point must be calm ground *with a clear approach*, tested against the
 * player's maximum speed rather than their expected one — a corridor that cannot launch the
 * fastest possible player is standable at any speed. Many hints are rejected; that is
 * intended, and why `chunks.ts` offers several per chunk.
 *
 * Arcs tracing terrain-driven launches were tried and dropped: departure velocity there is
 * proportional to speed, so the shape changes with how the player arrives, and no fixed arc
 * can depict it honestly.
 */
export function arcLaunch(terrain: Terrain, spec: ChimeArcSpec): number | null {
  const { gravity, maxSpeed } = JUMP_MODEL;

  const couldLaunch = (x: number): boolean => {
    const curvature = terrain.curvatureAt(x);
    return curvature > 0 && maxSpeed * maxSpeed * curvature > gravity;
  };

  for (let x = spec.x; x <= spec.x + LAUNCH_SEARCH; x += 8) {
    if (Math.abs(terrain.slopeAt(x)) > MAX_LAUNCH_SLOPE) continue;
    if (couldLaunch(x)) continue;

    let clear = true;
    for (let back = 8; back <= CLEAR_RUN_UP; back += 8) {
      if (couldLaunch(x - back)) {
        clear = false;
        break;
      }
    }
    if (clear) return x;
  }

  return null;
}

/**
 * Builds one arc by **integrating the real jump**.
 *
 * The arc is not an approximate parabola — it replays the same vertical integration the
 * player performs for a fully-held jump, including the reduced gravity during the hold
 * window. Generating it any other way means the arc and the physics can silently drift
 * apart, and the whole point of a chime arc is that flying it works.
 */
export function buildArc(terrain: Terrain, spec: ChimeArcSpec, chunkIndex: number): Chime[] {
  const launchX = arcLaunch(terrain, spec);
  if (launchX === null) return [];
  const speed = cruiseSpeedAt(launchX);
  const { gravity, jumpVelocity, holdGravityScale, maxHoldSeconds } = JUMP_MODEL;

  let x = launchX;
  let y = terrain.heightAt(x);
  let vy = jumpVelocity;
  let elapsed = 0;

  // Trace the flight, keeping the points for later sampling.
  const path: Array<{ x: number; y: number }> = [{ x, y }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const floating = vy < 0 && elapsed < maxHoldSeconds;
    vy += gravity * (floating ? holdGravityScale : 1) * DT;
    y += vy * DT;
    x += speed * DT;
    elapsed += DT;
    path.push({ x, y });
    // Meeting the ground ends the flight. Checked regardless of whether the arc is still
    // rising, because ground climbing into the arc ends it just as surely as landing does —
    // and continuing past that point would bury chimes inside the dune.
    if (step > 1 && y >= terrain.heightAt(x)) break;
  }

  // Too little air to hang an arc on — better nothing than a cluster of chimes crammed
  // into a couple of pixels.
  if (path.length < MIN_PATH_POINTS) return [];

  // Sample the middle of the flight rather than all of it.
  //
  // Two reasons, both about robustness. The player's real speed differs from the modelled
  // cruise, and that error integrates over time — so positions near the ends of a long
  // flight drift furthest. And near the apex vertical velocity passes through zero, making
  // height barely sensitive to *when* the player arrives. The apex region is simply where a
  // static arc and a variable-speed player agree best. It also keeps chimes clear of the
  // ground at both ends, where they could be swept up just by running past.
  const chimes: Chime[] = [];
  const total = spec.count;
  const from = 0.28;
  const to = 0.72;
  for (let i = 0; i < total; i++) {
    const t = total === 1 ? 0.5 : from + ((to - from) * i) / (total - 1);
    const point = path[Math.min(path.length - 1, Math.round(t * (path.length - 1)))];
    if (!point) continue;
    chimes.push({
      id: chunkIndex * 100_000 + spec.slot * 100 + i,
      x: point.x,
      y: point.y,
      // Rising scale degrees; the octave wrap keeps long arcs singable.
      pitch: i % 8,
      index: i,
      total,
    });
  }
  return chimes;
}
