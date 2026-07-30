/**
 * Mirror — the world runs right-to-left, and tricks spin backwards.
 *
 * A literal "run backwards through the world" was considered and rejected: obstacle
 * fairness (no hazard in a ramp's landing zone, minimum spacing) is only proven for
 * left-to-right travel, and re-deriving it symmetrically for the reverse direction
 * is a second fairness system, not a twist. Flipping the *rendering* horizontally
 * instead is free of that risk — collision, scoring and distance are all completely
 * unaffected — while still being disorienting: everything you see runs the opposite
 * way to how it has for the rest of the run.
 *
 * The trick-spin reversal is the one piece of genuine control inversion available in
 * a one-button game with no left/right input: a held flip now rotates the other way.
 */

import type { Twist } from './types';

export function createMirrorTwist(): Twist {
  return {
    id: 'mirror',
    label: 'Mirror',
    conflicts: [],
    physics: (base) => ({ ...base, spinSign: -base.spinSign }),
    render: (base) => ({ ...base, mirrorX: !base.mirrorX }),
  };
}
