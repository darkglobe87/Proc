/**
 * Orchestration: owns the world, the player, the camera, and the run lifecycle.
 *
 * Two decisions worth knowing about:
 *
 * The terrain baseline is **zero**. Heights oscillate around the origin and the camera
 * frames the player, so nothing in the world depends on viewport height. That removes a
 * whole class of resize bugs — with a screen-relative baseline, rotating the device
 * moves the ground out from under the player mid-jump.
 *
 * Parallax bands sample the *same* height function at a compressed x. A band drawn at
 * world x but sampled at `x * 0.4` scrolls at 40% speed for free, and the near band
 * samples at 1.0 so what you see is exactly what you collide with.
 */

import { EventBus } from '../core/events';
import { GameLoop } from '../core/loop';
import { Input } from '../core/input';
import type { Viewport } from '../core/viewport';
import { Rng, encodeSeed } from '../core/rng';
import * as storage from '../core/storage';
import { Renderer } from '../render/renderer';
import { SceneBuilder } from '../render/scene';
import { SilhouetteStyle } from '../render/styles/silhouette';
import { ANCHOR_X } from './camera';
import { Camera } from './camera';
import { Terrain } from '../world/terrain';
import { Player, PLAYER_RADIUS } from '../player/player';
import { drawHud } from '../ui/hud';
import type { GameEvents } from './events';

export type GameState = 'ready' | 'running' | 'dead';

/** World pixels per displayed metre. */
const PIXELS_PER_METRE = 10;
/** Ignore restart taps for this long after a crash, so the fatal tap does not restart. */
const DEATH_COOLDOWN = 0.6;
/** Horizontal sample spacing when tessellating a dune band, in screen pixels. */
const BAND_STEP = 12;
const TRAIL_LENGTH = 22;

interface BandSpec {
  role: 'terrainFar' | 'terrainMid' | 'terrainNear';
  layer: 'far' | 'mid' | 'near';
  /** x compression: lower scrolls slower and reads as further away. */
  parallax: number;
  /** Height multiplier. */
  amplitude: number;
  /** Pushed down-screen so bands stack instead of overlapping confusingly. */
  lift: number;
  /**
   * Slice of terrain to sample. Without distinct offsets every band is the same curve
   * at a different scale, which reads as one shape smeared rather than as depth.
   */
  offset: number;
}

/**
 * Parallax below ~0.4 compresses a screen's width into so little terrain that the band
 * flattens into a straight line, so the far band trades some depth for actually looking
 * like dunes. Amplitude rises with distance to compensate for the compression.
 */
const BANDS: readonly BandSpec[] = [
  { role: 'terrainFar', layer: 'far', parallax: 0.45, amplitude: 1.15, lift: -125, offset: 51_000 },
  { role: 'terrainMid', layer: 'mid', parallax: 0.7, amplitude: 1, lift: -55, offset: 23_000 },
  { role: 'terrainNear', layer: 'near', parallax: 1, amplitude: 1, lift: 0, offset: 0 },
];

export interface GameOptions {
  seed: number;
  isDaily: boolean;
  showDiagnostics: boolean;
}

export class Game {
  readonly bus = new EventBus<GameEvents>();

  private readonly loop: GameLoop;
  private readonly input = new Input();
  private readonly builder = new SceneBuilder();
  private readonly style = new SilhouetteStyle();
  private readonly renderer: Renderer;
  private readonly camera = new Camera();
  private readonly terrain: Terrain;
  private readonly player: Player;

  private state: GameState = 'ready';
  private time = 0;
  private deathAt = -Infinity;
  private best: number;
  private currentFlips = 0;
  private paused = false;

  private readonly trail: number[] = [];
  private overBudgetSeconds = 0;

