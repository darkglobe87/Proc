import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { World } from '../src/world/world';
import { CHUNK_WIDTH, ChunkField, chunkIndexAt } from '../src/world/chunks';
import type { DecorSpec } from '../src/world/chunks';
import { RegionField } from '../src/world/regions';
import { resolveDecor } from '../src/world/decor';
import { groundFollowAt, resolveLedge } from '../src/world/solids';

/** A ChunkField with its own matching RegionField, for tests that exercise it directly. */
function chunkField(seed: number): ChunkField {
  return new ChunkField(new Rng(seed), new RegionField(new Rng(seed)));
}

describe('spawn generation', () => {
  it('is identical regardless of the order chunks are visited', () => {
    // The Rewind property, now covering decor and ledges as well as terrain features.
    const forward = chunkField(4242);
    for (let i = 0; i <= 8; i++) forward.chunk(i);

    const backward = chunkField(4242);
    for (let i = 8; i >= 0; i--) backward.chunk(i);

    for (let i = 0; i <= 8; i++) {
      expect(backward.chunk(i).spawns).toEqual(forward.chunk(i).spawns);
    }
  });

  it('regenerates an evicted chunk identically', () => {
    const field = chunkField(7);
    const original = structuredClone(field.chunk(6).spawns);
    field.prune(1_000_000);
    expect(field.chunk(6).spawns).toEqual(original);
  });

  it('leaves the opening chunk completely empty', () => {
    // A run must never start next to scenery the player has not had time to see.
    const field = chunkField(3);
    expect(field.chunk(0).spawns).toEqual([]);
    expect(field.chunk(0).features).toEqual([]);
  });
});

describe('decor placement', () => {
  it('places at least one piece of scenery per chunk', () => {
    for (const seed of [1, 5, 42, 777, 31337]) {
      const field = chunkField(seed);
      for (let index = 1; index < 20; index++) {
        const count = field.chunk(index).spawns.filter((spec) => spec.kind === 'decor').length;
        expect(count, `seed ${seed} chunk ${index}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps decor spaced apart within a chunk', () => {
    for (const seed of [2, 9, 64, 2024]) {
      const field = chunkField(seed);
      for (let index = 1; index < 40; index++) {
        const xs = field
          .chunk(index)
          .spawns.filter((spec): spec is DecorSpec => spec.kind === 'decor')
          .map((spec) => spec.x)
          .sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) {
          expect((xs[i] as number) - (xs[i - 1] as number)).toBeGreaterThanOrEqual(200);
        }
      }
    }
  });

  it('stays inside its own chunk', () => {
    const field = chunkField(11);
    for (let index = 1; index < 30; index++) {
      for (const spec of field.chunk(index).spawns) {
        if (spec.kind !== 'decor') continue;
        expect(chunkIndexAt(spec.x)).toBe(index);
      }
    }
  });

  it('every decor spec resolves to an entity — nothing here gets rejected', () => {
    const world = new World(new Rng(3));
    for (let index = 1; index < 20; index++) {
      const specCount = world.terrain
        .chunkSpawns(index)
        .filter((spec) => spec.kind === 'decor').length;
      const resolvedCount = [...world.decorNear(index * CHUNK_WIDTH, CHUNK_WIDTH)].filter(
        (decor) => chunkIndexAt(decor.x) === index,
      ).length;
      expect(resolvedCount).toBe(specCount);
    }
  });
});

describe('resolveDecor', () => {
  const world = new World(new Rng(1));
  const decor = resolveDecor(
    world.terrain,
    { kind: 'decor', slot: 0, x: 1_200, width: 24, height: 50, variant: 0 },
    1,
  );

  it('anchors to the ground at its x', () => {
    expect(decor.y).toBeCloseTo(world.terrain.heightAt(1_200), 6);
  });

  it('carries the spec dimensions through unchanged', () => {
    expect(decor.width).toBe(24);
    expect(decor.height).toBe(50);
  });
});

describe('ledges', () => {
  const world = new World(new Rng(5));
  const ledge = resolveLedge(
    world.terrain,
    { kind: 'ledge', slot: 0, x: 2_000, width: 180, clearance: 60, thickness: 12 },
    2,
  );

  it('floats above the ground beneath its centre', () => {
    expect(ledge.y - ledge.height).toBeLessThan(world.terrain.heightAt(ledge.x));
  });

  it('is exactly `clearance` above the ground at its centre', () => {
    expect(world.terrain.heightAt(ledge.x) - (ledge.y - ledge.height)).toBeCloseTo(60, 6);
  });

  it('supports a body standing on top of it, once within tolerance', () => {
    const onTop = groundFollowAt([ledge], ledge.x, 9, ledge.y - ledge.height, 999_999);
    expect(onTop.grounded).toBe(true);
    expect(onTop.y).toBeCloseTo(ledge.y - ledge.height, 6);
  });

  it('does not support a body far below it — the terrain wins instead', () => {
    const terrainHeight = world.terrain.heightAt(ledge.x);
    const onGround = groundFollowAt([ledge], ledge.x, 9, terrainHeight, terrainHeight);
    expect(onGround.grounded).toBe(true);
    expect(onGround.y).toBeCloseTo(terrainHeight, 6);
  });

  it('does not support a body outside its horizontal span', () => {
    const past = ledge.x + ledge.width;
    const result = groundFollowAt([ledge], past, 9, ledge.y - ledge.height, 999_999);
    expect(result.grounded).toBe(false);
  });
});

describe('World caching', () => {
  it('bounds resident chunks across a long run', () => {
    const world = new World(new Rng(9));
    for (let x = 0; x < 200_000; x += 400) {
      world.chimesNear(x, 600);
      world.decorNear(x, 600);
      world.prune(x);
    }
    expect(world.residentCount).toBeLessThan(20);
  });

  it('resolves decor and ledges identically after eviction', () => {
    const world = new World(new Rng(88));
    const key = (x: number): string =>
      [...world.decorNear(x, 1_500)]
        .map((d) => `${d.id}:${d.x.toFixed(3)}:${d.y.toFixed(3)}`)
        .join('|');

    const before = key(9_000);
    expect(before.length).toBeGreaterThan(0);
    world.prune(600_000);
    expect(key(9_000)).toBe(before);
  });

  it('does not place spawns before the first chunk boundary', () => {
    const world = new World(new Rng(3));
    for (const decor of world.decorNear(200, 200)) {
      expect(decor.x).toBeGreaterThanOrEqual(CHUNK_WIDTH);
    }
  });
});
