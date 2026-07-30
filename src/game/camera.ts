/**
 * Camera.
 *
 * Carries `zoom` and `rotation` from the outset even though this milestone only moves
 * x and y, so the Zoom Out and Slow Rotate twists need no refactor later — they just
 * animate fields that already exist and are already honoured by the transform.
 *
 * Vertical motion is eased rather than rigid. Locking y to the player makes the whole
 * horizon pump up and down over every dune, which is both ugly and nauseating; easing
 * lets the player move within the frame while the world stays level.
 */

import type { CameraView } from '../render/scene';

/** Where the followed point sits on screen, as fractions of the viewport. */
export const ANCHOR_X = 0.32;
export const ANCHOR_Y = 0.58;

/** Vertical easing, in fraction-per-second toward the target. */
const Y_EASE = 5.5;
/** Look-ahead in pixels at full speed, so faster running reveals more ground. */
const LOOK_AHEAD = 130;
/** How far the player may drift from the anchor before y is pulled harder. */
const Y_DEADZONE = 70;

export class Camera implements CameraView {
  x = 0;
  y = 0;
  zoom = 1;
  rotation = 0;

  /** Set true after a teleport so the next update snaps instead of easing. */
  private snapNext = true;

  snap(): void {
    this.snapNext = true;
  }

  /**
   * @param targetX  Player world x.
   * @param targetY  Player world y.
   * @param speedRatio 0..1 of maximum speed, driving look-ahead.
   */
  follow(targetX: number, targetY: number, speedRatio: number, dt: number): void {
    const desiredX = targetX + LOOK_AHEAD * speedRatio;

    if (this.snapNext) {
      this.x = desiredX;
      this.y = targetY;
      this.snapNext = false;
      return;
    }

    // Horizontal tracking is rigid: the runner must not slide around the frame, or
    // judging an approaching gap becomes guesswork.
    this.x = desiredX;

    // Vertical uses a dead zone plus easing. Inside the dead zone the camera holds
    // still, so small dune undulations do not move the horizon at all.
    const offset = targetY - this.y;
    if (Math.abs(offset) > Y_DEADZONE) {
      const excess = offset > 0 ? offset - Y_DEADZONE : offset + Y_DEADZONE;
      this.y += excess * Math.min(1, Y_EASE * dt);
    }
  }
}
