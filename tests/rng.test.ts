import { describe, expect, it } from 'vitest';
import {
  Rng,
  dailySeed,
  decodeSeed,
  encodeSeed,
  hashString,
} from '../src/core/rng';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const drawsA = Array.from({ length: 64 }, () => a.next());
    const drawsB = Array.from({ length: 64 }, () => b.next());
    expect(drawsA).toEqual(drawsB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 32 }, (_, i) => new Rng(1).next() + i * 0);
    const b = Array.from({ length: 32 }, (_, i) => new Rng(2).next() + i * 0);
    expect(a[0]).not.toEqual(b[0]);
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() respects its bounds', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 5_000; i++) {
      const value = rng.int(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(9);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('int() collapses an empty range to its minimum', () => {
    expect(new Rng(1).int(5, 5)).toBe(5);
    expect(new Rng(1).int(5, 2)).toBe(5);
  });

  it('distributes next() roughly uniformly', () => {
    const rng = new Rng(4242);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100_000;
    for (let i = 0; i < samples; i++) {
      const index = Math.floor(rng.next() * 10);
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
    // Each bucket should hold ~10%; allow a generous 2% band.
    for (const count of buckets) {
      expect(count / samples).toBeGreaterThan(0.08);
      expect(count / samples).toBeLessThan(0.12);
    }
  });

  describe('fork', () => {
    it('is stable for the same seed and name', () => {
      const first = new Rng(555).fork('terrain');
      const second = new Rng(555).fork('terrain');
      expect(first.seed).toBe(second.seed);
      expect(first.next()).toBe(second.next());
    });

    it('gives unrelated streams for different names', () => {
      const parent = new Rng(555);
      expect(parent.fork('terrain').seed).not.toBe(parent.fork('twists').seed);
    });

    it('is unaffected by how much the parent has consumed', () => {
      // This is the property that lets one subsystem change without shifting
      // every other subsystem's sequence, keeping shared seeds valid.
      const fresh = new Rng(777);
      const used = new Rng(777);
      for (let i = 0; i < 100; i++) used.next();
      expect(used.fork('music').seed).toBe(fresh.fork('music').seed);
    });

    it('does not advance the parent stream', () => {
      const rng = new Rng(31337);
      const before = rng.position;
      rng.fork('anything');
      expect(rng.position).toBe(before);
    });
  });

  describe('clone', () => {
    it('resumes from the same position', () => {
      const rng = new Rng(2024);
      for (let i = 0; i < 10; i++) rng.next();
      const copy = rng.clone();
      expect(copy.next()).toBe(rng.next());
    });

    it('reproduces gaussian draws, which must not cache a spare variate', () => {
      const rng = new Rng(8);
      rng.gaussian();
      const copy = rng.clone();
      expect(copy.gaussian()).toBe(rng.gaussian());
    });
  });

  describe('pick and weighted', () => {
    it('picks only from the given list', () => {
      const rng = new Rng(17);
      const items = ['a', 'b', 'c'] as const;
      for (let i = 0; i < 200; i++) expect(items).toContain(rng.pick(items));
    });

    it('throws rather than returning undefined on an empty list', () => {
      expect(() => new Rng(1).pick([])).toThrow(/empty/);
    });

    it('never selects a non-positive weight', () => {
      // The twist scheduler relies on this to exclude conflicting twists.
      const rng = new Rng(3);
      const items = ['excluded', 'allowed'];
      for (let i = 0; i < 500; i++) {
        expect(rng.weighted(items, (item) => (item === 'allowed' ? 1 : 0))).toBe('allowed');
      }
    });

    it('throws when nothing is selectable', () => {
      expect(() => new Rng(1).weighted(['x'], () => 0)).toThrow(/positive weight/);
    });

    it('roughly honours relative weights', () => {
      const rng = new Rng(90);
      let heavy = 0;
      const runs = 20_000;
      for (let i = 0; i < runs; i++) {
        if (rng.weighted(['heavy', 'light'], (item) => (item === 'heavy' ? 3 : 1)) === 'heavy') {
          heavy++;
        }
      }
      expect(heavy / runs).toBeGreaterThan(0.71);
      expect(heavy / runs).toBeLessThan(0.79);
    });
  });

  describe('shuffle', () => {
    it('keeps every element exactly once', () => {
      const items = Array.from({ length: 50 }, (_, i) => i);
      const shuffled = new Rng(11).shuffle([...items]);
      expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    });

    it('is deterministic', () => {
      const source = Array.from({ length: 20 }, (_, i) => i);
      expect(new Rng(5).shuffle([...source])).toEqual(new Rng(5).shuffle([...source]));
    });
  });
});

describe('seed codes', () => {
  it('round-trips', () => {
    for (const seed of [0, 1, 42, 1023, 0xffffffff, 3141592653]) {
      expect(decodeSeed(encodeSeed(seed))).toBe(seed >>> 0);
    }
  });

  it('round-trips random seeds', () => {
    const rng = new Rng(64);
    for (let i = 0; i < 1_000; i++) {
      const seed = rng.uint32();
      expect(decodeSeed(encodeSeed(seed))).toBe(seed);
    }
  });

  it('formats as a readable grouped code', () => {
    expect(encodeSeed(12345)).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{4}$/);
  });

  it('omits characters that are easy to misread', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) {
      expect(encodeSeed(rng.uint32())).not.toMatch(/[ILOU]/);
    }
  });

  it('accepts codes typed with ambiguous characters or no separator', () => {
    const canonical = decodeSeed('K3F-9QW2');
    expect(decodeSeed('k3f9qw2')).toBe(canonical);
    // I/L fold to 1, O to 0, U to V — so a misread code still resolves.
    // ILK-OMNI folds character-for-character to 11K-0MN1.
    expect(decodeSeed('11K-0MN1')).toBe(decodeSeed('ILK-OMNI'));
    expect(decodeSeed('VPQ-RSTV')).toBe(decodeSeed('UPQ-RSTU'));
  });

  it('rejects malformed codes', () => {
    expect(decodeSeed('')).toBeNull();
    expect(decodeSeed('!!!')).toBeNull();
    expect(decodeSeed('TOOMANYCHARS')).toBeNull();
  });
});

describe('dailySeed', () => {
  it('is stable across the same UTC day', () => {
    const morning = new Date(Date.UTC(2026, 6, 30, 1, 0, 0));
    const evening = new Date(Date.UTC(2026, 6, 30, 23, 59, 0));
    expect(dailySeed(morning)).toBe(dailySeed(evening));
  });

  it('changes between days', () => {
    const today = new Date(Date.UTC(2026, 6, 30));
    const tomorrow = new Date(Date.UTC(2026, 6, 31));
    expect(dailySeed(today)).not.toBe(dailySeed(tomorrow));
  });
});

describe('hashString', () => {
  it('is stable and returns an unsigned 32-bit value', () => {
    expect(hashString('mirage')).toBe(hashString('mirage'));
    const hash = hashString('mirage');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('separates similar strings', () => {
    expect(hashString('terrain')).not.toBe(hashString('terrain '));
    expect(hashString('twist1')).not.toBe(hashString('twist2'));
  });
});
