import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { World } from '../src/world/world';
import { CHUNK_WIDTH, ChunkField, chunkIndexAt } from '../src/world/chunks';
import type { ObstacleSpec } from '../src/world/chunks';
import { distanceToObstacle, hitsObstacle, resolveObstacle } from '../src/world/obstacles';
import { railCrossing, railYAt, resolveRail } from '../src/world/rails';

describe('spawn generation', () => {
  it('is identical regardless of the order chunks are visited', () => {
    // The Rewind property, now covering hazards and rails as well as terrain features.
    const forward = new ChunkField(new Rng(4242));
    for (let i = 0; i <= 8; i++) forward.chunk(i);

    const backward = new ChunkField(new Rng(4242));
    for (let i = 8; i >= 0; i--) backward.chunk(i);

    for (let i = 0; i <= 8; i++) {
      expect(backward.chunk(i).spawns).toEqual(forward.chunk(i).spawns);
    }
  });

  it('regenerates an evicted chunk identically', () => {
    const field = new ChunkField(new Rng(7));
    const original = structuredClone(field.chunk(6).spawns);
    field.prune(1_000_000);
    expect(field.chunk(6).spawns).toEqual(original);
  });

  it('leaves the opening chunk completely empty', () => {
    // A run must never start next to a hazard the player has not had time to see.
    const field = new ChunkField(new Rng(3));
    expect(field.chunk(0).spawns).toEqual([]);
    expect(field.chunk(0).features).toEqual([]);
  });
});

