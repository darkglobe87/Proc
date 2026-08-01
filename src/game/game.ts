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
import { DUSK, lerpPalette, paletteById, type Palette } from '../render/palette';
import { ANCHOR_X } from './camera';
import { Camera } from './camera';
import { World } from '../world/world';
import { CHIME_RADIUS, type Chime } from '../world/chimes';
import type { Landmark } from '../world/landmarks';
import { FRAGMENTS, fragmentById, npcById } from '../world/lore';
import { Player, PLAYER_RADIUS } from '../player/player';
import { drawHud } from '../ui/hud';
import type { GameEvents } from './events';
import { RegionDirector, type DirectorHooks } from './director';
import { createTwistRegistry } from '../twists/registry';

export type GameState = 'ready' | 'exploring';

/** World pixels per displayed metre. */
const PIXELS_PER_METRE = 10;
/** Horizontal sample spacing when tessellating a dune band, in screen pixels. */
const BAND_STEP = 12;
const TRAIL_LENGTH = 18;
/** How long a palette crossfade takes when crossing into a new region. */
const PALETTE_CROSSFADE_SECONDS = 0.6;
/** How long the "just entered" region name banner stays up before fading. */
const REGION_BANNER_SECONDS = 3;
/** Region lengths under `?fastshift` — see `RegionField`'s constructor. */
const FAST_REGION_LENGTH: readonly [number, number] = [250, 450];
/** How close the player must stand to a landmark for interact to reach it. */
const INTERACT_REACH = 70;
/** How long a revealed line of dialogue or a fragment's text stays on screen. */
const SPEECH_SECONDS = 4.5;
/** The tail of SPEECH_SECONDS spent fading out rather than snapping off. */
const SPEECH_FADE_SECONDS = 0.6;
/** Storage key for the cross-run fragment journal — deliberately not per-seed. */
const JOURNAL_STORAGE_KEY = 'journal.fragments';

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
  /** Development aid: shrink every region to a couple hundred px instead of thousands. */
  fastShift?: boolean;
}

