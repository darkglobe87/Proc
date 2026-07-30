/**
 * The twist contract.
 *
 * A twist is a small bundle of pure functions plus two lifecycle hooks. The pure
 * functions (`physics`, `render`, `transformInput`) are folded over the currently
 * active set fresh every frame — nothing is mutated and reverted, so there is no
 * apply/remove asymmetry to get wrong, and stacking two twists is just folding
 * twice. `onActivate`/`onDeactivate` exist only for state a pure function cannot
 * express: Echo's position history, Wind's chosen direction for this activation.
 *
 * Anything a twist needs from the game — the player's position, the world, a way
 * to award a chime — is captured once from `TwistRuntimeContext` in `onActivate`
 * and held in the twist's own closure. `update`, `render` and friends then need no
 * context parameter at all, which is what keeps the fold functions cheap and the
 * dependency direction one-way: twists know about the game, the game does not
 * know about twists.
 */

import type { InputSnapshot } from '../core/input';
import type { SceneBuilder } from '../render/scene';
import type { GameBus } from '../game/events';
import type { Player, PhysicsModifiers } from '../player/player';
import type { RenderModifiers } from '../game/camera';
import type { World } from '../world/world';
import type { Chime } from '../world/chimes';

export type { PhysicsModifiers, RenderModifiers };

export type TwistId = 'inversion' | 'mirror' | 'moonwalk' | 'wind' | 'metronome' | 'echo';

/** What a twist can reach into at activation time. Captured once, not held onto by the game. */
export interface TwistRuntimeContext {
  player: Player;
  world: World;
  bus: GameBus;
  /**
   * Awards a chime through the game's real scoring path (count, score, flow), so a
   * twist that collects on the player's behalf — Echo — cannot silently diverge from
   * how a normal pickup is scored.
   */
  collectChime(chime: Chime): void;
}

export interface Twist {
  readonly id: TwistId;
  /** Shown in the telegraph banner and the persistent active-twist label. */
  readonly label: string;
  /** Twists this cannot be paired with once pairing begins. Symmetric; list either side. */
  readonly conflicts?: readonly TwistId[];

  /** Called once when the twist becomes active. Capture anything needed from `ctx` here. */
  onActivate?(ctx: TwistRuntimeContext): void;
  /** Called once when the twist is replaced by the next Shift. */
  onDeactivate?(): void;

  /** Per-frame upkeep for a twist with its own state (a recording buffer, a beat clock). */
  update?(dt: number): void;

  /** Folded over the active set to produce this frame's effective physics. */
  physics?(base: Readonly<PhysicsModifiers>): PhysicsModifiers;
  /** Folded over the active set to produce this frame's effective camera treatment. */
  render?(base: Readonly<RenderModifiers>): RenderModifiers;
  /** Folded over the raw input before the player sees it. */
  transformInput?(input: Readonly<InputSnapshot>, dt: number): InputSnapshot;
  /** Extra scene primitives — Echo's ghost — appended after the normal entities. */
  emit?(builder: SceneBuilder): void;
}
