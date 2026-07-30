/**
 * The runner.
 *
 * Feel targets, in priority order:
 *  1. Momentum reads as physical — downhill is faster, uphill costs speed.
 *  2. Air is *earned*. Running fast off a crest launches you without a jump input,
 *     which is what makes learning the terrain rewarding rather than incidental.
 *  3. Landings have opinions. A clean one pays, a sloppy one costs, an inverted one
 *     ends the run.
 */

import type { InputSnapshot } from '../core/input';
import type { Terrain } from '../world/terrain';
import { sweepToGround } from '../world/collision';
import type { GameBus, LandingQuality } from '../game/events';

const GRAVITY = 2100;
/**
 * Jump height is tuned against forward speed, not in isolation. The arc has to read as
 * a runner's leap rather than a rocket: roughly 100px of apex over 240px of ground,
 * which needs a far gentler impulse than the height alone would suggest.
 */
const JUMP_VELOCITY = -520;
/** Gravity multiplier while still rising with the button held — variable jump height. */
const HOLD_GRAVITY_SCALE = 0.55;
const MAX_HOLD_SECONDS = 0.22;
const DIVE_IMPULSE = 900;

const BASE_SPEED = 340;
const MAX_SPEED_BONUS = 260;
/** Metres of distance per unit of speed bonus. */
const SPEED_RAMP = 50;
const MIN_SPEED = 120;
const MAX_SPEED = 900;
/** How strongly slope pulls the target speed around. */
const SLOPE_INFLUENCE = 0.5;
/** Speed approaches its target this fast, per second. */
const SPEED_EASE = 3;

/** Air rotation rate once a trick is committed, radians per second (~1.7 rev/s). */
const TRICK_SPIN = 10.5;
/**
 * Hold duration before rotation begins.
 *
 * Jump height and tricks share one button, so without a delay every max-height jump
 * would also spin the player ~120° and land them inverted — the game would punish you
 * for using its own jump. The delay sits just past MAX_HOLD_SECONDS, which cleanly
 * separates "jump as high as I can" from "I am doing a flip".
 */
const SPIN_DELAY = 0.28;
/** Seconds to ramp from no rotation to full speed, so a committed flip starts smoothly. */
const SPIN_RAMP = 0.12;
/** How fast the body aligns to the surface once grounded. */
const GROUND_ALIGN = 12;
/**
 * How fast the body self-levels in the air, radians per second.
 *
 * Only applies while no trick has been committed. Launching off a steep ramp face
 * freezes the body at that angle, and landing on flatter ground beyond it would crash a
 * player who never touched the controls — the terrain must not be the thing that kills
 * you. Committing to a flip disables this: once you choose to rotate, you own the
 * landing, which is what keeps tricks a real risk.
 */
const AIR_LEVEL = 5;

/**
 * Landing tolerances, in radians of misalignment between body and surface.
 *
 * `clean` is the primary feel dial for the whole game — widen it and the runner forgives
 * everything, narrow it and tricks stop being worth attempting.
 */
export const LANDING_TOLERANCE = {
  clean: (35 * Math.PI) / 180,
  sloppy: (75 * Math.PI) / 180,
} as const;

/**
 * Safety margin on the launch test.
 *
 * Launching the instant curvature merely ties with gravity puts the player on a
 * knife-edge: departure is tangential, separation over one step is sub-pixel, and
 * floating-point noise decides whether the sweep re-contacts. Requiring a clear margin
 * means a launch always actually separates.
 */
const LAUNCH_MARGIN = 1.15;
/**
 * How far above the surface a launch places the player.
 *
 * Without this the flight begins exactly on the ground and the very first sweep can
 * register contact at t≈0, which snaps x back to the launch point — the player sticks in
 * place, oscillating between grounded and airborne, and stops moving entirely.
 */
const LAUNCH_CLEARANCE = 1.5;
/**
 * Minimum airtime before a landing pays a boost.
 *
 * Also a stability requirement, not just balance: without it, any rapid contact cycle
 * counts as a clean landing and pumps the boost every other frame until speed pins at
 * maximum.
 */
const MIN_BOOST_AIRTIME = 0.12;

const CLEAN_BOOST = 95;
const SLOPPY_SPEED_KEPT = 0.82;
/** Boost bleeds off at this fraction per second. */
const BOOST_DECAY = 1.3;

