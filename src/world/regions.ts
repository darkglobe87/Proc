/**
 * Regions — named biomes laid end-to-end along x.
 *
 * This is what the "That Level Again" twist surprise turns into once the game is
 * about exploring rather than fleeing: each region has its own native physical law,
 * discovered by walking into it rather than sprung on a timer. A region is also the
 * unit that carries a palette and a decor style, so the same piece of infrastructure
 * is what makes biomes look different *and* behave differently.
 *
 * The sequence is infinite and lazily extended — `regionAt` resolves and caches
 * regions forward as far as it has ever been asked, the same pattern `ChunkField`
 * uses for chunks. Regions are cheap (a few fields each) so nothing is ever pruned;
 * even a very long run only ever holds a few hundred of them.
 */

import type { Rng } from '../core/rng';
import type { TwistId } from '../twists/types';

export type RegionKind = 'natural' | 'settlement';

interface RegionTemplate {
  name: string;
  /** 0 or 1 twists — pairing regions is future work, not this pass. */
  law: readonly TwistId[];
  paletteId: string;
  kind: RegionKind;
  minLength: number;
  maxLength: number;
}

export interface Region {
  /** Position in the resolved sequence — 0 is always the opening Dunes. */
  index: number;
  name: string;
  /** World x this region starts at. The first region's is `-Infinity`. */
  from: number;
  to: number;
  law: readonly TwistId[];
  paletteId: string;
  kind: RegionKind;
}

/**
 * Always first and never part of the shuffle: every run opens on calm, familiar
 * ground with no law of its own, the same reason `chunks.ts` leaves its opening
 * chunk flat.
 */
const DUNES: RegionTemplate = {
  name: 'The Dunes',
  law: [],
  paletteId: 'dusk',
  kind: 'natural',
  minLength: 4000,
  maxLength: 6000,
};

/**
 * Shuffled once per seed, then repeated indefinitely — a long run eventually
 * recognises a biome it has already crossed, rather than seeing an unbounded set of
 * random combinations. The Outpost is deliberately the only settlement and the only
 * short one: a calm waypoint between the wilder biomes, not a biome of its own scale.
 */
const CYCLE: readonly RegionTemplate[] = [
  {
    name: 'The Mirror Flats',
    law: ['mirror'],
    paletteId: 'mirrorFlats',
    kind: 'natural',
    minLength: 3500,
    maxLength: 5500,
  },
  {
    name: 'The Inverted Valley',
    law: ['inversion'],
    paletteId: 'invertedValley',
    kind: 'natural',
    minLength: 3500,
    maxLength: 5500,
  },
  {
    name: 'Windswept Ridge',
    law: ['wind'],
    paletteId: 'windsweptRidge',
    kind: 'natural',
    minLength: 3500,
    maxLength: 5500,
  },
  {
    name: 'Echo Canyon',
    law: ['echo'],
    paletteId: 'echoCanyon',
    kind: 'natural',
    minLength: 3500,
    maxLength: 5500,
  },
  {
    name: 'The Metronome',
    law: ['metronome'],
    paletteId: 'metronome',
    kind: 'natural',
    minLength: 3500,
    maxLength: 5500,
  },
  {
    name: 'Moonwalk Reach',
    law: ['moonwalk'],
    paletteId: 'moonwalkReach',
    kind: 'natural',
    minLength: 3500,
    maxLength: 5500,
  },
  {
    name: 'The Outpost',
    law: [],
    paletteId: 'outpost',
    kind: 'settlement',
    minLength: 1500,
    maxLength: 2500,
  },
];

export class RegionField {
  private readonly resolved: Region[] = [];
  private readonly rng: Rng;
  private readonly order: readonly RegionTemplate[];

  constructor(
    rng: Rng,
    /**
     * Overrides every template's length, Dunes included. Exists for the `?fastshift`
     * development flag (see main.ts) so every biome can be reached in seconds rather
     * than walked for real — never set outside a debug path.
     */
    private readonly lengthOverride?: readonly [number, number],
  ) {
    this.rng = rng.fork('regions');
    // A fresh copy — Rng.shuffle mutates in place, and CYCLE is shared module state.
    this.order = this.rng.fork('regions:order').shuffle(CYCLE.slice());
  }

  /** The region containing world x, resolving and caching forward as needed. */
  regionAt(x: number): Region {
    this.extendTo(x);
    for (let i = this.resolved.length - 1; i >= 0; i--) {
      const region = this.resolved[i] as Region;
      if (x >= region.from) return region;
    }
    return this.resolved[0] as Region;
  }

  private extendTo(x: number): void {
    if (this.resolved.length === 0) this.resolveNext();
    while ((this.resolved[this.resolved.length - 1] as Region).to <= x) {
      this.resolveNext();
    }
  }

  private resolveNext(): void {
    const index = this.resolved.length;
    // Forked per index, not consumed sequentially from a shared stream: the length
    // of region 41 must never depend on how many numbers regions 0-40 happened to
    // draw, or evicting and re-resolving a stretch could silently reshape it.
    const lengthRng = this.rng.fork(`region:${index}`);

    if (index === 0) {
      const [minLength, maxLength] = this.lengthOverride ?? [DUNES.minLength, DUNES.maxLength];
      const length = lengthRng.range(minLength, maxLength);
      this.resolved.push({
        index: 0,
        name: DUNES.name,
        from: -Infinity,
        to: length,
        law: DUNES.law,
        paletteId: DUNES.paletteId,
        kind: DUNES.kind,
      });
      return;
    }

    const template = this.order[(index - 1) % this.order.length] as RegionTemplate;
    const previous = this.resolved[index - 1] as Region;
    const [minLength, maxLength] = this.lengthOverride ?? [template.minLength, template.maxLength];
    const length = lengthRng.range(minLength, maxLength);
    this.resolved.push({
      index,
      name: template.name,
      from: previous.to,
      to: previous.to + length,
      law: template.law,
      paletteId: template.paletteId,
      kind: template.kind,
    });
  }
}
