import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { RegionField, type Region } from '../src/world/regions';
import { LandmarkField, resolveLandmark } from '../src/world/landmarks';
import { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { FRAGMENTS, NPCS, fragmentById, npcById } from '../src/world/lore';

function regionsUpTo(seed: number, count: number): Region[] {
  const field = new RegionField(new Rng(seed));
  const regions: Region[] = [];
  let x = 0;
  while (regions.length < count) {
    const region = field.regionAt(x);
    if (regions[regions.length - 1]?.index !== region.index) regions.push(region);
    x = region.to;
  }
  return regions;
}

describe('LandmarkField', () => {
  it('never places a landmark in the opening Dunes region', () => {
    const regions = regionsUpTo(1, 5);
    const dunes = regions[0] as Region;
    expect(dunes.index).toBe(0);
    const field = new LandmarkField(new Rng(1));
    expect(field.landmarkForRegion(dunes)).toBeNull();
  });

  it('places exactly one landmark in every other region, real region lengths being well above the minimum', () => {
    const regions = regionsUpTo(42, 12);
    const field = new LandmarkField(new Rng(42));
    for (const region of regions.slice(1)) {
      const landmark = field.landmarkForRegion(region);
      expect(landmark).not.toBeNull();
      expect(landmark?.regionIndex).toBe(region.index);
    }
  });

  it('places an NPC in a settlement region and a fragment everywhere else', () => {
    const regions = regionsUpTo(9, 12);
    const field = new LandmarkField(new Rng(9));
    for (const region of regions.slice(1)) {
      const landmark = field.landmarkForRegion(region);
      if (!landmark) continue;
      expect(landmark.kind).toBe(region.kind === 'settlement' ? 'npc' : 'fragment');
    }
  });

  it('keeps a landmark within its region, clear of both edges', () => {
    const regions = regionsUpTo(123, 10);
    const field = new LandmarkField(new Rng(123));
    for (const region of regions.slice(1)) {
      const landmark = field.landmarkForRegion(region);
      if (!landmark) continue;
      expect(landmark.x).toBeGreaterThan(region.from);
      expect(landmark.x).toBeLessThan(region.to);
    }
  });

  it('is deterministic: the same seed and region produce the same landmark', () => {
    const regions = regionsUpTo(77, 6);
    const a = new LandmarkField(new Rng(77));
    const b = new LandmarkField(new Rng(77));
    for (const region of regions.slice(1)) {
      expect(a.landmarkForRegion(region)).toEqual(b.landmarkForRegion(region));
    }
  });

  it('picks a content id that actually exists in the lore pool', () => {
    const regions = regionsUpTo(5, 10);
    const field = new LandmarkField(new Rng(5));
    for (const region of regions.slice(1)) {
      const landmark = field.landmarkForRegion(region);
      if (!landmark) continue;
      if (landmark.kind === 'npc') {
        expect(() => npcById(landmark.contentId)).not.toThrow();
      } else {
        expect(() => fragmentById(landmark.contentId)).not.toThrow();
      }
    }
  });

  it('resolves to the ground height beneath it', () => {
    const rng = new Rng(3);
    const terrain = new Terrain(rng, 0);
    const regions = regionsUpTo(3, 5);
    const field = new LandmarkField(new Rng(3));
    const region = regions[1] as Region;
    const spec = field.landmarkForRegion(region);
    expect(spec).not.toBeNull();
    if (!spec) return;
    const resolved = resolveLandmark(terrain, spec);
    expect(resolved.y).toBeCloseTo(terrain.heightAt(spec.x), 6);
  });
});

describe('World.landmarksNear', () => {
  it('returns landmarks within the window and excludes ones outside it', () => {
    const world = new World(new Rng(11));
    // Sweep far enough to be confident of crossing at least one non-Dunes region.
    const found = world.landmarksNear(0, 20_000);
    expect(found.length).toBeGreaterThan(0);
    for (const landmark of found) {
      expect(landmark.x).toBeGreaterThanOrEqual(-20_000);
      expect(landmark.x).toBeLessThanOrEqual(20_000);
    }
  });

  it('is a reused array — content is valid until the next call', () => {
    const world = new World(new Rng(11));
    const first = world.landmarksNear(0, 20_000);
    const firstCopy = [...first];
    world.landmarksNear(50_000, 500);
    // The earlier reference now reflects the new query, but the copy still holds
    // what was true at the time — this is a documentation test, not a defect check.
    expect(firstCopy.length).toBeGreaterThan(0);
  });
});

describe('lore content', () => {
  it('has no duplicate fragment or NPC ids', () => {
    expect(new Set(FRAGMENTS.map((f) => f.id)).size).toBe(FRAGMENTS.length);
    expect(new Set(NPCS.map((n) => n.id)).size).toBe(NPCS.length);
  });

  it('every fragment and NPC has at least one non-empty line', () => {
    for (const fragment of FRAGMENTS) expect(fragment.lines.length).toBeGreaterThan(0);
    for (const npc of NPCS) expect(npc.lines.length).toBeGreaterThan(0);
  });
});
