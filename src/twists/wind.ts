/**
 * Wind — a constant push, one way or the other.
 *
 * Applied uniformly in every movement state at the top of `Player.update`, before
 * branching into grounded/airborne/grinding — see the comment there for why that
 * single application point produces a headwind that bites hardest in the air and
 * is partly fought by the ground's own speed-easing, without needing two separate
 * code paths to achieve it.
 *
 * Direction and strength are redrawn from the twist's own dedicated RNG stream each
 * time Wind is chosen, so two activations in the same run feel different but the
 * whole sequence is still fully determined by the run seed.
 */

import type { Rng } from '../core/rng';
import type { Twist, TwistRuntimeContext } from './types';

const MIN_ACCEL = 70;
const MAX_ACCEL = 160;

export function createWindTwist(rng: Rng): Twist {
  let accel = 0;

  return {
    id: 'wind',
    label: 'Wind',
    conflicts: [],

    onActivate(_ctx: TwistRuntimeContext): void {
      accel = rng.sign() * rng.range(MIN_ACCEL, MAX_ACCEL);
    },

    physics: (base) => ({ ...base, windAccel: base.windAccel + accel }),
  };
}
