/**
 * The ground.
 *
 * Height is a pure function of world x and the run seed:
 *
 *     heightAt(x) = baseNoise(x) + Σ deformations of nearby chunk features
 *
 * Nothing is stored for the base curve, which makes it automatically deterministic
 * and free of any chunk lifecycle. Features (ramps, crests, pits) need discrete
 * per-region decisions, so those live in `chunks.ts` and are applied here as
 * compactly-supported deformations. Because every feature has finite width, only a
 * couple of chunks are ever consulted for a given x.
 *
 * Screen space grows downward, so *smaller y is higher ground*. `slopeAt` returns
 * dy/dx in that same space: negative means the ground is rising to the right.
 */

import type { Rng } from '../core/rng';
import { ChunkField, type Feature } from './chunks';

/** One layer of the base dune curve. */
interface Octave {
  amplitude: number;
  wavelength: number;
  /** Per-octave offset table, sampled with smoothstep interpolation. */
  table: Float32Array;
}

/** Power-of-two table length keeps the index wrap a bitmask. */
const TABLE_SIZE = 256;
const TABLE_MASK = TABLE_SIZE - 1;

/**
 * Octave shape. Long low-frequency dunes carry the silhouette; the short ones only
 * add texture, and their amplitude is kept small enough that they never create a
 * slope the player cannot run up.
 */
const OCTAVE_SHAPE: ReadonlyArray<{ amplitude: number; wavelength: number }> = [
  { amplitude: 110, wavelength: 1600 },
  { amplitude: 52, wavelength: 720 },
  { amplitude: 21, wavelength: 300 },
  { amplitude: 8, wavelength: 130 },
];

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class Terrain {
  private readonly octaves: Octave[];
  private readonly chunks: ChunkField;

  /**
   * @param baseline Screen-space y the dunes oscillate about. Set from the viewport
   *   so the horizon sits at a consistent fraction of the panel on any device.
   */
  constructor(
    rng: Rng,
    public baseline: number,
  ) {
    const shapeRng = rng.fork('terrain');
    this.octaves = OCTAVE_SHAPE.map(({ amplitude, wavelength }) => {
      const table = new Float32Array(TABLE_SIZE);
      for (let i = 0; i < TABLE_SIZE; i++) table[i] = shapeRng.range(-1, 1);
      return { amplitude, wavelength, table };
    });
    this.chunks = new ChunkField(rng);
  }

  /** Ground y at world x. Smaller is higher. */
  heightAt(x: number): number {
    let y = this.baseline;

    for (const octave of this.octaves) {
      const position = x / octave.wavelength;
      const cell = Math.floor(position);
      const t = smoothstep(position - cell);
      const a = octave.table[cell & TABLE_MASK] as number;
      const b = octave.table[(cell + 1) & TABLE_MASK] as number;
      y += (a + (b - a) * t) * octave.amplitude;
    }

    for (const feature of this.chunks.featuresNear(x)) {
      y += deform(feature, x);
    }

    return y;
  }

  /**
   * dy/dx at world x, by central difference.
   *
   * Analytic derivatives would be faster but would have to be kept in sync with
   * every feature shape by hand — a difference of a couple of microseconds against
   * a whole class of silent bugs where slope and height disagree.
   */
  slopeAt(x: number, epsilon = 1.5): number {
    return (this.heightAt(x + epsilon) - this.heightAt(x - epsilon)) / (2 * epsilon);
  }

  /** Surface angle in radians, for orienting the player and judging landings. */
  angleAt(x: number): number {
    return Math.atan(this.slopeAt(x));
  }

  /**
   * d²y/dx² at world x.
   *
   * This is what decides when the runner leaves the ground without jumping. A body
   * following a curve needs centripetal acceleration v²·κ; once that exceeds what
   * gravity can supply, contact is lost. Working the algebra through in screen space
   * collapses to a pleasantly simple test — see `Player.shouldLaunch`.
   */
  curvatureAt(x: number, epsilon = 3): number {
    const left = this.heightAt(x - epsilon);
    const centre = this.heightAt(x);
    const right = this.heightAt(x + epsilon);
    return (right - 2 * centre + left) / (epsilon * epsilon);
  }

  /** Features overlapping a range, for spawning and for drawing feature-specific art. */
  featuresIn(fromX: number, toX: number): Feature[] {
    return this.chunks.featuresIn(fromX, toX);
  }

  /** Discards chunk state far behind the player. Regeneration is identical. */
  prune(aroundX: number): void {
    this.chunks.prune(aroundX);
  }
}

/**
 * A feature's contribution to height at x. Each shape is zero outside
 * `[x - halfWidth, x + halfWidth]` so features never influence distant terrain and
 * chunks stay independent.
 */
function deform(feature: Feature, x: number): number {
  const half = feature.width / 2;
  const dx = x - feature.x;
  if (dx <= -half || dx >= half) return 0;

  // Normalised position across the feature, -1 … 1.
  const u = dx / half;

  switch (feature.kind) {
    case 'crest': {
      // Raised cosine: a smooth hill to launch from.
      return -feature.amplitude * 0.5 * (1 + Math.cos(Math.PI * u));
    }
    case 'pit': {
      // Same shape inverted — a dip that becomes a gap at speed.
      return feature.amplitude * 0.5 * (1 + Math.cos(Math.PI * u));
    }
    case 'ramp': {
      // Rises over the first 70% then drops away over the last 30%. The asymmetry is
      // the point: the player runs up the gentle face and the ground falls out from
      // under them at the top, which launches them without needing a jump input.
      const t = (u + 1) / 2;
      const rise = smoothstep(Math.min(1, t / 0.7));
      const fall = t > 0.7 ? smoothstep((t - 0.7) / 0.3) : 0;
      return -feature.amplitude * (rise - fall);
    }
    case 'plateau': {
      // Flat top with eased shoulders: somewhere to land a trick cleanly.
      const shoulder = 0.35;
      const magnitude =
        Math.abs(u) < 1 - shoulder ? 1 : smoothstep((1 - Math.abs(u)) / shoulder);
      return -feature.amplitude * magnitude;
    }
    default:
      return 0;
  }
}
