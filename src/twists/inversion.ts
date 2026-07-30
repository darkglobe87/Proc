/**
 * Inversion — the world rolls 180°.
 *
 * A true two-sided gravity flip would need a mirrored ceiling terrain and doubled
 * collision — a real feature, but a much bigger one than this milestone's framework
 * pass. Instead the camera itself rolls: the sky renders at the bottom, the ground
 * at the top, while every physics number underneath is completely unchanged. It is
 * an honest reading of "gravity flips" at the only level that matters to the
 * player — what the screen shows — without inventing a second playable surface.
 */

import type { Twist } from './types';

export function createInversionTwist(): Twist {
  return {
    id: 'inversion',
    label: 'Inversion',
    conflicts: [],
    render: (base) => ({ ...base, rotation: Math.PI }),
  };
}