describe('obstacle fairness', () => {
  it('never stands inside a ramp or crest landing zone', () => {
    // A ramp always launches the player, so an obstacle in the landing zone is one they
    // were airborne over and could not avoid. This must hold by construction.
    for (const seed of [1, 5, 42, 777, 31337]) {
      const field = new ChunkField(new Rng(seed));
      for (let index = 1; index < 30; index++) {
        const chunk = field.chunk(index);
        const zones = chunk.features
          .filter((feature) => feature.kind === 'ramp' || feature.kind === 'crest')
          .map((feature) => ({
            from: feature.x,
            to: feature.x + feature.width / 2 + 460,
          }));

        for (const spec of chunk.spawns) {
          if (spec.kind !== 'obstacle') continue;
          for (const zone of zones) {
            const inside = spec.x > zone.from && spec.x < zone.to;
            expect(
              inside,
              `seed ${seed} chunk ${index}: obstacle at ${spec.x.toFixed(0)} inside launch zone ${zone.from.toFixed(0)}–${zone.to.toFixed(0)}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('keeps obstacles spaced apart within a chunk', () => {
    for (const seed of [2, 9, 64, 2024]) {
      const field = new ChunkField(new Rng(seed));
      for (let index = 1; index < 40; index++) {
        const xs = field
          .chunk(index)
          .spawns.filter((spec): spec is ObstacleSpec => spec.kind === 'obstacle')
          .map((spec) => spec.x)
          .sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) {
          expect((xs[i] as number) - (xs[i - 1] as number)).toBeGreaterThanOrEqual(260);
        }
      }
    }
  });

  it('stays inside its own chunk', () => {
    const field = new ChunkField(new Rng(11));
    for (let index = 1; index < 30; index++) {
      for (const spec of field.chunk(index).spawns) {
        if (spec.kind !== 'obstacle') continue;
        expect(chunkIndexAt(spec.x)).toBe(index);
      }
    }
  });
});

describe('obstacle collision', () => {
  const world = new World(new Rng(1));
  const obstacle = resolveObstacle(
    world.terrain,
    { kind: 'obstacle', slot: 0, x: 1_000, width: 24, height: 50, variant: 0 },
    1,
  );

  it('hits when overlapping the box', () => {
    expect(hitsObstacle(obstacle, obstacle.x, obstacle.y - 20, 11)).toBe(true);
  });

  it('misses when clearly above it', () => {
    expect(hitsObstacle(obstacle, obstacle.x, obstacle.y - obstacle.height - 40, 11)).toBe(false);
  });

  it('misses when clearly beside it', () => {
    expect(hitsObstacle(obstacle, obstacle.x + 60, obstacle.y - 10, 11)).toBe(false);
  });

  it('is forgiving at the very edge rather than punishing', () => {
    // Dying a pixel before anything visibly touches you reads as broken; the reverse goes
    // unnoticed. The generosity is deliberate and one-directional.
    const grazeX = obstacle.x + obstacle.width / 2 + 11 - 3;
    expect(hitsObstacle(obstacle, grazeX, obstacle.y - 10, 11)).toBe(false);
  });

  it('measures distance as zero when overlapping and grows outward', () => {
    expect(distanceToObstacle(obstacle, obstacle.x, obstacle.y - 10)).toBe(0);
    const near = distanceToObstacle(obstacle, obstacle.x + 30, obstacle.y - 10);
    const far = distanceToObstacle(obstacle, obstacle.x + 90, obstacle.y - 10);
    expect(far).toBeGreaterThan(near);
  });
});

describe('rails', () => {
  const world = new World(new Rng(5));
  const rail = resolveRail(
    world.terrain,
    { kind: 'rail', slot: 0, x: 2_000, length: 240, clearance: 60, tilt: 0.05 },
    2,
  );

  it('floats above the ground at its start', () => {
    expect(rail.y1).toBeLessThan(world.terrain.heightAt(rail.x1));
  });

  it('interpolates y across its span and rejects x outside it', () => {
    expect(railYAt(rail, rail.x1)).toBeCloseTo(rail.y1, 6);
    expect(railYAt(rail, rail.x2)).toBeCloseTo(rail.y2, 6);
    expect(railYAt(rail, rail.x1 - 1)).toBeNull();
    expect(railYAt(rail, rail.x2 + 1)).toBeNull();
  });

  it('catches a descending player crossing from above', () => {
    const midX = (rail.x1 + rail.x2) / 2;
    const railY = railYAt(rail, midX) as number;
    const crossing = railCrossing(rail, midX - 5, railY - 20, midX, railY + 5);
    expect(crossing).not.toBeNull();
  });

  it('ignores a player rising underneath it', () => {
    // Otherwise running along below a rail would snap you up onto it.
    const midX = (rail.x1 + rail.x2) / 2;
    const railY = railYAt(rail, midX) as number;
    expect(railCrossing(rail, midX - 5, railY + 30, midX, railY + 10)).toBeNull();
  });

  it('ignores a player still above it', () => {
    const midX = (rail.x1 + rail.x2) / 2;
    const railY = railYAt(rail, midX) as number;
    expect(railCrossing(rail, midX - 5, railY - 60, midX, railY - 40)).toBeNull();
  });
});

describe('World caching', () => {
  it('bounds resident chunks across a long run', () => {
    const world = new World(new Rng(9));
    for (let x = 0; x < 200_000; x += 400) {
      world.chimesNear(x, 600);
      world.obstaclesNear(x, 600);
      world.prune(x);
    }
    expect(world.residentCount).toBeLessThan(20);
  });

  it('resolves obstacles and rails identically after eviction', () => {
    const world = new World(new Rng(88));
    const key = (x: number): string =>
      [...world.obstaclesNear(x, 1_500)]
        .map((o) => `${o.id}:${o.x.toFixed(3)}:${o.y.toFixed(3)}`)
        .join('|');

    const before = key(9_000);
    expect(before.length).toBeGreaterThan(0);
    world.prune(600_000);
    expect(key(9_000)).toBe(before);
  });

  it('does not place spawns before the first chunk boundary', () => {
    const world = new World(new Rng(3));
    for (const obstacle of world.obstaclesNear(200, 200)) {
      expect(obstacle.x).toBeGreaterThanOrEqual(CHUNK_WIDTH);
    }
  });
});
