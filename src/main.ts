/**
 * Bootstrap.
 *
 * Milestone 1 deliberately ships a thin vertical slice rather than a stub: a
 * seeded dune, a jumping runner, parallax, the HUD and the performance watchdog.
 * The point is to prove the whole spine — fixed-step loop, deterministic RNG,
 * touch input, DPR handling, persistence — on a real device inside the APK before
 * any of the interesting systems are built on top of it.
 *
 * Milestone 2 replaces the drawing here with the Scene/RenderStyle pipeline.
 */

import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { Viewport } from './core/viewport';
import { Rng, decodeSeed, encodeSeed, dailySeed, randomSeed } from './core/rng';
import * as storage from './core/storage';

// --- tuning -----------------------------------------------------------------

const GRAVITY = 2100;
const JUMP_VELOCITY = -760;
/** Gravity multiplier while rising with the button still held (variable height). */
const HOLD_GRAVITY_SCALE = 0.45;
const MAX_HOLD_SECONDS = 0.32;
const DIVE_VELOCITY = 900;
const BASE_SPEED = 260;
const MAX_SPEED_BONUS = 220;
/** Where the runner sits horizontally, as a fraction of screen width. */
const PLAYER_SCREEN_X = 0.3;
const TRAIL_LENGTH = 20;

// --- seed -------------------------------------------------------------------

function resolveSeed(): { seed: number; daily: boolean } {
  const params = new URLSearchParams(window.location.search);
  if (params.has('daily')) return { seed: dailySeed(), daily: true };

  const requested = params.get('seed');
  if (requested) {
    const decoded = decodeSeed(requested);
    if (decoded !== null) return { seed: decoded, daily: false };
  }
  return { seed: randomSeed(), daily: false };
}

// --- terrain (placeholder: real chunked heightfield lands in Milestone 2) ----

interface Octave {
  amplitude: number;
  wavelength: number;
  phase: number;
}

function buildOctaves(rng: Rng): Octave[] {
  const shape = rng.fork('terrain');
  return [
    { amplitude: 90, wavelength: 1400, phase: shape.range(0, Math.PI * 2) },
    { amplitude: 46, wavelength: 620, phase: shape.range(0, Math.PI * 2) },
    { amplitude: 18, wavelength: 260, phase: shape.range(0, Math.PI * 2) },
    { amplitude: 7, wavelength: 110, phase: shape.range(0, Math.PI * 2) },
  ];
}

function sampleTerrain(octaves: readonly Octave[], worldX: number, baseline: number): number {
  let y = baseline;
  for (const octave of octaves) {
    y += Math.sin(worldX / octave.wavelength + octave.phase) * octave.amplitude;
  }
  return y;
}

// --- palette ----------------------------------------------------------------

const PALETTE = {
  skyTop: '#0b1026',
  skyMid: '#3b2a5a',
  skyLow: '#c2643f',
  sun: '#ffd9a0',
  far: '#2a2140',
  mid: '#1d1730',
  near: '#120e20',
  ground: '#0a0715',
  player: '#f6e7c8',
  accent: '#ff9c6b',
  text: '#f6e7c8',
};

// --- game -------------------------------------------------------------------

class SpineTest {
  private readonly loop: GameLoop;
  private readonly input = new Input();

  private readonly rng: Rng;
  private readonly octaves: readonly Octave[];
  private readonly seedCode: string;
  private readonly isDaily: boolean;

  /** Distance travelled in world pixels. */
  private distance = 0;
  private speed = BASE_SPEED;
  private playerY = 0;
  private velocityY = 0;
  private previousPlayerY = 0;
  private onGround = false;
  private airborneSeconds = 0;
  private best: number;
  private paused = false;

  private readonly trail: Array<{ x: number; y: number }> = [];

  private skyCache: HTMLCanvasElement | null = null;
  private skyCacheKey = '';

  /** Consecutive seconds spent over the frame budget, for the watchdog. */
  private overBudgetSeconds = 0;

