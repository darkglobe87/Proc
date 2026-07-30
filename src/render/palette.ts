/**
 * Colour, kept entirely out of game code.
 *
 * A palette maps semantic roles to concrete colours. Biomes (M9) and twists that
 * recolour the world swap the palette; nothing that draws needs to change, because
 * drawing code only ever names roles.
 */

import type { Role } from './scene';

export interface Palette {
  id: string;
  /** Sky gradient, top to bottom. */
  sky: readonly string[];
  /** Per-role fill or stroke colour. */
  roles: Record<Role, string>;
}

export const DUSK: Palette = {
  id: 'dusk',
  sky: ['#0b1026', '#3b2a5a', '#8c4a5e', '#c2643f'],
  roles: {
    // Three dune bands, each darker and more saturated as they come forward. Reading
    // depth from value alone is what gives the silhouette look its clarity.
    terrainFar: '#3a2c52',
    terrainMid: '#241a38',
    terrainNear: '#120c20',
    player: '#f6e7c8',
    trail: '#ff9c6b',
    hazard: '#2a0f1a',
    chime: '#ffd9a0',
    accent: '#ff9c6b',
    sun: '#ffd9a0',
    haze: '#ffb98a',
    text: '#f6e7c8',
    textDim: '#a294b8',
  },
};

export const PALETTES: readonly Palette[] = [DUSK];

export function paletteById(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? DUSK;
}
