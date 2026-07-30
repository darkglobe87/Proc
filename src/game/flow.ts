/**
 * Flow — the multiplier that rewards chaining.
 *
 * Design constraint from the outset: **breaking flow costs the multiplier, never the
 * run.** A scoring system that also kills you turns experimentation into punishment, and
 * this game is meant to reward trying the risky line.
 *
 * It multiplies chime value rather than distance. Distance is what the player reads at a
 * glance and should stay honest and comparable between runs; chaining is a scoring choice
 * layered on top, not a requirement for making progress.
 */

export const MAX_FLOW = 8;

/** Contribution of each act, in multiplier points. */
const GAIN = {
  cleanLanding: 0.35,
  /** Per completed rotation, so a double is worth more than two singles are separately. */
  flip: 0.6,
  /** Per second of grinding. */
  grindPerSecond: 0.8,
  chime: 0.08,
  nearMiss: 0.5,
} as const;

/** Seconds of doing nothing before the multiplier starts bleeding away. */
const IDLE_GRACE = 2.5;
/** Multiplier points lost per second once decay starts. */
const DECAY_PER_SECOND = 0.9;
/** Fraction of the multiplier kept after a sloppy landing. */
const SLOPPY_KEPT = 0.5;

export class Flow {
  /** Current multiplier, from 1 to {@link MAX_FLOW}. */
  private value = 1;
  private sinceGain = 0;
  private peak = 1;

  get multiplier(): number {
    return this.value;
  }

  /** Highest multiplier reached this run, for the run summary and personal bests. */
  get peakMultiplier(): number {
    return this.peak;
  }

  /** 0..1 of the way through the idle grace period — drives the HUD decay bar. */
  get idleFraction(): number {
    return Math.min(1, this.sinceGain / IDLE_GRACE);
  }

  get isDecaying(): boolean {
    return this.value > 1 && this.sinceGain >= IDLE_GRACE;
  }

  reset(): void {
    this.value = 1;
    this.sinceGain = 0;
    this.peak = 1;
  }

  update(dt: number): void {
    this.sinceGain += dt;
    if (this.sinceGain < IDLE_GRACE) return;
    this.value = Math.max(1, this.value - DECAY_PER_SECOND * dt);
  }

  private add(amount: number): void {
    this.value = Math.min(MAX_FLOW, this.value + amount);
    this.peak = Math.max(this.peak, this.value);
    this.sinceGain = 0;
  }

  cleanLanding(flips: number): void {
    this.add(GAIN.cleanLanding + flips * GAIN.flip);
  }

  /** A sloppy landing halves the multiplier rather than clearing it. */
  sloppyLanding(): void {
    this.value = Math.max(1, this.value * SLOPPY_KEPT);
    this.sinceGain = 0;
  }

  grinding(dt: number): void {
    this.add(GAIN.grindPerSecond * dt);
  }

  chime(): void {
    this.add(GAIN.chime);
  }

  nearMiss(): void {
    this.add(GAIN.nearMiss);
  }

  /** Chime score at the current multiplier. */
  valueOfChime(base = 10): number {
    return Math.round(base * this.value);
  }
}
