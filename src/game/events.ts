/**
 * The game's event vocabulary.
 *
 * Twists subscribe to these instead of reaching into the player. That is the whole
 * reason the bus exists: with twenty-odd twists, wiring each one into the player
 * directly would turn `Player` into a switchboard, and every new twist would mean
 * editing physics code.
 */

import type { EventBus } from '../core/events';

export interface GameEvents extends Record<string, unknown> {
  /** Jumped. */
  'player:launch': { x: number; y: number };
  /** Touched down on the ground or a ledge. */
  'player:land': { x: number; y: number };
  /**
   * Hazard contact. Never run-ending — see `Player.hurt` — this is the moment a
   * respawn-to-last-safe-ground happens, for camera shake, a sound, a screen flash.
   */
  'player:hurt': { x: number; y: number };
  /**
   * A chime was taken. `pitch` is a scale degree rising along its arc — the hook the
   * generative score consumes so that collecting is literally playing the music.
   */
  'chime:collect': { pitch: number; index: number; total: number };
  /** A Shift is about to land — the telegraph window. `labels` name what's coming. */
  'twist:telegraph': { labels: readonly string[] };
  /** The telegraphed Shift has landed and is now the active set. */
  'twist:shift': { ids: readonly string[]; shiftIndex: number };
  /** Run lifecycle. */
  'run:start': { seed: number };
}

export type GameBus = EventBus<GameEvents>;
