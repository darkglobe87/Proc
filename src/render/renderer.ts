/**
 * Style dispatch and the camera transform.
 *
 * The renderer owns nothing about how the game looks — it holds the current
 * {@link RenderStyle}, hands it the scene, and provides the one piece of maths every
 * style needs identically (world → screen). Swapping style is a single assignment,
 * which is what the render-style twists in Milestone 5 rely on.
 */

import type { Viewport } from '../core/viewport';
import type { Palette } from './palette';
import { DUSK } from './palette';
import { ANCHOR_X, ANCHOR_Y } from '../game/camera';
import type { CameraView, Scene } from './scene';

export interface StyleContext {
  ctx: CanvasRenderingContext2D;
  viewport: Viewport;
  palette: Palette;
}

export interface RenderStyle {
  readonly id: string;
  draw(scene: Scene, context: StyleContext): void;
  /** Called when the style is swapped out, to release any offscreen buffers. */
  dispose?(): void;
}

/**
 * Applies the camera to the context. The camera's (x, y) is the world point that
 * appears at the viewport anchor, so the runner keeps a consistent screen position
 * regardless of zoom.
 *
 * Deliberately excludes `rotation` *and* `mirrorX` — see {@link applyScreenTransform}
 * for why both have to be applied separately, as a whole-frame post-process rather
 * than folded into this world-space transform.
 */
export function applyCamera(
  ctx: CanvasRenderingContext2D,
  camera: CameraView,
  width: number,
  height: number,
): void {
  ctx.translate(width * ANCHOR_X, height * ANCHOR_Y);
  if (camera.zoom !== 1) ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
}

/**
 * Rolls and/or mirrors the *entire rendered frame* around the viewport centre — sky
 * and world alike.
 *
 * Neither is folded into {@link applyCamera} on purpose, and for related reasons.
 * Rotation breaks in world-space because several shapes are deliberately drawn
 * asymmetrically — the terrain fill extends far past the bottom edge so it reads as
 * solid ground, with no matching extension above — so rotating that geometry swaps
 * top and bottom and exposes the asymmetry as a gap where the fill never reached.
 *
 * Mirroring breaks for a different but related reason: the camera anchor sits at
 * `ANCHOR_X` (32% across), not screen centre, because the runner needs room ahead to
 * see what's coming. Folding a horizontal flip into that same off-centre transform
 * doesn't just mirror the view, it *shifts* it sideways — a world range that exactly
 * covered the screen when drawn normally lands mostly off to one side once mirrored
 * around a point that isn't the centre, leaving the screen's other edge with nothing
 * drawn on it at all. That is the exact "split screen" Mirror produced before this
 * was moved out of `applyCamera`.
 *
 * Applying both as a post-process on the *already-composited* frame sidesteps both
 * problems at once: whatever was drawn, however far any shape extends and wherever
 * the camera anchor sits, a whole-frame transform around the viewport centre moves
 * it as one rigid image with no seam and no shift.
 *
 * Callers wrap sky *and* world drawing inside this and leave the HUD outside it, for
 * the same reason the HUD ignores camera translation and zoom: it must stay legible
 * regardless of what a twist is doing to the world.
 */
export function applyScreenTransform(
  ctx: CanvasRenderingContext2D,
  camera: CameraView,
  width: number,
  height: number,
): void {
  if (camera.rotation === 0 && !camera.mirrorX) return;
  ctx.translate(width / 2, height / 2);
  if (camera.rotation !== 0) ctx.rotate(camera.rotation);
  if (camera.mirrorX) ctx.scale(-1, 1);
  ctx.translate(-width / 2, -height / 2);
}

/**
 * Inverse of {@link applyCamera} plus {@link applyScreenTransform} together, for
 * hit-testing world positions from screen taps.
 */
export function screenToWorld(
  camera: CameraView,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  // Undo the whole-frame roll/mirror first, since it was the outermost transform.
  let sx = screenX - width / 2;
  let sy = screenY - height / 2;
  if (camera.rotation !== 0) {
    const cos = Math.cos(-camera.rotation);
    const sin = Math.sin(-camera.rotation);
    const rx = sx * cos - sy * sin;
    sy = sx * sin + sy * cos;
    sx = rx;
  }
  if (camera.mirrorX) sx = -sx;
  sx += width / 2;
  sy += height / 2;

  const dx = sx - width * ANCHOR_X;
  const dy = sy - height * ANCHOR_Y;
  return { x: camera.x + dx / camera.zoom, y: camera.y + dy / camera.zoom };
}

export class Renderer {
  palette: Palette = DUSK;

  private active: RenderStyle;

  constructor(
    private readonly viewport: Viewport,
    style: RenderStyle,
  ) {
    this.active = style;
  }

  get style(): RenderStyle {
    return this.active;
  }

  setStyle(style: RenderStyle): void {
    if (style === this.active) return;
    this.active.dispose?.();
    this.active = style;
  }

  render(scene: Scene): void {
    const { ctx } = this.viewport;
    // The transform carries the device-pixel scale; resetting to identity here would
    // undo it, so state is saved and restored around the style instead.
    ctx.save();
    this.active.draw(scene, {
      ctx,
      viewport: this.viewport,
      palette: this.palette,
    });
    ctx.restore();
  }
}