export const PLAYER_RADIUS = 9;

/** Wraps an angle to (-π, π]. */
function normaliseAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The landing rule, as a pure function of two angles.
 *
 * Kept separate from the physics so the rule can be tested exactly. Exercising it
 * through a real fall instead would measure the self-levelling drift during flight
 * rather than the classification itself.
 */
export function classifyLanding(bodyAngle: number, surfaceAngle: number): LandingQuality {
  const misalignment = Math.abs(normaliseAngle(bodyAngle - surfaceAngle));
  if (misalignment <= LANDING_TOLERANCE.clean) return 'clean';
  if (misalignment <= LANDING_TOLERANCE.sloppy) return 'sloppy';
  return 'crash';
}

export class Player {
  x = 0;
  y = 0;
  /** Horizontal speed, px/s. Never negative in normal play. */
  vx = BASE_SPEED;
  /** Vertical speed, px/s; positive is downward. */
  vy = 0;
  grounded = true;
  /** Body angle in radians; matches the surface when grounded. */
  rotation = 0;
  dead = false;

  /** Previous-step position, for render interpolation. */
  previousX = 0;
  previousY = 0;

  airtime = 0;
  /** Rotation accumulated since leaving the ground. */
  private spin = 0;
  private flipsThisFlight = 0;
  private boost = 0;

  /** Distance travelled, in world pixels. */
  distance = 0;

  constructor(private readonly terrain: Terrain) {
    this.y = terrain.heightAt(0);
    this.previousY = this.y;
    this.rotation = terrain.angleAt(0);
  }

