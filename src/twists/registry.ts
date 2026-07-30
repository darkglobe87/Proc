/**
 * The twist pool.
 *
 * A `Rng` is threaded in only because Wind needs one — the other five twists are
 * fully deterministic constants and need no randomness of their own. Wind's stream
 * is forked once here, at construction, and persists across every activation of
 * Wind within the run, so "same seed" still means "same sequence of wind directions"
 * even though the scheduler's own picks are what decide *when* Wind gets consumed.
 */

import type { Rng } from '../core/rng';
import type { Twist } from './types';
import { createInversionTwist } from './inversion';
import { createMirrorTwist } from './mirror';
import { createMoonwalkTwist } from './moonwalk';
import { createWindTwist } from './wind';
import { createMetronomeTwist } from './metronome';
import { createEchoTwist } from './echo';

export function createTwistRegistry(seed: Rng): Twist[] {
  return [
    createInversionTwist(),
    createMirrorTwist(),
    createMoonwalkTwist(),
    createWindTwist(seed.fork('twist:wind')),
    createMetronomeTwist(),
    createEchoTwist(),
  ];
}
