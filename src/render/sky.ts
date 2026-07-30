/**
 * The sky, rasterised once and blitted.
 *
 * A multi-stop gradient plus the sun is the single most expensive thing a frame could
 * redraw, and none of it changes between frames — so it is baked into an offscreen
 * canvas and invalidated only when the size or palette changes.
 *
 * The sky belongs to the render style rather than to the scene: a wireframe or ASCII
 * style wants a flat ground and a horizon rule, not a gradient. Game code therefore
 * emits no sky primitives at all.
 */

import type { Palette } from './palette';

export class SkyCache {
  private canvas: HTMLCanvasElement | null = null;
  private key = '';

  /** Draws the sky, rebuilding the cache if the size or palette has changed. */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: Palette,
  ): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const key = `${w}x${h}:${palette.id}`;

    if (!this.canvas || this.key !== key) {
      this.canvas = this.build(w, h, palette);
      this.key = key;
    }
    ctx.drawImage(this.canvas, 0, 0, width, height);
  }

  /** Forces a rebuild — used when the render scale changes. */
  invalidate(): void {
    this.key = '';
  }

  private build(width: number, height: number, palette: Palette): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const stops = palette.sky;
    for (let i = 0; i < stops.length; i++) {
      gradient.addColorStop(i / Math.max(1, stops.length - 1), stops[i] as string);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // A low sun near the horizon, which is what gives the dunes their rim glow.
    const sunX = width * 0.74;
    const sunY = height * 0.55;
    const sunRadius = Math.min(width, height) * 0.075;

    // A radial gradient for the halo. Stacked translucent discs are cheaper per draw
    // but leave visible concentric rings, and since this is baked exactly once the
    // gradient costs nothing per frame. `shadowBlur` would be the obvious alternative
    // and is pathologically slow in an Android WebView.
    const halo = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.6, sunX, sunY, sunRadius * 5);
    halo.addColorStop(0, `${palette.roles.haze}55`);
    halo.addColorStop(0.35, `${palette.roles.haze}22`);
    halo.addColorStop(1, `${palette.roles.haze}00`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = palette.roles.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    return canvas;
  }
}
