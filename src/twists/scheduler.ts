/**
 * The Shift scheduler — the centrepiece of the design.
 *
 * A state machine with two concerns, kept deliberately separate:
 *
 *  1. **When** the next Shift happens: a distance/time race (whichever comes
 *     first), each rerolled per cycle from the scheduler's own RNG stream.
 *  2. **What** it changes: a telegraph window so the change is never a surprise
 *     the player couldn't see coming, then a swap of the active twist set.
 *
 * Twists themselves are folded fresh every frame (see `types.ts`) — the scheduler
 * only decides *which* twists are in the active set, never mutates game state
 * directly except through that fold and the two lifecycle hooks.
 */

import type { Rng } from '../core/rng';
import type { GameBus } from '../game/events';
import type { InputSnapshot } from '../core/input';
import type { SceneBuilder } from '../render/scene';
import type { World } from '../world/world';
import { DEFAULT_MODIFIERS, type Player, type PhysicsModifiers } from '../player/player';
import { DEFAULT_RENDER_MODIFIERS, type RenderModifiers } from '../game/camera';
import type { Twist, TwistId, TwistRuntimeContext } from './types';
import type { Chime } from '../world/chimes';

/** Warning before a Shift actually applies. Long enough to read, short enough to bite. */
export const TELEGRAPH_SECONDS = 1.5;

const MIN_SHIFT_SECONDS = 35;
const MAX_SHIFT_SECONDS = 45;
/** ~400–600 m at the game's 10 px/m HUD convention (see game.ts PIXELS_PER_METRE). */
const MIN_SHIFT_PX = 4000;
const MAX_SHIFT_PX = 6000;

/** The Shift number (1-indexed) at which the active set becomes a pair instead of one. */
const PAIR_FROM_SHIFT = 6;

export interface SchedulerHooks {
  world: World;
  player: Player;
  bus: GameBus;
  collectChime(chime: Chime): void;
}

type Phase = 'waiting' | 'telegraphing';

export class TwistScheduler {
  private readonly conflicts = new Set<string>();

  private phase: Phase = 'waiting';
  private active: Twist[] = [];
  private pending: Twist[] = [];
  private pool: TwistId[] = [];

  private shiftIndex = 0;
  private timeSinceTrigger = 0;
  private distanceOrigin = 0;
  private thresholdSeconds = 0;
  private thresholdPx = 0;
  private telegraphElapsed = 0;

  constructor(
    private readonly rng: Rng,
    private readonly registry: readonly Twist[],
    /**
     * Overrides the real 35–45s / 4000–6000px thresholds. Exists for the `?fastshift`
     * development flag (see main.ts) so Shifts can be observed in seconds rather than
     * waited out for real — never set outside a debug path.
     */
    private readonly thresholdOverride?: { seconds: readonly [number, number]; px: readonly [number, number] },
  ) {
    for (const twist of registry) {
      for (const other of twist.conflicts ?? []) this.conflicts.add(this.pairKey(twist.id, other));
    }
    this.rerollThresholds();
    this.refillPool();
  }

  /** Clears all state for a fresh run. Does not re-seed — the same seed replays identically. */
  reset(): void {
    for (const twist of this.active) twist.onDeactivate?.();
    this.active = [];
    this.pending = [];
    this.phase = 'waiting';
    this.shiftIndex = 0;
    this.timeSinceTrigger = 0;
    this.distanceOrigin = 0;
    this.telegraphElapsed = 0;
    this.refillPool();
    this.rerollThresholds();
  }

  get activeTwists(): readonly Twist[] {
    return this.active;
  }

  get activeLabels(): readonly string[] {
    return this.active.map((twist) => twist.label);
  }

  get pendingLabels(): readonly string[] {
    return this.pending.map((twist) => twist.label);
  }

