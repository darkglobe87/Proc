/**
 * The person.
 *
 * Feel targets, in priority order:
 *  1. Stopping is a real, instant-feeling choice — the whole reason this is a
 *     platformer rather than a momentum runner is that exploring means being able to
 *     stand still, turn around, and go back the way you came.
 *  2. Jumping forgives near-misses on both ends: coyote time for stepping off an edge
 *     a beat late, a jump buffer for pressing a beat early. Neither is a "trick", they
 *     are what makes precise-looking platforming *feel* precise rather than picky.
 *
 * There is nothing in the world that can hurt or kill the player — this is an
 * exploration game, not a runner with the serial numbers filed off, and a wrong step
 * costing progress fights that. Ground-standing silhouettes are scenery (see
 * `world/decor.ts`), not hazards.
 */

import type { InputSnapshot } from '../core/input';
import type { Terrain } from '../world/terrain';
import type { World } from '../world/world';
import { groundFollowAt, resolveHorizontal, sweepVertical } from '../world/solids';
import type { GameBus } from '../game/events';

const GRAVITY = 2000;
/** Roughly a head-height hop over ~0.5s of hang time at MAX_HOLD_SECONDS. */
const JUMP_VELOCITY = -560;
/** Gravity multiplier while still rising with the button held — variable jump height. */
const HOLD_GRAVITY_SCALE = 0.5;
const MAX_HOLD_SECONDS = 0.25;

const MAX_SPEED = 210;
/** Ground acceleration toward `moveAxis * MAX_SPEED`, px/s². */
const MOVE_ACCEL = 2400;
/** Slightly brisker than acceleration, so releasing the pad reads as a crisp stop. */
const FRICTION_DECEL = 2800;
/** Reduced control in the air — you can steer a jump, but not turn on a dime. */
const AIR_ACCEL = 1100;

/**
 * Grace windows around a jump, in seconds.
 *
 * Both exist for the same reason: a platformer that only accepts a jump input at the
 * exact physical instant an edge or a landing occurs feels unresponsive no matter how
 * good the underlying physics are. Coyote time forgives stepping off an edge a beat
 * before pressing; the buffer forgives pressing a beat before actually landing.
 */
const COYOTE_SECONDS = 0.1;
const JUMP_BUFFER_SECONDS = 0.12;

/** Peak cosmetic lean toward the direction of travel. */
const LEAN_MAX = (10 * Math.PI) / 180;
const LEAN_EASE = 10;

export const PLAYER_RADIUS = 9;
/** Half-width and full height of the collision box used for solids. */
const BODY_HALF_WIDTH = 9;
const BODY_HEIGHT = 30;
/** How far ahead to look for solids each step. */
const SOLID_REACH = 90;

/**
 * The continuous knobs a twist may bend, owned here rather than by the twist system:
 * Player is what interprets them, so it defines what "gravityScale" or "windAccel"
 * actually mean. Twists import this shape rather than the other way around, which
 * keeps the dependency direction the design commits to — twists know about the
 * player, the player has no notion that twists exist, only that some numbers might
 * arrive scaled or offset from neutral.
 */
export interface PhysicsModifiers {
  /** Multiplies gravity's magnitude. Below 1 is floatier, above 1 is heavier. */
  gravityScale: number;
  /** Constant lateral accel/decel, px/s². Applied regardless of facing. */
  windAccel: number;
}