/** Stable pseudo-random 0..1 from an integer seed — deterministic per-instance jitter for decor. */
function pseudoRandom(seed: number): number {
  const s = Math.sin(seed) * 43758.5453;
  return s - Math.floor(s);
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
  private readonly director: RegionDirector;
  /** Reused every frame rather than allocated — see DirectorHooks. */
  private readonly directorHooks: DirectorHooks;

  private state: GameState = 'ready';
  private time = 0;
  private furthest: number;
  private chimes = 0;
  private paused = false;

  /** Region banner: the name shown briefly on entering a new one, then faded. */
  private bannerName = '';
  private bannerTimer = 0;

  /** Palette crossfade state, advanced against `this.time` rather than a per-frame dt. */
  private paletteId = 'dusk';
  private paletteFrom: Palette = DUSK;
  private paletteTo: Palette = DUSK;
  private paletteStartTime = 0;

  /** The nearest landmark within interact range this frame, if any. */
  private nearLandmark: Landmark | null = null;
  /** Which line an NPC says next, keyed by the landmark's region index — cycles per visit. */
  private readonly npcLineIndex = new Map<number, number>();
  /** Fragment ids ever found, persisted across runs — the journal. */
  private readonly journal: Set<string>;

  /** A revealed line of dialogue or fragment text, anchored above where it was found. */
  private speechTitle = '';
  private speechText = '';
  private speechTimer = 0;
  private speechX = 0;
  private speechY = 0;

  private readonly trail: number[] = [];
  private overBudgetSeconds = 0;

  constructor(
    private readonly viewport: Viewport,
    private readonly options: GameOptions,
  ) {
    const rng = new Rng(options.seed);
    this.world = new World(rng, options.fastShift ? FAST_REGION_LENGTH : undefined);
    this.player = new Player(this.world);
    this.renderer = new Renderer(viewport, this.style);

    // Forking from the same top-level seed as World/Terrain, not consuming from them:
    // fork() never advances the parent stream, so this is independent of how many
    // chunks get generated and does not disturb their determinism either.
    this.director = new RegionDirector(createTwistRegistry(rng));
    this.directorHooks = {
      world: this.world,
      player: this.player,
      bus: this.bus,
      collectChime: (chime) => this.collectOne(chime),
    };

    this.furthest = storage.load<number>('furthest.distance', 0);
    this.journal = new Set(storage.load<string[]>(JOURNAL_STORAGE_KEY, []));

    this.input.attach(viewport.canvas);
    this.camera.snap();

    this.bus.on('region:enter', ({ name }) => {
      this.bannerName = name;
      this.bannerTimer = REGION_BANNER_SECONDS;
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

    if (this.state === 'ready') {
      if (input.jumpPressed || input.moveAxis !== 0) this.state = 'exploring';
    }

    if (this.state === 'exploring') {
      // Computed before the physics step, so a region's laws are what the player's own
      // input and movement are actually evaluated against this frame.
      const modifiers = this.director.computePhysicsModifiers();
      const effectiveInput = this.director.transformInput(input, dt);
      this.player.update(dt, effectiveInput, this.bus, modifiers);

      this.collectChimes();
      this.updateLandmarks(input.interactPressed);
      this.director.update(dt, this.directorHooks);
      if (this.bannerTimer > 0) this.bannerTimer = Math.max(0, this.bannerTimer - dt);
      if (this.speechTimer > 0) this.speechTimer = Math.max(0, this.speechTimer - dt);

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
   * `DirectorHooks.collectChime` so a twist that awards a chime on the player's
   * behalf (Echo's ghost) cannot silently diverge from how a live pickup is counted.
   */
  private collectOne(chime: Chime): void {
    if (!this.world.collect(chime)) return;
    this.chimes++;
    this.bus.emit('chime:collect', { pitch: chime.pitch, index: chime.index, total: chime.total });
  }

  /**
   * Finds the nearest landmark in interact range (for the HUD prompt) and, on an
   * interact press, triggers it. Unlike chimes, a landmark is never auto-collected
   * by proximity alone — talking to someone or reading something is a deliberate
   * choice, not something that happens to you by walking past it.
   */
  private updateLandmarks(interactPressed: boolean): void {
    let closest: Landmark | null = null;
    let closestDistance = Infinity;
    for (const landmark of this.world.landmarksNear(this.player.x, INTERACT_REACH * 3)) {
      const distance = Math.abs(landmark.x - this.player.x);
      if (distance > INTERACT_REACH || distance >= closestDistance) continue;
      closest = landmark;
      closestDistance = distance;
    }
    this.nearLandmark = closest;
    if (closest && interactPressed) this.triggerLandmark(closest);
  }

  private triggerLandmark(landmark: Landmark): void {
    if (landmark.kind === 'npc') {
      const npc = npcById(landmark.contentId);
      const line = this.npcLineIndex.get(landmark.regionIndex) ?? 0;
      this.npcLineIndex.set(landmark.regionIndex, (line + 1) % npc.lines.length);
      this.showSpeech(npc.name, npc.lines[line % npc.lines.length] as string, landmark);
      return;
    }

    const fragment = fragmentById(landmark.contentId);
    if (!this.journal.has(fragment.id)) {
      this.journal.add(fragment.id);
      storage.save(JOURNAL_STORAGE_KEY, [...this.journal]);
    }
    this.showSpeech(fragment.title, fragment.lines.join('\n'), landmark);
  }

  private showSpeech(title: string, text: string, at: Landmark): void {
    this.speechTitle = title;
    this.speechText = text;
    this.speechTimer = SPEECH_SECONDS;
    this.speechX = at.x;
    this.speechY = at.y;
  }

  private render(alpha: number): void {
    const { width, height } = this.viewport;

    // Interpolate between simulation steps so motion is smooth at any refresh rate.
    const drawX = this.player.previousX + (this.player.x - this.player.previousX) * alpha;
    const drawY = this.player.previousY + (this.player.y - this.player.previousY) * alpha;

    // Applied to the camera every frame rather than by the twists directly: the camera
    // has no notion that twists exist, only fields a render fold happens to write to.
    const renderMods = this.director.computeRenderModifiers();
    this.camera.rotation = renderMods.rotation;
    this.camera.mirrorX = renderMods.mirrorX;

    this.updatePalette();
    this.builder.begin(this.camera, this.time);

    for (const band of BANDS) this.emitBand(band, width, height);
    this.emitSolids(width);
    this.emitDecor(width);
    this.emitLandmarks(width);
    this.emitChimes(width);
    this.emitTrail(drawX, drawY);
    this.emitPlayer(drawX, drawY);
    this.director.emit(this.builder);
    // Suppressed while paused: the journal overlay already covers whatever was just
    // revealed, and drawing both at once is just two texts fighting for the same
    // screen space.
    if (!this.paused) this.emitSpeech();

    const approaching = this.director.approachingRegion;
    const showInteractPrompt = this.nearLandmark !== null && this.speechTimer <= 0;
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
        activeTwists: this.director.activeLabels,
        bannerName: this.bannerTimer > 0 ? this.bannerName : '',
        approachingName: approaching?.name ?? '',
        interactPrompt: showInteractPrompt
          ? this.nearLandmark?.kind === 'npc'
            ? 'talk'
            : 'read'
          : '',
        fragmentsFound: this.journal.size,
        fragmentsTotal: FRAGMENTS.length,
        paused: this.paused,
        journalTitles: [...this.journal].map((id) => fragmentById(id).title),
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

  /**
   * Starts (or continues) a crossfade to the current region's palette. Progress is
   * measured against `this.time` rather than a per-frame dt — `render()` only receives
   * an interpolation alpha, not a step size — so a crossfade that spans several frames
   * still advances smoothly regardless of render cadence.
   */
  private updatePalette(): void {
    const region = this.director.region;
    if (region && region.paletteId !== this.paletteId) {
      // Whatever is currently on screen, even mid-fade, is the new starting point —
      // crossing two boundaries in quick succession blends onward rather than snapping.
      this.paletteFrom = this.renderer.palette;
      this.paletteTo = paletteById(region.paletteId);
      this.paletteStartTime = this.time;
      this.paletteId = region.paletteId;
    }

    const t = Math.min(1, (this.time - this.paletteStartTime) / PALETTE_CROSSFADE_SECONDS);
    this.renderer.palette = t >= 1 ? this.paletteTo : lerpPalette(this.paletteFrom, this.paletteTo, t);
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
   * Decor, dispatched to a distinct silhouette per variant so "rock" and "ruin" and
   * "building" actually read as different things rather than one shape reused. Variants
   * 0-3 are natural (chunks.ts only ever generates these outside a settlement); 4-5 are
   * built, generated only inside one.
   */
  private emitDecor(width: number): void {
    const { left, right } = this.worldBounds(width);
    for (const decor of this.world.decorNear(this.camera.x, (right - left) / 2 + 200)) {
      if (decor.x < left - 40 || decor.x > right + 40) continue;

      switch (decor.variant) {
        case 0:
          this.emitBoulder(decor.x, decor.y, decor.width, decor.height, decor.id);
          break;
        case 1:
          this.emitSpire(decor.x, decor.y, decor.width, decor.height);
          break;
        case 2:
          this.emitRuin(decor.x, decor.y, decor.width, decor.height, decor.id);
          break;
        case 3:
          this.emitCluster(decor.x, decor.y, decor.width, decor.height, decor.id);
          break;
        case 4:
          this.emitHut(decor.x, decor.y, decor.width, decor.height);
          break;
        default:
          this.emitTower(decor.x, decor.y, decor.width, decor.height, decor.id);
          break;
      }
    }
  }

  /** A rounded, slightly irregular boulder — one lump, jittered per instance. */
  private emitBoulder(cx: number, cy: number, width: number, height: number, seed: number): void {
    const halfW = width / 2;
    const h = height * 0.55;
    const j = (i: number): number => (pseudoRandom(seed * 13 + i) - 0.5) * 0.3;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - halfW, cy);
    this.builder.point(cx + (-0.85 + j(0)) * halfW, cy + (-0.4 + j(1)) * h * 2);
    this.builder.point(cx + (-0.4 + j(2)) * halfW, cy + (-1 + j(3)) * h);
    this.builder.point(cx + (0.3 + j(4)) * halfW, cy + (-1 + j(5)) * h);
    this.builder.point(cx + (0.85 + j(6)) * halfW, cy + (-0.4 + j(7)) * h * 2);
    this.builder.point(cx + halfW, cy);
    this.builder.end();

    this.builder.polyline('accent', 'entities', 2, 0.7);
    this.builder.point(cx + (-0.4 + j(2)) * halfW, cy + (-1 + j(3)) * h);
    this.builder.point(cx + (0.3 + j(4)) * halfW, cy + (-1 + j(5)) * h);
    this.builder.end();
  }

  /** A tall, narrow, tapered spire — the original decor shape. */
  private emitSpire(cx: number, cy: number, width: number, height: number): void {
    const half = width / 2;
    const top = cy - height;
    const taper = half * 0.35;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - half, cy);
    this.builder.point(cx - half + taper, top);
    this.builder.point(cx + half - taper, top);
    this.builder.point(cx + half, cy);
    this.builder.end();

    this.builder.polyline('accent', 'entities', 2, 0.8);
    this.builder.point(cx + half - taper, top);
    this.builder.point(cx + half, cy);
    this.builder.end();
  }

  /** A rectangular block with an irregular, broken top — jagged, not clean-edged. */
  private emitRuin(cx: number, cy: number, width: number, height: number, seed: number): void {
    const half = width / 2;
    const baseTop = cy - height * 0.7;
    const teeth = 4;
    const j = (i: number): number => pseudoRandom(seed * 31 + i) * height * 0.35;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - half, cy);
    this.builder.point(cx - half, baseTop);
    for (let i = 0; i <= teeth; i++) {
      const x = cx - half + (width * i) / teeth;
      this.builder.point(x, baseTop - j(i));
    }
    this.builder.point(cx + half, cy);
    this.builder.end();
  }

  /** Two or three small overlapping stones — reuses the boulder shape at a smaller scale. */
  private emitCluster(cx: number, cy: number, width: number, height: number, seed: number): void {
    const stones = 2 + Math.floor(pseudoRandom(seed) * 2); // 2 or 3
    for (let i = 0; i < stones; i++) {
      const spread = width * 0.35;
      const dx = (pseudoRandom(seed * 7 + i) - 0.5) * 2 * spread;
      const scale = 0.5 + pseudoRandom(seed * 11 + i) * 0.35;
      this.emitBoulder(cx + dx, cy, width * scale, height * scale, seed + i * 97);
    }
  }

  /** A small hut: a box wall with an overhanging triangular roof. */
  private emitHut(cx: number, cy: number, width: number, height: number): void {
    const half = width / 2;
    const wallH = height * 0.55;
    const roofH = height * 0.5;
    const overhang = half * 1.2;
    const wallTop = cy - wallH;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - half, cy);
    this.builder.point(cx - half, wallTop);
    this.builder.point(cx - overhang, wallTop);
    this.builder.point(cx, wallTop - roofH);
    this.builder.point(cx + overhang, wallTop);
    this.builder.point(cx + half, wallTop);
    this.builder.point(cx + half, cy);
    this.builder.end();

    this.builder.polyline('accent', 'entities', 2, 0.85);
    this.builder.point(cx - overhang, wallTop);
    this.builder.point(cx, wallTop - roofH);
    this.builder.point(cx + overhang, wallTop);
    this.builder.end();
  }

  /** A tall tower with a peaked cap and a single lit window. */
  private emitTower(cx: number, cy: number, width: number, height: number, seed: number): void {
    const half = width / 2;
    const bodyH = height * 0.85;
    const capH = height * 0.3;
    const bodyTop = cy - bodyH;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - half, cy);
    this.builder.point(cx - half, bodyTop);
    this.builder.point(cx, bodyTop - capH);
    this.builder.point(cx + half, bodyTop);
    this.builder.point(cx + half, cy);
    this.builder.end();

    this.builder.polyline('accent', 'entities', 2, 0.85);
    this.builder.point(cx - half, bodyTop);
    this.builder.point(cx, bodyTop - capH);
    this.builder.point(cx + half, bodyTop);
    this.builder.end();

    // A lantern glow, offset so it doesn't sit dead-centre on every tower.
    const windowY = cy - bodyH * (0.35 + pseudoRandom(seed) * 0.3);
    this.builder.disc('accent', 'entities', cx, windowY, 2.4, 0.9);
  }

  /** NPCs and fragments — the one authored thing per region. See `world/landmarks.ts`. */
  private emitLandmarks(width: number): void {
    const { left, right } = this.worldBounds(width);
    for (const landmark of this.world.landmarksNear(this.camera.x, (right - left) / 2 + 200)) {
      if (landmark.x < left - 40 || landmark.x > right + 40) continue;
      if (landmark.kind === 'npc') this.emitNpc(landmark.x, landmark.y);
      else this.emitFragmentMarker(landmark.x, landmark.y, landmark.regionIndex);
    }
  }

  /**
   * A robed, standing silhouette — built from the same shapes as decor (so it reads
   * as belonging to the same world) but flared at the hem rather than tapered, so it
   * never gets mistaken for a spire, plus a soft pulsing marker above the head as the
   * one deliberate tell that this figure, unlike a rock, is worth walking up to.
   */
  private emitNpc(cx: number, cy: number): void {
    const halfW = 10;
    const bodyH = 34;
    const flare = 5;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - halfW - flare, cy);
    this.builder.point(cx - halfW, cy - bodyH * 0.72);
    this.builder.point(cx - halfW * 0.55, cy - bodyH);
    this.builder.point(cx + halfW * 0.55, cy - bodyH);
    this.builder.point(cx + halfW, cy - bodyH * 0.72);
    this.builder.point(cx + halfW + flare, cy);
    this.builder.end();

    this.builder.disc('rock', 'entities', cx, cy - bodyH - 8, 8);

    const pulse = 1 + Math.sin(this.time * 3) * 0.25;
    this.builder.disc('accent', 'entities', cx, cy - bodyH - 26, 3 * pulse, 0.85);
  }

  /** A small waystone with a pulsing core — something found, not something standing. */
  private emitFragmentMarker(cx: number, cy: number, seed: number): void {
    const halfW = 7;
    const h = 26;

    this.builder.polygon('rock', 'entities');
    this.builder.point(cx - halfW, cy);
    this.builder.point(cx - halfW, cy - h * 0.7);
    this.builder.point(cx, cy - h);
    this.builder.point(cx + halfW, cy - h * 0.7);
    this.builder.point(cx + halfW, cy);
    this.builder.end();

    const pulse = 1 + Math.sin(this.time * 2.4 + seed) * 0.3;
    this.builder.disc('chime', 'entities', cx, cy - h * 0.55, 3 * pulse, 0.9);
  }

  /**
   * A revealed line of dialogue or fragment text, floating above where it was found.
   * World-anchored (not HUD), so it scrolls, mirrors and rotates with everything else
   * exactly the way the landmark it belongs to does.
   */
  private emitSpeech(): void {
    if (this.speechTimer <= 0) return;
    const alpha = Math.min(1, this.speechTimer / SPEECH_FADE_SECONDS);
    const baseY = this.speechY - 66;

    this.builder.text(
      'text',
      'entities',
      this.speechX,
      baseY - 18,
      this.speechTitle.toUpperCase(),
      13,
      'center',
      700,
      alpha,
    );
    const lines = this.speechText.split('\n');
    lines.forEach((line, i) => {
      this.builder.text(
        'textDim',
        'entities',
        this.speechX,
        baseY + i * 16,
        line,
        13,
        'center',
        500,
        alpha,
      );
    });
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
        this.builder.polyline('accent', 'entities', 3, 0.6);
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

    const halfWidth = 9;
    const bodyHeight = 30;

    const corners: ReadonlyArray<readonly [number, number]> = [
      [-halfWidth, -bodyHeight],
      [halfWidth, -bodyHeight],
      [halfWidth, 0],
      [-halfWidth, 0],
    ];

    this.builder.polygon('player', 'entities');
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
    );

    const noseLocalX = this.player.facing * (halfWidth + 5);
    const noseLocalY = -bodyHeight * 0.28;
    this.builder.disc(
      'accent',
      'entities',
      x + noseLocalX * cos - noseLocalY * sin,
      y + noseLocalX * sin + noseLocalY * cos,
      3,
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
