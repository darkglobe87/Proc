/**
 * Camera.
 *
 * Carries `zoom` and `rotation` from the outset even though this milestone only moves
 * x and y, so twists that animate them need no refactor later — they just write
 * fields that already exist and are already honoured by the transform.
 *
 * Both axes now use a dead zone plus easing, not just the vertical one the runner
 * used: the player can stop, back up and turn around, so the horizontal camera can no
 * longer be rigidly locked to their x the way an always-forward runner's could be —
 * rigid tracking would slam the frame sideways the instant they reversed direction.
 */

import type { CameraView } from '../render/scene';

/** Where the followed point sits on screen, as fractions of the viewport. */
export const ANCHOR_X = 0.32;
export const ANCHOR_Y = 0.58;

/** Easing, in fraction-per-second toward the target, once outside the dead zone. */
const EASE = 6;
/** Look-ahead in pixels in the direction faced, revealing what's ahead of a turn. */
const LOOK_AHEAD = 90;
/** How far the player may drift from the anchor, either axis, before the camera reacts. */
const DEADZONE_X = 60;
const DEADZONE_Y = 70;

/**
 * The continuous render knobs a twist may bend. Owned here, next to the camera fields
 * they end up written onto, for the same reason `PhysicsModifiers` lives in player.ts:
 * the consumer defines the shape, and twists import it — never the other way round.
 */
export interface RenderModifiers {
  /** Camera roll, radians. */
  rotation: number;
  /** Horizontal mirror of world-space rendering. */
  mirrorX: boolean;
}

export const DEFAULT_RENDER_MODIFIERS: Readonly<RenderModifiers> = {
  rotation: 0,
  mirrorX: false,
};

export class Camera implements CameraView {
  x = 0;
  y = 0;
  zoom = 1;
  rotation = 0;
  /** Set each frame from the active twists' render fold; not owned by `follow()`. */
  mirrorX = false;

  /** Set true after a teleport so the next update snaps instead of easing. */
  private snapNext = true;

  snap(): void {
    this.snapNext = true;
  }

  /**
   * @param targetX  Player world x.
   * @param targetY  Player world y.
   * @param facing   Direction faced, ±1 — drives which way the look-ahead leans.
   */
  follow(targetX: number, targetY: number, facing: 1 | -1, dt: number): void {
    const desiredX = targetX + LOOK_AHEAD * facing;

    if (this.snapNext) {
      this.x = desiredX;
      this.y = targetY;
      this.snapNext = false;
      return;
    }

    const offsetX = desiredX - this.x;
    if (Math.abs(offsetX) > DEADZONE_X) {
      const excess = offsetX > 0 ? offsetX - DEADZONE_X : offsetX + DEADZONE_X;
      this.x += excess * Math.min(1, EASE * dt);
    }

    const offsetY = targetY - this.y;
    if (Math.abs(offsetY) > DEADZONE_Y) {
      const excess = offsetY > 0 ? offsetY - DEADZONE_Y : offsetY + DEADZONE_Y;
      this.y += excess * Math.min(1, EASE * dt);
    }
  }
}