export const DEFAULT_MODIFIERS: Readonly<PhysicsModifiers> = {
  gravityScale: 1,
  windAccel: 0,
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  grounded = true;
  /** Last non-zero horizontal direction faced, for sprite orientation. */
  facing: 1 | -1 = 1;
  /** Cosmetic lean, radians. Never load-bearing the way a runner's body angle was. */
  rotation = 0;

  /** Previous-step position, for render interpolation. */
  previousX = 0;
  previousY = 0;

  /** Furthest x ever reached, for camera look-ahead and a soft "furthest" stat. */
  distance = 0;

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;

  /**
   * This step's modifiers, valid only for the duration of the current `update()` call.
   * A field rather than a parameter threaded through every private method — `update()`
   * is the only entry point, called once per fixed step, so there is no reentrancy risk.
   */
  private mods: Readonly<PhysicsModifiers> = DEFAULT_MODIFIERS;

  constructor(private readonly world: World) {
    this.y = this.terrain.heightAt(0);
    this.previousY = this.y;
  }

  private get terrain(): Terrain {
    return this.world.terrain;
  }

  reset(): void {
    this.x = 0;
    this.y = this.terrain.heightAt(0);
    this.previousX = 0;
    this.previousY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.facing = 1;
    this.rotation = 0;
    this.distance = 0;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
  }

  update(
    dt: number,
    input: Readonly<InputSnapshot>,
    bus: GameBus,
    modifiers: Readonly<PhysicsModifiers> = DEFAULT_MODIFIERS,
  ): void {
    this.previousX = this.x;
    this.previousY = this.y;
    this.mods = modifiers;

    if (input.jumpPressed) this.jumpBufferTimer = JUMP_BUFFER_SECONDS;
    else if (this.jumpBufferTimer > 0) this.jumpBufferTimer -= dt;

    if (this.grounded) {
      this.updateGrounded(dt, input, bus);
    } else {
      this.updateAirborne(dt, input, bus);
    }

    this.easeLean(dt, input);
    this.distance = Math.max(this.distance, this.x);
  }

  /** Solids overlapping a generous window around the player, for both axes' resolution. */
  private nearbySolids(): ReturnType<World['solidsNear']> {
    return this.world.solidsNear(this.x, SOLID_REACH * 2);
  }

  private updateGrounded(dt: number, input: Readonly<InputSnapshot>, bus: GameBus): void {
    this.coyoteTimer = COYOTE_SECONDS;

    // Wind is deliberately not applied here: it is felt in the air (below), and ground
    // friction would otherwise fight it into an unreadable middle ground every step.
    const target = input.moveAxis * MAX_SPEED;
    const rate = input.moveAxis !== 0 ? MOVE_ACCEL : FRICTION_DECEL;
    this.vx += clamp(target - this.vx, -rate * dt, rate * dt);
    if (input.moveAxis !== 0) this.facing = input.moveAxis > 0 ? 1 : -1;

    const solids = this.nearbySolids();
    const moved = resolveHorizontal(solids, this.x, this.y, BODY_HALF_WIDTH, BODY_HEIGHT, this.vx * dt);
    this.x = moved.x;
    if (moved.blocked) this.vx = 0;

    const terrainHeight = this.terrain.heightAt(this.x);
    const follow = groundFollowAt(solids, this.x, BODY_HALF_WIDTH, this.y, terrainHeight);

    if (this.wantsJump()) {
      this.jump(bus);
      return;
    }

    if (!follow.grounded) {
      this.grounded = false;
      this.vy = 0;
      return;
    }
    this.y = follow.y;
  }

  private updateAirborne(dt: number, input: Readonly<InputSnapshot>, bus: GameBus): void {
    if (this.coyoteTimer > 0) this.coyoteTimer -= dt;

    if (this.wantsJump()) {
      this.jump(bus);
      return;
    }

    const target = input.moveAxis * MAX_SPEED;
    this.vx += clamp(target - this.vx, -AIR_ACCEL * dt, AIR_ACCEL * dt);
    this.vx += this.mods.windAccel * dt;
    this.vx = clamp(this.vx, -MAX_SPEED * 1.5, MAX_SPEED * 1.5);
    if (input.moveAxis !== 0) this.facing = input.moveAxis > 0 ? 1 : -1;

    const floating = input.jumpHeld && this.vy < 0 && input.holdSeconds < MAX_HOLD_SECONDS;
    this.vy += GRAVITY * this.mods.gravityScale * (floating ? HOLD_GRAVITY_SCALE : 1) * dt;

    const solids = this.nearbySolids();
    const fromX = this.x;
    const fromY = this.y;
    const moved = resolveHorizontal(solids, this.x, this.y, BODY_HALF_WIDTH, BODY_HEIGHT, this.vx * dt);
    this.x = moved.x;
    if (moved.blocked) this.vx = 0;

    const nextY = fromY + this.vy * dt;
    // Sweeps the real path, terrain sampled along the way — not just at the final x —
    // which is what stops a fast fall over a slope from tunnelling one step too far.
    const contact = sweepVertical(this.terrain, solids, BODY_HALF_WIDTH, fromX, fromY, this.x, nextY);

    if (contact.bonked) {
      this.y = contact.y;
      this.vy = 0;
      return;
    }
    if (contact.grounded) {
      this.land(contact.y, bus);
      return;
    }
    this.y = contact.y;
  }

  /**
   * Whether a jump should fire this step: a fresh press, or a buffered one — either
   * grace window is enough, and `jumpBufferTimer` already folds in "was pressed
   * recently" regardless of which one is currently open.
   */
  private wantsJump(): boolean {
    if (this.jumpBufferTimer <= 0) return false;
    return this.grounded || this.coyoteTimer > 0;
  }

  private jump(bus: GameBus): void {
    this.vy = JUMP_VELOCITY;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    bus.emit('player:launch', { x: this.x, y: this.y });
  }

  private land(y: number, bus: GameBus): void {
    this.y = y;
    this.vy = 0;
    this.grounded = true;
    bus.emit('player:land', { x: this.x, y: this.y });
  }

  /** A small cosmetic lean toward the direction of travel/acceleration. Never physical. */
  private easeLean(dt: number, input: Readonly<InputSnapshot>): void {
    const target = clamp(input.moveAxis, -1, 1) * LEAN_MAX * (this.grounded ? 1 : 0.6);
    this.rotation += (target - this.rotation) * Math.min(1, LEAN_EASE * dt);
  }
}
