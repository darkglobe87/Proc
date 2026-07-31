/**
 * The region director — what activates a twist now that Shifts aren't a timer.
 *
 * Replaces the old `TwistScheduler`: instead of a random pick landing every
 * 35-45 seconds, the active twist set is a pure function of where the player is —
 * `world.regionAt(player.x).law`. Twists themselves are unchanged (see
 * `twists/types.ts`): the same fold-fresh-every-frame contract, the same
 * `onActivate`/`onDeactivate` lifecycle, just triggered by crossing a boundary
 * instead of a clock running out.
 *
 * "Approaching" replaces the old timed telegraph: since regions have real extent
 * and the player can walk either direction, a boundary is announced by peeking
 * a little way ahead *in whichever direction the player currently faces*, which
 * reads correctly however they approach it rather than assuming travel is always
 * rightward.
 */

import type { GameBus } from './events';
import type { Player } from '../player/player';
import type { World } from '../world/world';
import type { Region } from '../world/regions';
import { DEFAULT_MODIFIERS, type PhysicsModifiers } from '../player/player';
import { DEFAULT_RENDER_MODIFIERS, type RenderModifiers } from './camera';
import type { InputSnapshot } from '../core/input';
import type { SceneBuilder } from '../render/scene';
import type { Twist, TwistId, TwistRuntimeContext } from '../twists/types';
import type { Chime } from '../world/chimes';

/** How far ahead (in the facing direction) to watch for the next boundary. */
const APPROACH_LOOKAHEAD = 250;

/**
 * How far past a boundary the player must travel before the new region's law
 * actually takes over from physics/input's point of view.
 *
 * Without this, a boundary is a single point with zero width, and Mirror's law
 * (the only one that flips `moveAxis`) is its own inverse: cross in, the flip
 * immediately reverses your held direction, cross back out, the flip lifts and
 * your held direction immediately carries you back in — all within one or two
 * 60Hz steps, far faster than any player's (or script's) input timing could ever
 * catch it in a different phase. Widening the boundary into a real distance
 * turns that sub-frame flicker into a clean, readable "you got pushed back"
 * instead. It does not, by itself, guarantee forward progress — see
 * `GRACE_BASE_SECONDS` below for what does.
 */
const LAW_HYSTERESIS = 48;

/**
 * The first free-passage window granted on (re-)entering a region whose law
 * previously pushed the player back out, doubling on each further rejection.
 *
 * Mirror's flip is an exact involution and `Player`'s accel/decel rates are the
 * same in both directions, so under literally unchanging held input, entering,
 * reversing and retreating is a perfectly symmetric round trip: it always
 * returns the player to within the same hysteresis band with the same speed,
 * forever, regardless of how wide that band is — verified directly (25/25
 * random seeds still deadlocked after 3000 simulated steps with hysteresis
 * alone, at every margin tried from 48 to 2000px). No fixed-size delay escapes
 * this, because the trap is scale-invariant; only a delay that *grows* can.
 *
 * So instead of a fixed grace period, each rejection of the same region doubles
 * the next one's length. Doubling from a fraction of a second guarantees the
 * grace window's unopposed travel distance exceeds any region's actual length
 * within a handful of rejections, at which point the player simply walks out
 * the far side before the law ever gets a chance to re-engage. A player with
 * any real variation in their held input (which is to say, every real player)
 * typically escapes on the first or second try, before the backoff even grows
 * large enough to notice; only perfectly unchanging input ever rides it out to
 * the guaranteed-passage case.
 */
const GRACE_BASE_SECONDS = 0.35;

export interface DirectorHooks {
  world: World;
  player: Player;
  bus: GameBus;
  collectChime(chime: Chime): void;
}

export class RegionDirector {
  private active: Twist[] = [];
  private currentRegionIndex = -1;
  private currentRegion: Region | null = null;
  private approaching: Region | null = null;

  private clock = 0;
  /** Consecutive rejections per region index, reset once the region is actually cleared. */
  private rejections = new Map<number, number>();
  /** The region currently under a free-passage grace window, if any. */
  private grace: { regionIndex: number; until: number } | null = null;

  constructor(private readonly registry: readonly Twist[]) {}

  /** Clears all state for a fresh run — forces re-entry into region 0 on the next update. */
  reset(): void {
    for (const twist of this.active) twist.onDeactivate?.();
    this.active = [];
    this.currentRegionIndex = -1;
    this.currentRegion = null;
    this.approaching = null;
    this.rejections.clear();
    this.grace = null;
  }

  get activeLabels(): readonly string[] {
    return this.active.map((twist) => twist.label);
  }

  /** The region the player is currently standing in, or null before the first update. */
  get region(): Region | null {
    return this.currentRegion;
  }

  /** The region just ahead of the player's facing, if a boundary is within sight. */
  get approachingRegion(): Region | null {
    return this.approaching;
  }

  /** Folds the active set's physics hooks over the neutral baseline. */
  computePhysicsModifiers(): PhysicsModifiers {
    let modifiers: PhysicsModifiers = { ...DEFAULT_MODIFIERS };
    for (const twist of this.active) {
      if (twist.physics) modifiers = twist.physics(modifiers);
    }
    return modifiers;
  }