  /** 0..1 fraction of top speed, for camera look-ahead and effects. */
  get speedRatio(): number {
    return clamp((this.vx - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);
  }

  /** True while spinning a trick. */
  get isFlipping(): boolean {
    return !this.grounded && Math.abs(this.spin) > 0.15;
  }

  reset(): void {
    this.x = 0;
    this.y = this.terrain.heightAt(0);
    this.previousX = 0;
    this.previousY = this.y;
    this.vx = BASE_SPEED;
    this.vy = 0;
    this.grounded = true;
    this.rotation = this.terrain.angleAt(0);
    this.dead = false;
    this.airtime = 0;
    this.spin = 0;
    this.flipsThisFlight = 0;
    this.boost = 0;
    this.distance = 0;
  }

  update(dt: number, input: Readonly<InputSnapshot>, bus: GameBus): void {
    this.previousX = this.x;
    this.previousY = this.y;
    if (this.dead) return;

    if (this.grounded) {
      this.updateGrounded(dt, input, bus);
    } else {
      this.updateAirborne(dt, input, bus);
    }

    this.distance = Math.max(this.distance, this.x);
  }

  private updateGrounded(dt: number, input: Readonly<InputSnapshot>, bus: GameBus): void {
    const slope = this.terrain.slopeAt(this.x);

    // Target speed: a distance-based cruise, pushed around by the slope. Easing toward
    // a target rather than integrating acceleration keeps speed bounded no matter what
    // terrain (or twist) does — no runaway, no need for a special case.
    const cruise = BASE_SPEED + Math.min(this.distance / SPEED_RAMP, MAX_SPEED_BONUS);
    const target = cruise * (1 + clamp(slope, -1.2, 1.2) * SLOPE_INFLUENCE) + this.boost;
    this.vx += (target - this.vx) * Math.min(1, SPEED_EASE * dt);
    this.vx = clamp(this.vx, MIN_SPEED, MAX_SPEED);
    this.boost -= this.boost * Math.min(1, BOOST_DECAY * dt);

    // Settle onto the surface.
    const surface = Math.atan(slope);
    this.rotation += normaliseAngle(surface - this.rotation) * Math.min(1, GROUND_ALIGN * dt);

    if (input.jumpPressed) {
      this.vy = JUMP_VELOCITY;
      this.leaveGround(true, bus);
      this.updateAirborne(dt, input, bus);
      return;
    }

    if (this.shouldLaunch()) {
      // Depart along the surface tangent, so a launch preserves the direction the
      // player was already travelling.
      this.vy = this.vx * slope;
      this.leaveGround(false, bus);
      this.updateAirborne(dt, input, bus);
      return;
    }

    this.x += this.vx * dt;
    this.y = this.terrain.heightAt(this.x);
  }

  /**
   * Whether the surface is curving away faster than gravity can hold the player to it.
   *
   * Contact needs centripetal acceleration v²κ ≤ g·cosθ. With v = vx·√(1+y'²),
   * κ = y''/(1+y'²)^{3/2} and cosθ = 1/√(1+y'²), the (1+y'²) terms cancel and the
   * whole test reduces to vx²·y'' > g. Which also explains the feel: launch speed off
   * a given crest scales with √(1/curvature), so gentle crests need real speed and
   * sharp ramp lips always throw you.
   */
  private shouldLaunch(): boolean {
    const curvature = this.terrain.curvatureAt(this.x);
    if (curvature <= 0) return false; // concave: ground is holding us in
    return this.vx * this.vx * curvature > GRAVITY * LAUNCH_MARGIN;
  }

  private leaveGround(jumped: boolean, bus: GameBus): void {
    this.grounded = false;
    this.airtime = 0;
    this.spin = 0;
    this.flipsThisFlight = 0;
    // Clear the surface so the first sweep of the flight cannot immediately re-contact.
    this.y -= LAUNCH_CLEARANCE;
    bus.emit('player:launch', { x: this.x, y: this.y, jumped });
  }

  private updateAirborne(dt: number, input: Readonly<InputSnapshot>, bus: GameBus): void {
    this.airtime += dt;

    if (input.divePressed) this.vy += DIVE_IMPULSE;

    const floating =
      input.jumpHeld && this.vy < 0 && input.holdSeconds < MAX_HOLD_SECONDS;
    this.vy += GRAVITY * (floating ? HOLD_GRAVITY_SCALE : 1) * dt;

    // Rotation advances only after the hold outlasts SPIN_DELAY, so a high jump does
    // not become an accidental flip. Releasing freezes the body, which is how a landing
    // gets aimed.
    if (input.jumpHeld && input.holdSeconds > SPIN_DELAY) {
      const ramp = Math.min(1, (input.holdSeconds - SPIN_DELAY) / SPIN_RAMP);
      const delta = TRICK_SPIN * ramp * dt;
      this.spin += delta;
      this.rotation += delta;

      const flips = Math.floor(this.spin / (Math.PI * 2));
      if (flips > this.flipsThisFlight) {
        this.flipsThisFlight = flips;
        bus.emit('player:trick', { flips });
      }
    } else if (this.spin === 0) {
      // No trick committed: drift toward the ground angle below, so an unmanaged flight
      // arrives roughly aligned. Once `spin` is non-zero this stops for the rest of the
      // flight, leaving the landing entirely in the player's hands.
      const target = this.terrain.angleAt(this.x);
      this.rotation += normaliseAngle(target - this.rotation) * Math.min(1, AIR_LEVEL * dt);
    }

    const nextX = this.x + this.vx * dt;
    const nextY = this.y + this.vy * dt;

    const contact = sweepToGround(this.terrain, this.x, this.y, nextX, nextY);
    if (!contact) {
      this.x = nextX;
      this.y = nextY;
      return;
    }

    this.x = contact.x;
    this.y = contact.y;
    this.land(contact.slope, bus);
  }

  private land(slope: number, bus: GameBus): void {
    const surface = Math.atan(slope);
    const quality = classifyLanding(this.rotation, surface);

    const flips = this.flipsThisFlight;
    const airtime = this.airtime;

    this.grounded = true;
    this.vy = 0;
    this.spin = 0;
    this.rotation = surface;

    if (quality === 'crash') {
      this.dead = true;
      bus.emit('player:crash', { x: this.x, y: this.y, reason: 'landing' });
      bus.emit('player:land', { x: this.x, y: this.y, quality, flips, airtime });
      return;
    }

    if (quality === 'clean') {
      // Reward scales with the trick, so a flip is worth the risk of a bad angle. Gated
      // on real airtime, so brushing the ground cannot pay out.
      if (airtime >= MIN_BOOST_AIRTIME) {
        this.boost += CLEAN_BOOST * (1 + flips * 0.5);
      }
    } else {
      this.vx *= SLOPPY_SPEED_KEPT;
    }

    this.flipsThisFlight = 0;
    bus.emit('player:land', { x: this.x, y: this.y, quality, flips, airtime });
  }
}