  get isTelegraphing(): boolean {
    return this.phase === 'telegraphing';
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

  /**
   * Advances everything time-based: active twists' own per-frame upkeep, and the
   * wait/telegraph/commit cycle.
   */
  update(dt: number, hooks: SchedulerHooks): void {
    for (const twist of this.active) twist.update?.(dt);

    if (this.phase === 'waiting') {
      this.timeSinceTrigger += dt;
      const distanceSinceTrigger = hooks.player.distance - this.distanceOrigin;
      if (this.timeSinceTrigger >= this.thresholdSeconds || distanceSinceTrigger >= this.thresholdPx) {
        this.beginTelegraph(hooks.bus);
      }
      return;
    }

    this.telegraphElapsed += dt;
    if (this.telegraphElapsed >= TELEGRAPH_SECONDS) {
      this.commitShift(hooks);
    }
  }

  private beginTelegraph(bus: GameBus): void {
    this.pending = this.pickTwists();
    this.phase = 'telegraphing';
    this.telegraphElapsed = 0;
    bus.emit('twist:telegraph', { labels: this.pending.map((twist) => twist.label) });
  }

  private commitShift(hooks: SchedulerHooks): void {
    const ctx: TwistRuntimeContext = {
      player: hooks.player,
      world: hooks.world,
      bus: hooks.bus,
      collectChime: hooks.collectChime,
    };

    for (const twist of this.active) twist.onDeactivate?.();
    this.active = this.pending;
    this.pending = [];
    for (const twist of this.active) twist.onActivate?.(ctx);

    this.shiftIndex++;
    this.phase = 'waiting';
    this.timeSinceTrigger = 0;
    this.distanceOrigin = hooks.player.distance;
    this.rerollThresholds();

    hooks.bus.emit('twist:shift', {
      ids: this.active.map((twist) => twist.id),
      shiftIndex: this.shiftIndex,
    });
  }

  private rerollThresholds(): void {
    const [minS, maxS] = this.thresholdOverride?.seconds ?? [MIN_SHIFT_SECONDS, MAX_SHIFT_SECONDS];
    const [minPx, maxPx] = this.thresholdOverride?.px ?? [MIN_SHIFT_PX, MAX_SHIFT_PX];
    this.thresholdSeconds = this.rng.range(minS, maxS);
    this.thresholdPx = this.rng.range(minPx, maxPx);
  }

  private refillPool(): void {
    this.pool = this.rng.shuffle(this.registry.map((twist) => twist.id));
  }

  private pairKey(a: TwistId, b: TwistId): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private conflictsWith(a: TwistId, b: TwistId): boolean {
    return this.conflicts.has(this.pairKey(a, b));
  }

  private byId(id: TwistId): Twist {
    const twist = this.registry.find((candidate) => candidate.id === id);
    if (!twist) throw new Error(`unknown twist id: ${id}`);
    return twist;
  }

  private draw(): TwistId {
    if (this.pool.length === 0) this.refillPool();
    // Guaranteed non-empty: refillPool() always repopulates from a non-empty registry.
    return this.pool.shift() as TwistId;
  }

  /**
   * Chooses the twists for the next Shift: one before the pairing threshold, two
   * from it onward. A pair is drawn compatibly — the second draw is filtered to
   * ids that do not conflict with the first — and falls back to a single twist
   * if the remaining pool has no compatible partner at all, rather than forcing
   * an incompatible pair or stalling.
   */
  private pickTwists(): Twist[] {
    const needed = this.shiftIndex + 1 >= PAIR_FROM_SHIFT ? 2 : 1;

    if (this.pool.length < needed) this.refillPool();
    const firstId = this.draw();
    const first = this.byId(firstId);
    if (needed === 1) return [first];

    const compatible = this.pool.filter((id) => !this.conflictsWith(firstId, id));
    if (compatible.length === 0) return [first];

    const secondId = this.rng.pick(compatible);
    this.pool = this.pool.filter((id) => id !== secondId);
    return [first, this.byId(secondId)];
  }
}
