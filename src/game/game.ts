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
import { World } from '../world/world';
import { CHIME_RADIUS, type Chime } from '../world/chimes';
import { Player, PLAYER_RADIUS } from '../player/player';
import { drawHud } from '../ui/hud';
import type { GameEvents } from './events';
import { TELEGRAPH_SECONDS, TwistScheduler, type SchedulerHooks } from '../twists/scheduler';
import { createTwistRegistry } from '../twists/registry';

export type GameState = 'ready' | 'exploring';

/** World pixels per displayed metre. */
const PIXELS_PER_METRE = 10;
/** Horizontal sample spacing when tessellating a dune band, in screen pixels. */
const BAND_STEP = 12;
const TRAIL_LENGTH = 18;

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
  /** Development aid: hide all hazards so the world can be inspected without dodging. */
  noHazards?: boolean;
  /** Development aid: compress Shift timing to a few seconds instead of 35–45s. */
  fastShift?: boolean;
}

export class Game {
  readonly bus = new EventBus<GameEvents>();

  private readonly loop: GameLoop;
  private readonly input = new Input();
  private readonly builder = new SceneBuilder();
  private readonly style = new SilhouetteStyle();
  private readonly renderer: Renderer;
  private readonly camera = new Camera();
  private readonly world: World;
  private readonly player: Player;
  private readonly twists: TwistScheduler;
  /** Reused every frame rather than allocated — see SchedulerHooks. */
  private readonly twistHooks: SchedulerHooks;

  private state: GameState = 'ready';
  private time = 0;
  private furthest: number;
  private chimes = 0;
  private paused = false;

  /** Telegraph banner state, driven by the 'twist:telegraph' event. */
  private telegraphLabels: readonly string[] = [];
  private telegraphTimer = 0;

  private readonly trail: number[] = [];
  private overBudgetSeconds = 0;

  constructor(
    private readonly viewport: Viewport,
    private readonly options: GameOptions,
  ) {
    const rng = new Rng(options.seed);
    this.world = new World(rng);
    this.player = new Player(this.world);
    this.renderer = new Renderer(viewport, this.style);

    // Forking from the same top-level seed as World/Terrain, not consuming from them:
    // fork() never advances the parent stream, so this is independent of how many
    // chunks get generated and does not disturb their determinism either.
    this.twists = new TwistScheduler(
      rng.fork('twists'),
      createTwistRegistry(rng),
      options.fastShift ? { seconds: [3, 5], px: [200, 400] } : undefined,
    );
    this.twistHooks = {
      world: this.world,
      player: this.player,
      bus: this.bus,
      collectChime: (chime) => this.collectOne(chime),
    };

    this.furthest = storage.load<number>('furthest.distance', 0);

    this.input.attach(viewport.canvas);
    this.camera.snap();

    this.bus.on('twist:telegraph', ({ labels }) => {
      this.telegraphLabels = labels;
      this.telegraphTimer = TELEGRAPH_SECONDS;
    });

    if (this.options.noHazards) this.world.suppressHazards('dev-nohazards', -Infinity, Infinity);

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

    if (this.state === 'ready') {
      if (input.jumpPressed || input.moveAxis !== 0) this.state = 'exploring';
    }

    if (this.state === 'exploring') {
      // Computed before the physics step, so a region's laws are what the player's own
      // input and movement are actually evaluated against this frame.
      const modifiers = this.twists.computePhysicsModifiers();
      const effectiveInput = this.twists.transformInput(input, dt);
      this.player.update(dt, effectiveInput, this.bus, modifiers);

      this.collectChimes();
      this.twists.update(dt, this.twistHooks);
      if (this.telegraphTimer > 0) this.telegraphTimer = Math.max(0, this.telegraphTimer - dt);

      if (this.player.distance > this.furthest) {
        this.furthest = this.player.distance;
        storage.save('furthest.distance', Math.floor(this.furthest));
      }

      if (input.restartPressed) this.player.reset();
    }

    this.camera.follow(this.player.x, this.player.y, this.player.facing, dt);
    this.world.prune(this.player.x);

    this.input.endStep();
  }