  constructor(private readonly viewport: Viewport) {
    const { seed, daily } = resolveSeed();
    this.rng = new Rng(seed);
    this.seedCode = encodeSeed(seed);
    this.isDaily = daily;
    this.octaves = buildOctaves(this.rng);
    this.best = storage.load<number>('best.distance', 0);

    this.playerY = this.groundAt(0);
    this.previousPlayerY = this.playerY;

    this.input.attach(viewport.canvas);
    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: (alpha) => this.render(alpha),
    });

    // Backgrounding the app should not silently burn a run.
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
    });

    this.loop.start();
  }

  private get baseline(): number {
    return this.viewport.height * 0.72;
  }

  private groundAt(worldX: number): number {
    return sampleTerrain(this.octaves, worldX, this.baseline);
  }

  private update(dt: number): void {
    const input = this.input.snapshot;

    if (input.pausePressed) this.paused = !this.paused;
    if (input.restartPressed) this.restart();

    if (this.paused) {
      this.input.endStep();
      return;
    }

    this.speed = BASE_SPEED + Math.min(this.distance / 45, MAX_SPEED_BONUS);
    this.distance += this.speed * dt;

    this.previousPlayerY = this.playerY;

    if (input.jumpPressed && this.onGround) {
      this.velocityY = JUMP_VELOCITY;
      this.onGround = false;
    }
    if (input.divePressed && !this.onGround) {
      this.velocityY += DIVE_VELOCITY;
    }

    // Holding while still rising floats the arc; that plus the release point is
    // the whole of variable jump height.
    const floating =
      input.jumpHeld && this.velocityY < 0 && input.holdSeconds < MAX_HOLD_SECONDS;
    this.velocityY += GRAVITY * (floating ? HOLD_GRAVITY_SCALE : 1) * dt;
    this.playerY += this.velocityY * dt;

    const ground = this.groundAt(this.distance);
    if (this.playerY >= ground) {
      this.playerY = ground;
      this.velocityY = 0;
      this.onGround = true;
      this.airborneSeconds = 0;
    } else {
      this.onGround = false;
      this.airborneSeconds += dt;
    }

    if (this.distance > this.best) {
      this.best = this.distance;
    }

    this.input.endStep();
  }

  private restart(): void {
    storage.save('best.distance', Math.floor(this.best));
    this.distance = 0;
    this.velocityY = 0;
    this.playerY = this.groundAt(0);
    this.previousPlayerY = this.playerY;
    this.trail.length = 0;
  }

  private render(alpha: number): void {
    const { ctx, width, height } = this.viewport;
    const drawY = this.previousPlayerY + (this.playerY - this.previousPlayerY) * alpha;
    const playerX = width * PLAYER_SCREEN_X;

    this.drawSky(ctx, width, height);
    // Farther layers scroll slower and sit higher, which reads as depth.
    this.drawDunes(ctx, width, height, 0.25, height * 0.1, PALETTE.far, 0.55);
    this.drawDunes(ctx, width, height, 0.5, height * 0.05, PALETTE.mid, 0.8);
    this.drawDunes(ctx, width, height, 1, 0, PALETTE.ground, 1);

    this.drawTrail(ctx, playerX, drawY);
    this.drawPlayer(ctx, playerX, drawY);
    this.drawHud(ctx, width, height);

    this.watchdog();
  }

  private drawSky(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    // The gradient plus sun is static, so it is rasterised once and blitted. Rebuilding
    // a multi-stop gradient every frame is one of the few genuinely slow Canvas2D ops.
    const key = `${Math.round(width)}x${Math.round(height)}`;
    if (!this.skyCache || this.skyCacheKey !== key) {
      const cache = document.createElement('canvas');
      cache.width = Math.max(1, Math.round(width));
      cache.height = Math.max(1, Math.round(height));
      const cacheCtx = cache.getContext('2d');
      if (cacheCtx) {
        const gradient = cacheCtx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, PALETTE.skyTop);
        gradient.addColorStop(0.55, PALETTE.skyMid);
        gradient.addColorStop(1, PALETTE.skyLow);
        cacheCtx.fillStyle = gradient;
        cacheCtx.fillRect(0, 0, width, height);

        cacheCtx.fillStyle = PALETTE.sun;
        cacheCtx.globalAlpha = 0.85;
        cacheCtx.beginPath();
        cacheCtx.arc(width * 0.74, height * 0.52, Math.min(width, height) * 0.075, 0, Math.PI * 2);
        cacheCtx.fill();
        cacheCtx.globalAlpha = 1;
      }
      this.skyCache = cache;
      this.skyCacheKey = key;
    }
    ctx.drawImage(this.skyCache, 0, 0, width, height);
  }

  private drawDunes(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    parallax: number,
    lift: number,
    color: string,
    amplitudeScale: number,
  ): void {
    const step = 10;
    const offset = this.distance * parallax;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let screenX = 0; screenX <= width + step; screenX += step) {
      const worldX = offset + screenX;
      let y = this.baseline - lift;
      for (const octave of this.octaves) {
        y +=
          Math.sin(worldX / octave.wavelength + octave.phase) *
          octave.amplitude *
          amplitudeScale;
      }
      ctx.lineTo(screenX, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }

  private drawTrail(ctx: CanvasRenderingContext2D, playerX: number, drawY: number): void {
    this.trail.push({ x: playerX, y: drawY });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    if (this.trail.length < 2) return;

    ctx.strokeStyle = PALETTE.accent;
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const from = this.trail[i - 1];
      const to = this.trail[i];
      if (!from || !to) continue;
      const t = i / this.trail.length;
      ctx.globalAlpha = t * 0.5;
      ctx.lineWidth = 1 + t * 3;
      ctx.beginPath();
      // Trailing points drift backwards so the ribbon streams behind the runner.
      ctx.moveTo(from.x - (this.trail.length - i) * 2.2, from.y);
      ctx.lineTo(to.x - (this.trail.length - i - 1) * 2.2, to.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, playerX: number, drawY: number): void {
    const radius = 9;
    // Squash on the ground, stretch in flight — cheap weight cue with no art.
    const squash = this.onGround ? 1.15 : 1 - Math.min(this.airborneSeconds, 0.4) * 0.35;
    ctx.fillStyle = PALETTE.player;
    ctx.beginPath();
    ctx.ellipse(playerX, drawY - radius, radius * squash, radius / squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHud(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const inset = this.viewport.safeArea;
    const left = 16 + inset.left;
    const top = 22 + inset.top;

    ctx.fillStyle = PALETTE.text;
    ctx.textBaseline = 'alphabetic';

    ctx.font = '600 22px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${Math.floor(this.distance / 10)} m`, left, top);

    ctx.globalAlpha = 0.7;
    ctx.font = '500 13px ui-monospace, monospace';
    ctx.fillText(`BEST ${Math.floor(this.best / 10)} m`, left, top + 20);
    ctx.fillText(
      `${this.isDaily ? 'DAILY' : 'SEED'} ${this.seedCode}`,
      left,
      top + 38,
    );

    // Right-aligned diagnostics, useful when this runs on a real phone.
    ctx.textAlign = 'right';
    const right = width - 16 - inset.right;
    ctx.fillText(`${Math.round(this.loop.fps)} fps`, right, top);
    ctx.fillText(`${this.loop.frameMs.toFixed(1)} ms`, right, top + 18);
    if (this.viewport.renderScale < 1) {
      ctx.fillText(`scale ${this.viewport.renderScale.toFixed(2)}`, right, top + 36);
    }
    ctx.textAlign = 'left';

    if (!this.viewport.isLandscape) {
      ctx.textAlign = 'center';
      ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('rotate to landscape', width / 2, height * 0.5);
      ctx.textAlign = 'left';
    }

    if (this.paused) {
      ctx.textAlign = 'center';
      ctx.font = '600 28px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('PAUSED', width / 2, height * 0.42);
      ctx.textAlign = 'left';
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Drops resolution when the device cannot hold the frame budget. Sustained cost
   * is what matters, so a single expensive frame does not trigger it.
   */
  private watchdog(): void {
    if (this.loop.frameMs > 20) {
      this.overBudgetSeconds += 1 / 60;
      if (this.overBudgetSeconds > 2 && this.viewport.renderScale > 0.4) {
        this.viewport.renderScale -= 0.15;
        this.skyCache = null;
        this.overBudgetSeconds = 0;
      }
    } else {
      this.overBudgetSeconds = Math.max(0, this.overBudgetSeconds - 1 / 120);
    }
  }
}

// --- entry ------------------------------------------------------------------

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas is missing');
}

new SpineTest(new Viewport(canvas));
