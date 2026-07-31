/**
 * The seam between the game and the screen.
 *
 * Game code never touches a canvas. Instead it describes each frame as a list of
 * primitives tagged with a **semantic role** — `player`, `hazard`, `terrainNear` —
 * and a `RenderStyle` decides what a role looks like. That indirection is what makes
 * the render-style twists affordable: silhouette, pixel, wireframe, papercraft and
 * ASCII all consume an unchanged scene, so a style swap costs one assignment rather
 * than a parallel implementation of every draw call.
 *
 * Roles, deliberately, are not colours. The moment game code says `'#0a0715'` the
 * wireframe style has nothing left to reinterpret.
 */

/** What a primitive *is*. The style decides how that looks. */
export type Role =
  | 'terrainFar'
  | 'terrainMid'
  | 'terrainNear'
  | 'player'
  | 'trail'
  | 'hazard'
  | 'chime'
  | 'accent'
  | 'sun'
  | 'haze'
  | 'text'
  | 'textDim';

/**
 * Draw order, back to front. `hud` is special: it is in screen space and ignores the
 * camera, so the HUD does not scroll, scale or rotate with the world.
 */
export type LayerId = 'sky' | 'far' | 'mid' | 'near' | 'entities' | 'fx' | 'hud';

export const LAYER_ORDER: readonly LayerId[] = [
  'sky',
  'far',
  'mid',
  'near',
  'entities',
  'fx',
  'hud',
];

export type PrimKind = 'polygon' | 'polyline' | 'disc' | 'text';

/**
 * One drawable.
 *
 * This is deliberately a single "fat" shape carrying the fields of all four kinds
 * rather than a discriminated union of narrow types. Primitives are pooled and reused
 * across frames, and a single shape keeps the objects monomorphic — the renderer's
 * property access stays on one hidden class instead of going megamorphic across four.
 * That matters more than the tidiness of narrower types in a loop that runs for every
 * primitive of every frame.
 */
export interface Prim {
  kind: PrimKind;
  role: Role;
  layer: LayerId;
  alpha: number;

  /** Interleaved x, y pairs for polygon and polyline. Reused; see `pointCount`. */
  points: number[];
  /** Valid entries in `points` — it may be longer, left over from a busier frame. */
  pointCount: number;

  /** Stroke width, polyline only. */
  width: number;

  /** Anchor for disc and text; centre for disc. */
  x: number;
  y: number;
  /** Disc only. */
  radius: number;

  /** Text only. */
  text: string;
  size: number;
  align: CanvasTextAlign;
  weight: number;
}

export interface CameraView {
  x: number;
  y: number;
  /** 1 is neutral; below 1 pulls back and shows more world. */
  zoom: number;
  /**
   * Radians. Non-zero under Slow Rotate, and set to π by Inversion.
   *
   * Applied as a whole-frame post-process by the render style (see
   * `renderer.ts`'s `applyScreenTransform`), never as part of the world-space camera
   * transform — rotating world geometry directly breaks the moment any shape is
   * drawn asymmetrically relative to the camera, which the terrain fill always is.
   */
  rotation: number;
  /**
   * Horizontal mirror of the whole rendered frame. Set by the Mirror twist.
   *
   * Also applied as a whole-frame post-process, not folded into the world-space
   * camera transform — the camera anchor sits off-centre (`ANCHOR_X`, so the runner
   * has room ahead to see what's coming), and mirroring around an off-centre point
   * shifts the visible world sideways rather than just flipping it, leaving one edge
   * of the screen with nothing drawn on it. See `applyScreenTransform`.
   */
  mirrorX: boolean;
}

export interface Scene {
  camera: CameraView;
  /** Pooled; only the first `count` entries belong to this frame. */
  prims: readonly Prim[];
  count: number;
  /** Seconds since the run began, for animation that must not depend on frame rate. */
  time: number;
}

function createPrim(): Prim {
  return {
    kind: 'polygon',
    role: 'accent',
    layer: 'entities',
    alpha: 1,
    points: [],
    pointCount: 0,
    width: 1,
    x: 0,
    y: 0,
    radius: 0,
    text: '',
    size: 16,
    align: 'left',
    weight: 400,
  };
}

/**
 * Accumulates a frame's primitives without allocating.
 *
 * Everything is pooled and reset per frame. Per-frame allocation is the main GC risk
 * against the Android frame budget, and a runner that stutters once a second because
 * of a young-generation collection reads as a broken game.
 */
export class SceneBuilder {
  private readonly pool: Prim[] = [];
  private used = 0;
  private current: Prim | null = null;

  private readonly view: CameraView = { x: 0, y: 0, zoom: 1, rotation: 0, mirrorX: false };
  private elapsed = 0;

  /** Starts a frame, releasing the previous frame's primitives back to the pool. */
  begin(camera: CameraView, time: number): void {
    this.used = 0;
    this.current = null;
    this.view.x = camera.x;
    this.view.y = camera.y;
    this.view.zoom = camera.zoom;
    this.view.rotation = camera.rotation;
    this.view.mirrorX = camera.mirrorX;
    this.elapsed = time;
  }

  private take(kind: PrimKind, role: Role, layer: LayerId, alpha: number): Prim {
    let prim = this.pool[this.used];
    if (!prim) {
      prim = createPrim();
      this.pool.push(prim);
    }
    this.used++;
    prim.kind = kind;
    prim.role = role;
    prim.layer = layer;
    prim.alpha = alpha;
    prim.pointCount = 0;
    return prim;
  }

  /** Begins a filled shape. Follow with `point()` calls, then `end()`. */
  polygon(role: Role, layer: LayerId, alpha = 1): this {
    this.current = this.take('polygon', role, layer, alpha);
    return this;
  }

  /** Begins a stroked path. Follow with `point()` calls, then `end()`. */
  polyline(role: Role, layer: LayerId, width = 2, alpha = 1): this {
    const prim = this.take('polyline', role, layer, alpha);
    prim.width = width;
    this.current = prim;
    return this;
  }

  /** Appends a vertex to the shape opened by `polygon` or `polyline`. */
  point(x: number, y: number): this {
    const prim = this.current;
    if (!prim) return this;
    // Write in place where the reused array is already long enough.
    const index = prim.pointCount * 2;
    if (index < prim.points.length) {
      prim.points[index] = x;
      prim.points[index + 1] = y;
    } else {
      prim.points.push(x, y);
    }
    prim.pointCount++;
    return this;
  }

  /** Closes the current shape. A shape with under two vertices is discarded. */
  end(): void {
    const prim = this.current;
    this.current = null;
    if (prim && prim.pointCount < 2) this.used--;
  }

  disc(role: Role, layer: LayerId, x: number, y: number, radius: number, alpha = 1): void {
    const prim = this.take('disc', role, layer, alpha);
    prim.x = x;
    prim.y = y;
    prim.radius = radius;
  }

  text(
    role: Role,
    layer: LayerId,
    x: number,
    y: number,
    value: string,
    size = 16,
    align: CanvasTextAlign = 'left',
    weight = 500,
    alpha = 1,
  ): void {
    const prim = this.take('text', role, layer, alpha);
    prim.x = x;
    prim.y = y;
    prim.text = value;
    prim.size = size;
    prim.align = align;
    prim.weight = weight;
  }

  /** The frame as built so far. Valid until the next `begin()`. */
  get scene(): Scene {
    return {
      camera: this.view,
      prims: this.pool,
      count: this.used,
      time: this.elapsed,
    };
  }

  /** Primitives emitted this frame. Exposed for the diagnostics overlay. */
  get primCount(): number {
    return this.used;
  }
}
