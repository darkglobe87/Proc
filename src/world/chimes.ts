/**
 * Chimes — the collectible.
 *
 * Not coins scattered on the ground: arcs of motes meant to trace a trajectory the
 * player is about to fly. That trajectory used to be predictable because the runner
 * auto-launched off crests at a deterministic cruise speed (see the old `JUMP_MODEL` /
 * `cruiseSpeedAt`); the platformer pivot removed both, since movement is now the
 * player's own choice rather than a function of distance travelled. Placing arcs that
 * still teach a real, flyable line needs a model of *player-controlled* jumps and is
 * picked back up alongside regions and landmarks — see the pivot plan.
 *
 * The type and radius stay here, and stay real: `World`, the HUD and Echo all refer to
 * a `Chime` and `CHIME_RADIUS` regardless of whether anything is currently placing one.
 */

export interface Chime {
  /** Stable across chunk eviction, so a regenerated chunk cannot resurrect a pickup. */
  id: number;
  x: number;
  y: number;
  /** Scale degree, ascending along the arc. Mapped to a pitch by the audio engine. */
  pitch: number;
  /** Position within its arc, and the arc's length, for scoring a full collect. */
  index: number;
  total: number;
}

/**
 * Collection radius. Generous on purpose: chimes reward taking the line, they do not
 * test precision.
 */
export const CHIME_RADIUS = 24;
