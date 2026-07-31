/**
 * Colour, kept entirely out of game code.
 *
 * A palette maps semantic roles to concrete colours. Regions (`world/regions.ts`)
 * each name a palette; nothing that draws needs to change, because drawing code
 * only ever names roles.
 *
 * `player`, `text` and `textDim` are deliberately near-identical across every
 * palette below: the character's own colour is its identity and must stay
 * legible no matter which biome it's standing in, and the HUD sits over every
 * sky the game has, so it needs one safe, always-readable pair rather than
 * fighting eight different horizons.
 */

import type { Role } from './scene';

export interface Palette {
  id: string;
  /** Sky gradient, top to bottom. */
  sky: readonly string[];
  /** Per-role fill or stroke colour. */
  roles: Record<Role, string>;
}

const PLAYER = '#f6e7c8';
const TEXT = '#f6e7c8';
const TEXT_DIM = '#a294b8';

export const DUSK: Palette = {
  id: 'dusk',
  sky: ['#0b1026', '#3b2a5a', '#8c4a5e', '#c2643f'],
  roles: {
    // Three dune bands, each darker and more saturated as they come forward. Reading
    // depth from value alone is what gives the silhouette look its clarity.
    terrainFar: '#3a2c52',
    terrainMid: '#241a38',
    terrainNear: '#120c20',
    player: PLAYER,
    trail: '#ff9c6b',
    // Muted stone, not warning-red — decor now, not danger.
    rock: '#241c30',
    chime: '#ffd9a0',
    accent: '#ff9c6b',
    sun: '#ffd9a0',
    haze: '#ffb98a',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Icy, reflective — the world runs the wrong way here, and looks like it too. */
const MIRROR_FLATS: Palette = {
  id: 'mirrorFlats',
  sky: ['#050b1a', '#132a44', '#2f6e82', '#8fd6e0'],
  roles: {
    terrainFar: '#264a5c',
    terrainMid: '#173340',
    terrainNear: '#0b1e28',
    player: PLAYER,
    trail: '#8fe8f0',
    rock: '#1c3a48',
    chime: '#c9f3f5',
    accent: '#6fe3f0',
    sun: '#dff7fa',
    haze: '#a8e8ee',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Deep, upside-down eerie — a valley the sky fell into. */
const INVERTED_VALLEY: Palette = {
  id: 'invertedValley',
  sky: ['#0a0510', '#2c0f2e', '#6e1f4a', '#c23a6b'],
  roles: {
    terrainFar: '#3a1a3e',
    terrainMid: '#250f2c',
    terrainNear: '#140816',
    player: PLAYER,
    trail: '#ff6ea0',
    rock: '#2e1230',
    chime: '#ffb0d0',
    accent: '#ff4f8f',
    sun: '#ffb0d0',
    haze: '#d97aa8',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Pale, hazy, storm-blown sand. */
const WINDSWEPT_RIDGE: Palette = {
  id: 'windsweptRidge',
  sky: ['#1a1610', '#4a4030', '#9c8a5c', '#d8c68e'],
  roles: {
    terrainFar: '#6b5d3e',
    terrainMid: '#463c28',
    terrainNear: '#241f16',
    player: PLAYER,
    trail: '#f0dca0',
    rock: '#4a3f2a',
    chime: '#fff0c0',
    accent: '#e8c96a',
    sun: '#fff0c0',
    haze: '#e0cd94',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Deep rust and burnt orange — canyon walls that throw a sound back at you. */
const ECHO_CANYON: Palette = {
  id: 'echoCanyon',
  sky: ['#0e0604', '#3a140a', '#7a2e12', '#c85a28'],
  roles: {
    terrainFar: '#5c2414',
    terrainMid: '#3a160c',
    terrainNear: '#1c0a06',
    player: PLAYER,
    trail: '#ff9855',
    rock: '#421c10',
    chime: '#ffcf9a',
    accent: '#ff7a3d',
    sun: '#ffcf9a',
    haze: '#e8975c',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Teal and pulsing magenta — a place that keeps its own beat. */
const METRONOME: Palette = {
  id: 'metronome',
  sky: ['#080a1a', '#1c1f4a', '#2e5c6e', '#4ecfc0'],
  roles: {
    terrainFar: '#1f3d4e',
    terrainMid: '#142a36',
    terrainNear: '#0a161c',
    player: PLAYER,
    trail: '#ff5fc0',
    rock: '#183440',
    chime: '#8ff5e8',
    accent: '#ff5fc0',
    sun: '#8ff5e8',
    haze: '#5fc9c0',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Pale grey-blue, low-gravity, a little washed out — a lunar reach. */
const MOONWALK_REACH: Palette = {
  id: 'moonwalkReach',
  sky: ['#05060c', '#181c2c', '#3a4358', '#8b93a8'],
  roles: {
    terrainFar: '#3c4256',
    terrainMid: '#262b3a',
    terrainNear: '#14161f',
    player: PLAYER,
    trail: '#cfd6e8',
    rock: '#2a2e3c',
    chime: '#e8ecf5',
    accent: '#aeb8d0',
    sun: '#e8ecf5',
    haze: '#9aa4bc',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

/** Warm and lantern-lit — a settlement, not a wilderness. */
const OUTPOST: Palette = {
  id: 'outpost',
  sky: ['#140d08', '#3a2416', '#7a4a24', '#d69048'],
  roles: {
    terrainFar: '#5c3c22',
    terrainMid: '#3c2814',
    terrainNear: '#1e140a',
    player: PLAYER,
    trail: '#ffbf70',
    // Buildings, not rocks, but the same role — warm timber rather than cold stone.
    rock: '#4a2f1a',
    chime: '#ffdca0',
    accent: '#ffaa4d',
    sun: '#ffdca0',
    haze: '#e0a868',
    text: TEXT,
    textDim: TEXT_DIM,
  },
};

export const PALETTES: readonly Palette[] = [
  DUSK,
  MIRROR_FLATS,
  INVERTED_VALLEY,
  WINDSWEPT_RIDGE,
  ECHO_CANYON,
  METRONOME,
  MOONWALK_REACH,
  OUTPOST,
];

export function paletteById(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? DUSK;
}

function parseHex(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex([r, g, b]: readonly [number, number, number]): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`;
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/**
 * Interpolates every colour between two palettes, for a crossfade rather than a hard
 * pop the instant a region boundary is crossed. Generic over `Role` (iterating its own
 * keys rather than listing them) so a new role never needs a matching update here.
 */
export function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  if (t <= 0) return a;
  if (t >= 1) return b;

  const sky = a.sky.map((stop, i) => lerpHex(stop, (b.sky[i] as string) ?? stop, t));

  const roles = { ...a.roles };
  for (const key of Object.keys(a.roles) as Role[]) {
    roles[key] = lerpHex(a.roles[key], b.roles[key], t);
  }

  return { id: `${a.id}->${b.id}`, sky, roles };
}
