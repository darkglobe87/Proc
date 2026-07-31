/**
 * Mirror — the world runs right-to-left, and your own controls follow it.
 *
 * A literal "run backwards through the world" was considered and rejected: chunk
 * generation, ledges and every future landmark are authored assuming x only ever
 * grows, and reversing that for one twist is a second world model, not a twist.
 * Flipping the *rendering* horizontally instead is free of that risk — placement is
 * completely unaffected — while still being disorienting: everything you see runs the
 * opposite way to how it has for the rest of the exploration.
 *
 * Now that movement is the player's own choice rather than an auto-cruise, Mirror has
 * a much better version of the joke available than the old trick-spin reversal: it
 * flips `moveAxis` itself, so the pad you have been steering with all game now steers
 * backwards. Nothing about jumping or collision cares which way `moveAxis` points, so
 * this is a pure input transform with no physics-side special case.
 */

import type { Twist } from './types';

export function createMirrorTwist(): Twist {
  return {
    id: 'mirror',
    label: 'Mirror',
    conflicts: [],
    transformInput: (input) => ({ ...input, moveAxis: -input.moveAxis }),
    render: (base) => ({ ...base, mirrorX: !base.mirrorX }),
  };
}
