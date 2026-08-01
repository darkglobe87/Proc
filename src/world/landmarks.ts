/**
 * Landmarks — the one authored thing per region.
 *
 * Every region gets exactly one: an NPC in a settlement (someone to meet at the
 * calm waypoint), a fragment everywhere else (something found lying in the wild).
 * One per region keeps discovery reliable — every biome has a story in it — without
 * turning the world into a checklist of pickups.
 *
 * Same spec/resolve split as decor and chunks: a `LandmarkSpec` carries an x and a
 * content id but no y, because only `Terrain` knows the ground height. `regionIndex`
 * doubles as the landmark's stable identity — one landmark per region, so the region
 * that made it is a perfectly good id — used both as the RNG fork key and as the key
 * a caller uses to remember "already read this one."
 */

import type { Rng } from '../core/rng';
import type { Terrain } from './terrain';
import type { Region } from './regions';
import { FRAGMENTS, NPCS } from './lore';

export type LandmarkKind = 'npc' | 'fragment';

export interface LandmarkSpec {
  kind: LandmarkKind;
  x: number;
  contentId: string;
  regionIndex: number;
}

export interface Landmark extends LandmarkSpec {
  /** Ground y at the base — the silhouette rises from here toward smaller y. */
  y: number;
}

/**
 * Margin kept clear at either end of a region, so a landmark never sits astride a
 * boundary — capped, but also scaled to the region's own length, so a `?fastshift`
 * region (as short as 250px) still gets a usable placement window instead of the
 * fixed margin eating the whole thing.
 */
const MAX_EDGE_MARGIN = 220;
const EDGE_MARGIN_FRACTION = 0.2;
/** Below this, a region has no room to place a landmark without crowding its edges. */
const MIN_REGION_LENGTH_FOR_LANDMARK = 200;

export class LandmarkField {
  private readonly cache = new Map<number, LandmarkSpec | null>();

  constructor(private readonly rng: Rng) {}

  /** The landmark belonging to `region`, or null if that region is too short to hold one. */
  landmarkForRegion(region: Region): LandmarkSpec | null {
    const cached = this.cache.get(region.index);
    if (cached !== undefined) return cached;

    const spec = this.generate(region);
    this.cache.set(region.index, spec);
    return spec;
  }

  private generate(region: Region): LandmarkSpec | null {
    // The opening region stays free of a landmark, same reason it opens flat and
    // lawless: a run's first few seconds are for finding your feet, not a prompt.
    if (region.index === 0) return null;

    const length = region.to - region.from;
    if (!Number.isFinite(length) || length < MIN_REGION_LENGTH_FOR_LANDMARK) return null;

    const margin = Math.min(MAX_EDGE_MARGIN, length * EDGE_MARGIN_FRACTION);
    const rng = this.rng.fork(`landmark:${region.index}`);
    const x = rng.range(region.from + margin, region.to - margin);

    if (region.kind === 'settlement') {
      return { kind: 'npc', x, contentId: rng.pick(NPCS).id, regionIndex: region.index };
    }
    return { kind: 'fragment', x, contentId: rng.pick(FRAGMENTS).id, regionIndex: region.index };
  }
}

/** Anchors a spec to the ground beneath it. Always succeeds — nothing here to reject. */
export function resolveLandmark(terrain: Terrain, spec: LandmarkSpec): Landmark {
  return { ...spec, y: terrain.heightAt(spec.x) };
}
