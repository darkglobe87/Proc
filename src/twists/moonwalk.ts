/**
 * Moonwalk — low gravity, floaty arcs.
 *
 * Only gravity is scaled, not jump velocity. A softer pull turns the same jump
 * impulse into a longer, higher arc on its own — scaling the impulse too would
 * fight that and net out close to normal, defeating the point. The curvature-based
 * natural-launch test also reads the scaled gravity, so crests launch the player
 * more readily under Moonwalk too: everything about flight gets floatier together,
 * not just deliberate jumps.
 */

import type { Twist } from './types';

const GRAVITY_SCALE = 0.45;

export function createMoonwalkTwist(): Twist {
  return {
    id: 'moonwalk',
    label: 'Moonwalk',
    conflicts: [],
    physics: (base) => ({ ...base, gravityScale: base.gravityScale * GRAVITY_SCALE }),
  };
}
