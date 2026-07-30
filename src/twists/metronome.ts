/**
 * Metronome — jumps only fire on the beat.
 *
 * A press that lands inside the open window around a beat passes straight through:
 * full variable-height jumping, exactly as normal. Reward for good rhythm, not a
 * penalty for anything else.
 *
 * A press that lands off-beat is not dropped — that would make holding the button
 * down feel broken, since the input edge that would have triggered a jump is gone
 * the instant it passes. Instead it is buffered and fires at the next open window,
 * a standard "input buffer" trick. Buffered jumps are deliberately fixed-height
 * rather than variable: `Input`'s hold clock starts at the real physical touch-down,
 * so by the time a buffered press finally fires its `holdSeconds` may already be
 * stale relative to the jump that is only now happening. Rather than chase that,
 * a buffered jump is simply a clean, quantized hop — "you get on the beat, not
 * necessarily the height" is an easy rule to explain and to feel.
 *
 * 120 BPM is a deliberately ordinary tempo, and one Milestone 6's tempo-locked score
 * can anchor to later rather than picking a fresh number independently.
 */

import type { Twist } from './types';

const BEAT_SECONDS = 0.5;
/** Half-width of the window either side of a beat that counts as "on it". */
const WINDOW_SECONDS = 0.09;
/** A buffered press this stale is assumed forgotten rather than fired late. */
const BUFFER_TIMEOUT_SECONDS = BEAT_SECONDS;

export function createMetronomeTwist(): Twist {
  let elapsed = 0;
  let queued = false;
  let queuedFor = 0;
  let lastFiredBeat = -1;

  return {
    id: 'metronome',
    label: 'Metronome',
    conflicts: [],

    onActivate(): void {
      elapsed = 0;
      queued = false;
      queuedFor = 0;
      lastFiredBeat = -1;
    },

    transformInput(input, dt) {
      elapsed += dt;
      const phase = elapsed % BEAT_SECONDS;
      const distanceToBeat = Math.min(phase, BEAT_SECONDS - phase);
      const withinWindow = distanceToBeat <= WINDOW_SECONDS;
      const beatIndex = Math.round(elapsed / BEAT_SECONDS);
      const freshWindow = withinWindow && beatIndex !== lastFiredBeat;

      if (input.jumpPressed) {
        if (freshWindow) {
          lastFiredBeat = beatIndex;
          queued = false;
          return input; // on the beat: unchanged, real variable-height jump
        }
        queued = true;
        queuedFor = 0;
        return { ...input, jumpPressed: false };
      }

      if (queued) {
        queuedFor += dt;
        if (queuedFor > BUFFER_TIMEOUT_SECONDS) {
          queued = false;
        } else if (freshWindow) {
          queued = false;
          lastFiredBeat = beatIndex;
          return { ...input, jumpPressed: true, jumpHeld: true, holdSeconds: 0 };
        }
      }

      return input;
    },
  };
}
