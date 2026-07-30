/**
 * The baseline look: flat silhouettes against a gradient sky.
 *
 * This is the reference implementation of {@link RenderStyle}. It reads roles from the
 * palette and does nothing clever, which is the point — it establishes what the other
 * four styles in Milestone 5 are reinterpreting.
 */

import { applyCamera, applyScreenRotation, type RenderStyle, type StyleContext } from '../renderer';
import { LAYER_ORDER, type LayerId, type Prim, type Scene } from '../scene';
import { SkyCache } from '../sky';

/** Layers drawn in world space, in order. `sky` is the style's own; `hud` is screen space. */
const WORLD_LAYERS: readonly LayerId[] = LAYER_ORDER.filter(
  (layer) => layer !== 'sky' && layer !== 'hud',
);

export class SilhouetteStyle implements RenderStyle {
  readonly id = 'silhouette';

  private readonly sky = new SkyCache();
  /** Font strings are rebuilt rarely and reused, to keep text drawing allocation-free. */
  private readonly fontCache = new Map<string, string>();

  draw(scene: Scene, { ctx, viewport, palette }: StyleContext): void {
    const { width, height } = viewport;

    // Sky and world share one outer rotation (Inversion's whole-frame roll), so they
    // move as a single rigid image with no seam between them — see
    // applyScreenRotation for why this cannot be folded into the camera transform
    // below instead.
    ctx.save();
    applyScreenRotation(ctx, scene.camera, width, height);

    this.sky.draw(ctx, width, height, palette);

    ctx.save();
    applyCamera(ctx, scene.camera, width, height);
    for (const layer of WORLD_LAYERS) {
      this.drawLayer(ctx, scene, layer, palette);
    }
    ctx.restore();

    ctx.restore();

    // HUD last, outside both transforms, so it neither scrolls, scales, nor rotates.
    this.drawLayer(ctx, scene, 'hud', palette);

    ctx.globalAlpha = 1;
  }

  invalidateSky(): void {
    this.sky.invalidate();
  }

  /**
   * One pass per layer.
   *
   * Iterating the whole list per layer is O(layers × prims), but with seven layers and
   * a few dozen primitives that is far cheaper than sorting — and sorting would
   * allocate every frame, which is the thing the pooled scene exists to avoid.
   */
  private drawLayer(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    layer: LayerId,
    palette: { roles: Record<string, string> },
  ): void {
    for (let i = 0; i < scene.count; i++) {
      const prim = scene.prims[i] as Prim;
      if (prim.layer !== layer) continue;

      const colour = palette.roles[prim.role] ?? '#ff00ff';
      ctx.globalAlpha = prim.alpha;

      switch (prim.kind) {
        case 'polygon':
          ctx.fillStyle = colour;
          this.path(ctx, prim);
          ctx.fill();
          break;

        case 'polyline':
          ctx.strokeStyle = colour;
          ctx.lineWidth = prim.width;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          this.path(ctx, prim);
          ctx.stroke();
          break;

        case 'disc':
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.arc(prim.x, prim.y, prim.radius, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'text':
          ctx.fillStyle = colour;
          ctx.font = this.font(prim.weight, prim.size);
          ctx.textAlign = prim.align;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(prim.text, prim.x, prim.y);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  private path(ctx: CanvasRenderingContext2D, prim: Prim): void {
    ctx.beginPath();
    ctx.moveTo(prim.points[0] as number, prim.points[1] as number);
    for (let p = 1; p < prim.pointCount; p++) {
      ctx.lineTo(prim.points[p * 2] as number, prim.points[p * 2 + 1] as number);
    }
    if (prim.kind === 'polygon') ctx.closePath();
  }

  private font(weight: number, size: number): string {
    const key = `${weight}:${size}`;
    let font = this.fontCache.get(key);
    if (!font) {
      font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      this.fontCache.set(key, font);
    }
    return font;
  }
}