  /** Collection radius is generous: chimes reward taking the line, they do not test it. */
  private collectChimes(): void {
    const reach = CHIME_RADIUS + PLAYER_RADIUS;
    for (const chime of this.world.chimesNear(this.player.x, reach * 3)) {
      const dx = chime.x - this.player.x;
      const dy = chime.y - (this.player.y - PLAYER_RADIUS);
      if (dx * dx + dy * dy <= reach * reach) this.collectOne(chime);
    }
  }

  /**
   * The real collection path for a single pickup. Exposed to twists via
   * `SchedulerHooks.collectChime` so a twist that awards a chime on the player's
   * behalf (Echo's ghost) cannot silently diverge from how a live pickup is counted.
   */
  private collectOne(chime: Chime): void {
    if (!this.world.collect(chime)) return;
    this.chimes++;
    this.bus.emit('chime:collect', { pitch: chime.pitch, index: chime.index, total: chime.total });
  }

  private render(alpha: number): void {
    const { width, height } = this.viewport;

    // Interpolate between simulation steps so motion is smooth at any refresh rate.
    const drawX = this.player.previousX + (this.player.x - this.player.previousX) * alpha;
    const drawY = this.player.previousY + (this.player.y - this.player.previousY) * alpha;

    // Applied to the camera every frame rather than by the twists directly: the camera
    // has no notion that twists exist, only fields a render fold happens to write to.
    const renderMods = this.twists.computeRenderModifiers();
    this.camera.rotation = renderMods.rotation;
    this.camera.mirrorX = renderMods.mirrorX;

    this.builder.begin(this.camera, this.time);

    for (const band of BANDS) this.emitBand(band, width, height);
    this.emitSolids(width);
    this.emitObstacles(width);
    this.emitChimes(width);
    this.emitTrail(drawX, drawY);
    this.emitPlayer(drawX, drawY);
    this.twists.emit(this.builder);

    drawHud(
      this.builder,
      {
        // Current position, not the peak — you can walk back the way you came, and
        // the readout should say where you are, not just the furthest you got to.
        distanceMetres: Math.floor(this.player.x / PIXELS_PER_METRE),
        furthestMetres: Math.floor(this.furthest / PIXELS_PER_METRE),
        seedCode: encodeSeed(this.options.seed),
        isDaily: this.options.isDaily,
        state: this.state,
        chimes: this.chimes,
        hurt: this.player.isHurt,
        activeTwists: this.twists.activeLabels,
        telegraphLabels: this.telegraphTimer > 0 ? this.telegraphLabels : [],
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
        this.world.terrain.heightAt(x * band.parallax + band.offset) * band.amplitude;
      this.builder.point(x, sampled + band.lift + verticalHold);
    }
    // Close the fill well below the visible area so the band reads as solid ground.
    const floor = this.camera.y + height / this.camera.zoom;
    this.builder.point(right, floor);
    this.builder.point(left, floor);
    this.builder.end();
  }

  /**
   * Chimes, with a gentle breathing pulse so they read as alive rather than as UI.
   * Animated from `scene.time`, never from frame count, so it looks the same at any
   * refresh rate.
   */
  private emitChimes(width: number): void {
    const { left, right } = this.worldBounds(width);
    for (const chime of this.world.chimesNear(this.camera.x, (right - left) / 2 + 200)) {
      if (chime.x < left || chime.x > right) continue;
      // Phase offset by index so an arc shimmers along its length instead of blinking.
      const pulse = 1 + Math.sin(this.time * 4 + chime.index * 0.7) * 0.12;
      this.builder.disc('chime', 'entities', chime.x, chime.y, 6 * pulse, 0.95);
    }
  }

  /**
   * Obstacles as dark masses with a rim-lit edge.
   *
   * The rim is not decoration. A silhouette-black obstacle standing on silhouette-black
   * ground is invisible, and an unreadable hazard is an unfair one — Alto's gets away with
   * pure silhouette only because its obstacles break the horizon against the sky.
   */
  private emitObstacles(width: number): void {
    const { left, right } = this.worldBounds(width);
    for (const obstacle of this.world.obstaclesNear(this.camera.x, (right - left) / 2 + 200)) {
      if (obstacle.x < left - 40 || obstacle.x > right + 40) continue;

      const half = obstacle.width / 2;
      const top = obstacle.y - obstacle.height;
      // Slight taper, so a monolith reads as stone rather than as a rectangle.
      const taper = half * 0.35;

      this.builder.polygon('hazard', 'entities');
      this.builder.point(obstacle.x - half, obstacle.y);
      this.builder.point(obstacle.x - half + taper, top);
      this.builder.point(obstacle.x + half - taper, top);
      this.builder.point(obstacle.x + half, obstacle.y);
      this.builder.end();

      // Lit edge on the sun side (the sun sits to the right in the sky cache).
      this.builder.polyline('accent', 'entities', 2, 0.8);
      this.builder.point(obstacle.x + half - taper, top);
      this.builder.point(obstacle.x + half, obstacle.y);
      this.builder.end();
    }
  }

  /**
   * One-way ledges as a solid plank with two support struts down to the dune beneath —
   * the struts are what sell "floating over" rather than "resting on".
   */
  private emitSolids(width: number): void {
    const { left, right } = this.worldBounds(width);
    for (const solid of this.world.solidsNear(this.camera.x, (right - left) / 2 + 200)) {
      const solidLeft = solid.x - solid.width / 2;
      const solidRight = solid.x + solid.width / 2;
      if (solidRight < left || solidLeft > right) continue;
      const solidTop = solid.y - solid.height;

      for (const t of [0.18, 0.82]) {
        const sx = solidLeft + solid.width * t;
        this.builder.polyline('hazard', 'entities', 3, 0.6);
        this.builder.point(sx, solid.y);
        this.builder.point(sx, this.world.terrain.heightAt(sx));
        this.builder.end();
      }

      this.builder.polygon('terrainNear', 'entities');
      this.builder.point(solidLeft, solidTop);
      this.builder.point(solidRight, solidTop);
      this.builder.point(solidRight, solid.y);
      this.builder.point(solidLeft, solid.y);
      this.builder.end();

      this.builder.polyline('accent', 'entities', 2, 0.9);
      this.builder.point(solidLeft, solidTop);
      this.builder.point(solidRight, solidTop);
      this.builder.end();
    }
  }

  private emitTrail(x: number, y: number): void {
    if (this.state === 'exploring') {
      this.trail.push(x, y);
      while (this.trail.length > TRAIL_LENGTH * 2) this.trail.splice(0, 2);
    }
    const points = this.trail.length / 2;
    if (points < 2) return;

    for (let i = 1; i < points; i++) {
      // 0 at the oldest point, 1 at the player.
      const t = i / (points - 1);
      this.builder.polyline('trail', 'fx', 0.6 + t * 2, t * t * 0.35);
      this.builder.point(this.trail[(i - 1) * 2] as number, this.trail[(i - 1) * 2 + 1] as number);
      this.builder.point(this.trail[i * 2] as number, this.trail[i * 2 + 1] as number);
      this.builder.end();
    }
  }

  /**
   * A small upright silhouette: a body and a head, plus a short "nose" in the facing
   * direction so which way the player is walking reads at a glance even at a glance's
   * distance, where a symmetric shape would not.
   */
  private emitPlayer(x: number, y: number): void {
    const rotation = this.player.rotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const alpha = this.player.isHurt && Math.floor(this.time * 10) % 2 === 0 ? 0.35 : 1;

    const halfWidth = 9;
    const bodyHeight = 30;

    const corners: ReadonlyArray<readonly [number, number]> = [
      [-halfWidth, -bodyHeight],
      [halfWidth, -bodyHeight],
      [halfWidth, 0],
      [-halfWidth, 0],
    ];

    this.builder.polygon('player', 'entities', alpha);
    for (const [lx, ly] of corners) {
      this.builder.point(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
    }
    this.builder.end();

    const headLocalY = -(bodyHeight + 7);
    this.builder.disc(
      'player',
      'entities',
      x - headLocalY * sin,
      y + headLocalY * cos,
      PLAYER_RADIUS,
      alpha,
    );

    const noseLocalX = this.player.facing * (halfWidth + 5);
    const noseLocalY = -bodyHeight * 0.28;
    this.builder.disc(
      'accent',
      'entities',
      x + noseLocalX * cos - noseLocalY * sin,
      y + noseLocalX * sin + noseLocalY * cos,
      3,
      alpha,
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
