import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { RegionField } from '../src/world/regions';

describe('RegionField', () => {
  it('always opens on The Dunes, with no law', () => {
    const field = new RegionField(new Rng(1));
    const opening = field.regionAt(0);
    expect(opening.index).toBe(0);
    expect(opening.name).toBe('The Dunes');
    expect(opening.law).toEqual([]);
  });

  it('covers every x with exactly one region, with no gaps or overlaps', () => {
    const field = new RegionField(new Rng(7));
    let previous = field.regionAt(-50_000);
    for (let x = -50_000; x < 100_000; x += 137) {
      const region = field.regionAt(x);
      expect(region.from).toBeLessThanOrEqual(x);
      expect(region.to).toBeGreaterThan(x);
      if (region.index !== previous.index) {
        // The boundary is exact: the new region starts exactly where the old one ends.
        expect(region.from).toBeCloseTo(previous.to, 6);
        expect(region.index).toBe(previous.index + 1);
      }
      previous = region;
    }
  });

  it('is deterministic: the same seed produces the same sequence', () => {
    function sequence(): Array<{ name: string; from: number; to: number }> {
      const field = new RegionField(new Rng(42));
      const out: Array<{ name: string; from: number; to: number }> = [];
      let x = 0;
      for (let i = 0; i < 20; i++) {
        const region = field.regionAt(x);
        out.push({ name: region.name, from: region.from, to: region.to });
        x = region.to + 1;
      }
      return out;
    }
    expect(sequence()).toEqual(sequence());
  });

  it('does not depend on how far ahead it has already been asked to resolve', () => {
    // Querying a distant x first must not change what a nearer x resolves to —
    // otherwise render-distance culling order could change the world underfoot.
    const a = new RegionField(new Rng(9));
    const direct = a.regionAt(5_000);

    const b = new RegionField(new Rng(9));
    b.regionAt(500_000); // force it to resolve far ahead first
    const afterFarPeek = b.regionAt(5_000);

    expect(afterFarPeek).toEqual(direct);
  });

  it('differs between seeds', () => {
    const a = new RegionField(new Rng(1));
    const b = new RegionField(new Rng(2));
    // The very first non-Dunes region's name is very likely to differ across seeds
    // (7 candidates, shuffled independently) — collect a handful to make this robust.
    const namesFor = (field: RegionField): string[] => {
      const names: string[] = [];
      let x = field.regionAt(0).to + 1;
      for (let i = 0; i < 5; i++) {
        const region = field.regionAt(x);
        names.push(region.name);
        x = region.to + 1;
      }
      return names;
    };
    expect(namesFor(a)).not.toEqual(namesFor(b));
  });

  it('cycles through every named biome before repeating', () => {
    const field = new RegionField(new Rng(3));
    const seen = new Set<string>();
    let x = field.regionAt(0).to + 1; // skip past the opening Dunes
    for (let i = 0; i < 7; i++) {
      const region = field.regionAt(x);
      expect(seen.has(region.name), `${region.name} repeated before the cycle finished`).toBe(
        false,
      );
      seen.add(region.name);
      x = region.to + 1;
    }
    expect(seen.size).toBe(7);
  });

  it('includes exactly one settlement in the cycle: The Outpost', () => {
    const field = new RegionField(new Rng(5));
    let x = field.regionAt(0).to + 1;
    let settlements = 0;
    for (let i = 0; i < 7; i++) {
      const region = field.regionAt(x);
      if (region.kind === 'settlement') {
        settlements++;
        expect(region.name).toBe('The Outpost');
      }
      x = region.to + 1;
    }
    expect(settlements).toBe(1);
  });

  it('assigns every natural region exactly one twist, and settlements none', () => {
    const field = new RegionField(new Rng(6));
    let x = field.regionAt(0).to + 1;
    for (let i = 0; i < 7; i++) {
      const region = field.regionAt(x);
      if (region.kind === 'settlement') {
        expect(region.law).toEqual([]);
      } else {
        expect(region.law.length).toBe(1);
      }
      x = region.to + 1;
    }
  });
});