  constructor(
    private readonly viewport: Viewport,
    private readonly options: GameOptions,
  ) {
    const rng = new Rng(options.seed);
    this.terrain = new Terrain(rng, 0);
    this.player = new Player(this.terrain);
    this.renderer = new Renderer(viewport, this.style);

    this.best = storage.load<number>('best.distance', 0);

    this.input.attach(viewport.canvas);
    this.camera.snap();

    this.bus.on('player:trick', ({ flips }) => {
      this.currentFlips = flips;
    });
    this.bus.on('player:launch', () => {
      this.currentFlips = 0;
    });

    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: (alpha) => this.render(alpha),
    });

    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
    });
  }

  start(): void {
    this.loop.start();
  }

  private update(dt: number): void {
    const input = this.input.snapshot;
    this.time += dt;

    if (input.pausePressed) this.paused = !this.paused;
    if (this.paused) {
      this.input.endStep();
      return;
    }

    switch (this.state) {
      case 'ready':
        if (input.jumpPressed) this.beginRun();
        break;

      case 'running':
        this.player.update(dt, input, this.bus);
        if (this.player.dead) this.endRun();
        break;

      case 'dead':
        if (input.jumpPressed && this.time - this.deathAt > DEATH_COOLDOWN) {
          this.beginRun();
        }
        break;
    }

    this.camera.follow(this.player.x, this.player.y, this.player.speedRatio, dt);
    this.terrain.prune(this.player.x);

    this.input.endStep();
  }

  private beginRun(): void {
    this.player.reset();
    this.trail.length = 0;
    this.currentFlips = 0;
    this.camera.snap();
    this.state = 'running';
    this.bus.emit('run:start', { seed: this.options.seed });
  }

  private endRun(): void {
    this.state = 'dead';
    this.deathAt = this.time;
    const isBest = this.player.distance > this.best;
    if (isBest) {
      this.best = this.player.distance;
      storage.save('best.distance', Math.floor(this.best));
    }
    this.bus.emit('run:end', { distance: this.player.distance, best: isBest });
  }

  private render(alpha: number): void {
    const { width, height } = this.viewport;

    // Interpolate between simulation steps so motion is smooth at any refresh rate.
    const drawX = this.player.previousX + (this.player.x - this.player.previousX) * alpha;
    const drawY = this.player.previousY + (this.player.y - this.player.previousY) * alpha;

    this.builder.begin(this.camera, this.time);

    for (const band of BANDS) this.emitBand(band, width, height);
    this.emitTrail(drawX, drawY);
    this.emitPlayer(drawX, drawY);

    drawHud(
      this.builder,
      {
        distanceMetres: Math.floor(this.player.distance / PIXELS_PER_METRE),
        bestMetres: Math.floor(this.best / PIXELS_PER_METRE),
        seedCode: encodeSeed(this.options.seed),
        isDaily: this.options.isDaily,
        state: this.state,
        flips: this.currentFlips,
        fps: this.loop.fps,
        frameMs: this.loop.frameMs,
        renderScale: this.viewport.renderScale,
        showDiagnostics: this.options.showDiagnostics,
        landscape: this.viewport.isLandscape,
      },
      width,
      height,
      this.viewport.safeArea,
    );

    this.renderer.render(this.builder.scene);
    this.watchdog();
  }

  /** Visible world x range, accounting for the anchor and zoom. */
  private worldBounds(width: number): { left: number; right: number } {
    const zoom = this.camera.zoom;
    return {
      left: this.camera.x - (width * ANCHOR_X) / zoom - BAND_STEP,
      right: this.camera.x + (width * (1 - ANCHOR_X)) / zoom + BAND_STEP,
    };
  }

  private emitBand(band: BandSpec, width: number, height: number): void {
    const { left, right } = this.worldBounds(width);
    // Cancelling part of the camera's vertical translation makes distant bands drift
    // less as the player rises and falls, which is what sells the depth.
    const verticalHold = this.camera.y * (1 - band.parallax);

    this.builder.polygon(band.role, band.layer);
    for (let x = left; x <= right; x += BAND_STEP) {
      const sampled =
        this.terrain.heightAt(x * band.parallax + band.offset) * band.amplitude;
      this.builder.point(x, sampled + band.lift + verticalHold);
    }
    // Close the fill well below the visible area so the band reads as solid ground.
    const floor = this.camera.y + height / this.camera.zoom;
    this.builder.point(right, floor);
    this.builder.point(left, floor);
    this.builder.end();
  }

  /**
   * The trail is emitted as one short polyline per segment rather than a single path,
   * so width and alpha can taper along it. A uniform polyline reads as a rigid stick
   * welded to the player; the taper is what makes it look like a ribbon left behind.
   */
  private emitTrail(x: number, y: number): void {
    if (this.state === 'running') {
      this.trail.push(x, y);
      while (this.trail.length > TRAIL_LENGTH * 2) this.trail.splice(0, 2);
    }
    const points = this.trail.length / 2;
    if (points < 2) return;

    for (let i = 1; i < points; i++) {
      // 0 at the oldest point, 1 at the player.
      const t = i / (points - 1);
      this.builder.polyline('trail', 'fx', 0.6 + t * 3, t * t * 0.5);
      this.builder.point(this.trail[(i - 1) * 2] as number, this.trail[(i - 1) * 2 + 1] as number);
      this.builder.point(this.trail[i * 2] as number, this.trail[i * 2 + 1] as number);
      this.builder.end();
    }
  }

  private emitPlayer(x: number, y: number): void {
    const rotation = this.player.rotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Board and rider as two simple shapes. The rotation has to be legible — it is the
    // difference between a landed flip and a crash, so the player must be able to read
    // their own angle at a glance.
    const halfLength = 17;
    const thickness = 4;

    const corners: ReadonlyArray<readonly [number, number]> = [
      [-halfLength, -thickness],
      [halfLength, -thickness],
      [halfLength, thickness],
      [-halfLength, thickness],
    ];

    this.builder.polygon('player', 'entities');
    for (const [lx, ly] of corners) {
      this.builder.point(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
    }
    this.builder.end();

    // Rider sits above the board along its local normal, so it orbits during a flip.
    const riderLocalY = -(PLAYER_RADIUS + 6);
    this.builder.disc(
      'player',
      'entities',
      x - riderLocalY * sin,
      y + riderLocalY * cos,
      PLAYER_RADIUS,
    );
  }

  /** Lowers resolution when the device cannot sustain the frame budget. */
  private watchdog(): void {
    if (this.loop.frameMs > 20) {
      this.overBudgetSeconds += 1 / 60;
      if (this.overBudgetSeconds > 2 && this.viewport.renderScale > 0.4) {
        this.viewport.renderScale -= 0.15;
        this.style.invalidateSky();
        this.overBudgetSeconds = 0;
      }
    } else {
      this.overBudgetSeconds = Math.max(0, this.overBudgetSeconds - 1 / 120);
    }
  }
}