  /** Folds the active set's render hooks over the neutral baseline. */
  computeRenderModifiers(): RenderModifiers {
    let modifiers: RenderModifiers = { ...DEFAULT_RENDER_MODIFIERS };
    for (const twist of this.active) {
      if (twist.render) modifiers = twist.render(modifiers);
    }
    return modifiers;
  }

  /** Folds the active set's input transforms, in activation order. */
  transformInput(input: Readonly<InputSnapshot>, dt: number): InputSnapshot {
    let result: InputSnapshot = input as InputSnapshot;
    for (const twist of this.active) {
      if (twist.transformInput) result = twist.transformInput(result, dt);
    }
    return result;
  }

  /** Extra scene primitives from the active set — Echo's ghost, chiefly. */
  emit(builder: SceneBuilder): void {
    for (const twist of this.active) twist.emit?.(builder);
  }

  /** Active twists' own per-frame upkeep, region-crossing detection, and the approach peek. */
  update(dt: number, hooks: DirectorHooks): void {
    this.clock += dt;
    for (const twist of this.active) twist.update?.(dt);

    const region = this.resolveCurrentRegion(hooks.player.x, hooks.world);
    if (region.index !== this.currentRegionIndex) {
      // A retreat back out of the region we were just in, under its own law's push
      // (not the player deliberately backtracking through calm ground), counts as
      // a rejection — see GRACE_BASE_SECONDS for why this escalates.
      if (this.currentRegion && region.index < this.currentRegion.index && this.currentRegion.law.length > 0) {
        const index = this.currentRegion.index;
        this.rejections.set(index, (this.rejections.get(index) ?? 0) + 1);
      } else if (this.currentRegion && region.index > this.currentRegion.index) {
        // Cleanly cleared the region behind us — it gets a fresh count if we ever return.
        this.rejections.delete(this.currentRegion.index);
      }
      this.enterRegion(region, hooks);
    } else if (
      this.grace &&
      this.grace.regionIndex === region.index &&
      this.clock >= this.grace.until &&
      this.active.length === 0
    ) {
      // Grace ran out while still standing in the graced region: the law applies for real now.
      this.grace = null;
      this.applyLaw(region, hooks);
    }

    const facing = hooks.player.facing || 1;
    const peek = hooks.world.regionAt(hooks.player.x + APPROACH_LOOKAHEAD * facing);
    if (peek.index !== region.index) {
      if (this.approaching?.index !== peek.index) {
        hooks.bus.emit('region:approach', { name: peek.name, law: this.labelsFor(peek) });
      }
      this.approaching = peek;
    } else {
      this.approaching = null;
    }
  }

  /**
   * The region actually governing physics/input/palette this frame — the raw
   * geographic region, but debounced by `LAW_HYSTERESIS` past whichever boundary
   * the player is crossing. See that constant for why the debounce exists.
   */
  private resolveCurrentRegion(x: number, world: World): Region {
    const raw = world.regionAt(x);
    if (!this.currentRegion || raw.index === this.currentRegion.index) return raw;
    if (raw.index > this.currentRegion.index) {
      return x >= raw.from + LAW_HYSTERESIS ? raw : this.currentRegion;
    }
    return x <= raw.to - LAW_HYSTERESIS ? raw : this.currentRegion;
  }

  private enterRegion(region: Region, hooks: DirectorHooks): void {
    this.currentRegionIndex = region.index;
    this.currentRegion = region;

    const rejectionCount = this.rejections.get(region.index) ?? 0;
    if (rejectionCount > 0 && region.law.length > 0) {
      // Already fought this region's law at least once: grant an escalating,
      // unopposed window before it engages again, rather than refighting an
      // unwinnable rematch — see GRACE_BASE_SECONDS.
      this.active = [];
      this.grace = {
        regionIndex: region.index,
        until: this.clock + GRACE_BASE_SECONDS * 2 ** (rejectionCount - 1),
      };
    } else {
      this.grace = null;
      this.applyLaw(region, hooks);
    }

    hooks.bus.emit('region:enter', {
      name: region.name,
      law: this.active.map((twist) => twist.label),
      index: region.index,
    });
  }

  /** Activates `region`'s real law, deactivating whatever was active before. */
  private applyLaw(region: Region, hooks: DirectorHooks): void {
    const ctx: TwistRuntimeContext = {
      player: hooks.player,
      world: hooks.world,
      bus: hooks.bus,
      collectChime: hooks.collectChime,
    };
    for (const twist of this.active) twist.onDeactivate?.();
    this.active = region.law.map((id) => this.byId(id));
    for (const twist of this.active) twist.onActivate?.(ctx);
  }

  private labelsFor(region: Region): readonly string[] {
    return region.law.map((id) => this.byId(id).label);
  }

  private byId(id: TwistId): Twist {
    const twist = this.registry.find((candidate) => candidate.id === id);
    if (!twist) throw new Error(`unknown twist id: ${id}`);
    return twist;
  }
}
