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
 */
export function applyCamera(
  ctx: CanvasRenderingContext2D,
  camera: CameraView,
  width: number,
  height: number,
): void {
  ctx.translate(width * ANCHOR_X, height * ANCHOR_Y);
  if (camera.rotation !== 0) ctx.rotate(camera.rotation);
  if (camera.zoom !== 1) ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
}

/** Inverse of {@link applyCamera}, for hit-testing world positions from screen taps. */
export function screenToWorld(
  camera: CameraView,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  let dx = screenX - width * ANCHOR_X;
  let dy = screenY - height * ANCHOR_Y;
  if (camera.rotation !== 0) {
    const cos = Math.cos(-camera.rotation);
    const sin = Math.sin(-camera.rotation);
    const rx = dx * cos - dy * sin;
    dy = dx * sin + dy * cos;
    dx = rx;
  }
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
