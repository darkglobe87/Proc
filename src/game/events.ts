/**
 * The game's event vocabulary.
 *
 * Twists subscribe to these instead of reaching into the player. That is the whole
 * reason the bus exists: with twenty-odd twists, wiring each one into the player
 * directly would turn `Player` into a switchboard, and every new twist would mean
 * editing physics code.
 */

import type { EventBus } from '../core/events';

export type LandingQuality = 'clean' | 'sloppy' | 'crash';

export interface GameEvents extends Record<string, unknown> {
  /** Left the ground, whether by jumping or by running off a crest. */
  'player:launch': { x: number; y: number; jumped: boolean };
  /** Touched down. `flips` counts completed rotations in that flight. */
  'player:land': { x: number; y: number; quality: LandingQuality; flips: number; airtime: number };
  /** A full rotation completed while airborne. */
  'player:trick': { flips: number };
  /** Started or finished grinding a rail. */
  'player:grind': { rail: number; started: boolean };
  /** Run-ending impact. */
  'player:crash': { x: number; y: number; reason: 'landing' | 'obstacle' | 'rail' };
  /**
   * A chime was taken. `pitch` is a scale degree rising along its arc — the hook the
   * generative score consumes so that collecting is literally playing the music.
   */
  'chime:collect': { pitch: number; index: number; total: number; value: number };
  /** Passed close to a hazard without touching it. */
  'player:nearMiss': { obstacle: number; distance: number };
  /** Run lifecycle. */
  'run:start': { seed: number };
  'run:end': { distance: number; best: boolean };
}

export type GameBus = EventBus<GameEvents>;
