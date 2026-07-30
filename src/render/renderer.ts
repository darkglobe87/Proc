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
 * Deliberately excludes `rotation` — see {@link applyScreenRotation} for why that
 * one component of the camera has to be applied separately, as a whole-frame
 * post-process rather than a world-space transform.
 */
export function applyCamera(
  ctx: CanvasRenderingContext2D,
  camera: CameraView,
  width: number,
  height: number,
): void {
  ctx.translate(width * ANCHOR_X, height * ANCHOR_Y);
  const mirror = camera.mirrorX ? -1 : 1;
  if (camera.zoom !== 1 || mirror !== 1) ctx.scale(camera.zoom * mirror, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
}

/**
 * Rolls the *entire rendered frame* around the viewport centre — sky and world alike.
 *
 * This is not folded into {@link applyCamera} on purpose. Several world shapes are
 * deliberately drawn asymmetrically: the terrain fill, for one, extends far past the
 * bottom edge so it reads as solid ground, with no matching extension above (there
 * has never been a reason to draw ground above the sky). Rotating that geometry in
 * world-space swaps top and bottom and exposes the asymmetry directly: a gap opens
 * where the fill never reached, and the oversized part sweeps into the sky instead —
 * which is exactly the bug this function replaces. Rotating the *already-composited*
 * frame has no such assumption to violate: whatever was drawn, however far any single
 * shape extends, rotates as one rigid image with no seams.
 *
 * Callers wrap sky *and* world drawing inside this rotation and leave the HUD outside
 * it, for the same reason the HUD ignores camera translation and zoom: it must stay
 * legible regardless of what a twist is doing to the world.
 */
export function applyScreenRotation(
  ctx: CanvasRenderingContext2D,
  camera: CameraView,
  width: number,
  height: number,
): void {
  if (camera.rotation === 0) return;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(camera.rotation);
  ctx.translate(-width / 2, -height / 2);
}

/**
 * Inverse of {@link applyCamera} plus {@link applyScreenRotation} together, for
 * hit-testing world positions from screen taps.
 */
export function screenToWorld(
  camera: CameraView,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  // Undo the whole-frame roll first, since it was the outermost transform applied.
  let sx = screenX - width / 2;
  let sy = screenY - height / 2;
  if (camera.rotation !== 0) {
    const cos = Math.cos(-camera.rotation);
    const sin = Math.sin(-camera.rotation);
    const rx = sx * cos - sy * sin;
    sy = sx * sin + sy * cos;
    sx = rx;
  }
  sx += width / 2;
  sy += height / 2;

  const dx = sx - width * ANCHOR_X;
  const dy = sy - height * ANCHOR_Y;
  const mirror = camera.mirrorX ? -1 : 1;
  return { x: camera.x + dx / (camera.zoom * mirror), y: camera.y + dy / camera.zoom };
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
