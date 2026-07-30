import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { InputSnapshot } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { World } from '../src/world/world';
import { Player, PLAYER_RADIUS } from '../src/player/player';
import { CHIME_RADIUS, arcLaunch, buildArc } from '../src/world/chimes';
import { chunkIndexAt, type ChimeArcSpec } from '../src/world/chunks';
import type { GameEvents } from '../src/game/events';

const DT = 1 / 60;
const REACH = CHIME_RADIUS + PLAYER_RADIUS;

function makeInput(overrides: Partial<InputSnapshot> = {}): InputSnapshot {
  return {
    jumpPressed: false,
    jumpReleased: false,
    jumpHeld: false,
    holdSeconds: 0,
    divePressed: false,
    pausePressed: false,
    restartPressed: false,
    pointerX: 0,
    pointerY: 0,
    ...overrides,
  };
}

interface OwnedArc {
  spec: ChimeArcSpec;
  /** The chunk that generated it — ids derive from this, never from position. */
  chunkIndex: number;
}

/**
 * Collects arcs the way `World` does: by owning chunk.
 *
 * Deriving the chunk from `spec.x` instead would repeat the bug this mirrors — an anchor
 * that drifted into the previous chunk gets the wrong id, colliding with its neighbour's.
 */
function arcsFor(seed: number, fromX: number, toX: number): OwnedArc[] {
  const world = new World(new Rng(seed));
  const owned: OwnedArc[] = [];
  for (let index = chunkIndexAt(fromX); index <= chunkIndexAt(toX); index++) {
    for (const spec of world.terrain.chunkSpawns(index)) {
      if (spec.kind !== 'chimeArc') continue;
      owned.push({ spec, chunkIndex: index });
    }
  }
  return owned;
}

/**
 * Runs a player to an arc's anchor, jumps and holds, and reports what fraction of the arc
 * came within collection range.
 *
 * Hold is 14 steps (~0.23s): past MAX_HOLD_SECONDS for full height, but short of
 * SPIN_DELAY so no flip starts. That is exactly the input the arc is drawn for.
 */
function fractionFlown(seed: number, owned: OwnedArc): number | null {
  const { spec, chunkIndex } = owned;
  const world = new World(new Rng(seed));
  // Hazards would end the run before reaching the arc; this measures the arc alone.
  world.suppressHazards('test', -Infinity, Infinity);
  const player = new Player(world);
  const bus = new EventBus<GameEvents>();

  const arc = buildArc(world.terrain, spec, chunkIndex);
  const launchX = arcLaunch(world.terrain, spec);
  if (arc.length === 0 || launchX === null) return null;
  const touched = new Set<number>();
  let holdStep = -1;

  for (let step = 0; step < 12_000; step++) {
    let input = makeInput();
    if (holdStep < 0 && player.x >= launchX && player.grounded) {
      holdStep = 0;
      input = makeInput({ jumpPressed: true, jumpHeld: true, holdSeconds: 0 });
    } else if (holdStep >= 0 && holdStep < 14) {
      holdStep++;
      input = makeInput({ jumpHeld: true, holdSeconds: holdStep * DT });
    }

    player.update(DT, input, bus);
    if (player.dead) break;

    for (const chime of arc) {
      const dx = chime.x - player.x;
      const dy = chime.y - (player.y - PLAYER_RADIUS);
      if (dx * dx + dy * dy <= REACH * REACH) touched.add(chime.id);
    }

    if (player.x > launchX + 700) break;
  }

  return touched.size / arc.length;
}

describe('chime arcs', () => {
  it('are flyable — a jump at the anchor collects most of the arc', () => {
    // The whole justification for chime arcs is that following one *is* the correct line.
    // An arc that teaches an impossible trajectory is worse than no arc at all, so this is
    // the test that matters most in this file.
    const specs = arcsFor(4242, 900, 20_000);
    expect(specs.length).toBeGreaterThan(8);

    // Arcs with no standable launch point are not placed at all; only the placed ones make
    // a claim about a flyable line, so only those are held to it.
    const placed: Array<{ x: number; fraction: number }> = [];
    for (const owned of specs) {
      const fraction = fractionFlown(4242, owned);
      if (fraction !== null) placed.push({ x: owned.spec.x, fraction });
    }
    expect(placed.length, 'too few arcs survived placement').toBeGreaterThan(5);

    for (const { x, fraction } of placed) {
      expect(fraction, `arc at x=${x.toFixed(0)} only ${(fraction * 100).toFixed(0)}% flown`)
        .toBeGreaterThan(0.4);
    }

    // And on average it should be comfortably better than the per-arc floor.
    const mean = placed.reduce((sum, entry) => sum + entry.fraction, 0) / placed.length;
    expect(mean, `mean ${(mean * 100).toFixed(0)}%`).toBeGreaterThan(0.7);
  });

  it('sits above the ground, never buried in it', () => {
    const world = new World(new Rng(31337));
    for (const { spec, chunkIndex } of arcsFor(31337, 900, 20_000)) {
      const arc = buildArc(world.terrain, spec, chunkIndex);
      for (const chime of arc) {
        // Smaller y is higher; a chime at or below ground level is uncollectable.
        expect(chime.y, `chime ${chime.id} at x=${chime.x.toFixed(0)}`).toBeLessThan(
          world.terrain.heightAt(chime.x) + 2,
        );
      }
    }
  });

  it('rises then falls, like the jump it traces', () => {
    const world = new World(new Rng(77));
    const specs = arcsFor(77, 900, 12_000);
    expect(specs.length).toBeGreaterThan(2);

    for (const { spec, chunkIndex } of specs) {
      const arc = buildArc(world.terrain, spec, chunkIndex);
      if (arc.length === 0) continue; // no standable launch point here
      // Height above local ground, so terrain slope does not confuse the shape.
      const heights = arc.map((chime) => world.terrain.heightAt(chime.x) - chime.y);
      const apex = Math.max(...heights);
      const apexIndex = heights.indexOf(apex);
      expect(apex).toBeGreaterThan(20);
      // The apex should be somewhere in the middle, not at an end.
      expect(apexIndex).toBeGreaterThan(0);
      expect(apexIndex).toBeLessThan(arc.length - 1);
    }
  });

  it('advances in x along the arc', () => {
    const world = new World(new Rng(5));
    for (const { spec, chunkIndex } of arcsFor(5, 900, 9_000)) {
      const arc = buildArc(world.terrain, spec, chunkIndex);
      for (let i = 1; i < arc.length; i++) {
        expect((arc[i] as { x: number }).x).toBeGreaterThan((arc[i - 1] as { x: number }).x);
      }
    }
  });

  it('gives every chime a distinct id and a rising pitch', () => {
    const world = new World(new Rng(11));
    const seen = new Set<number>();
    for (const { spec, chunkIndex } of arcsFor(11, 900, 20_000)) {
      const arc = buildArc(world.terrain, spec, chunkIndex);
      for (const chime of arc) {
        expect(seen.has(chime.id), `duplicate id ${chime.id}`).toBe(false);
        seen.add(chime.id);
        expect(chime.pitch).toBe(chime.index % 8);
        expect(chime.total).toBe(arc.length);
      }
    }
  });

  it('is deterministic and unaffected by eviction', () => {
    const a = new World(new Rng(2024));
    const b = new World(new Rng(2024));

    const positions = (world: World): string =>
      [...world.chimesNear(6_000, 1_500)].map((c) => `${c.id}:${c.x.toFixed(3)}`).join('|');

    const first = positions(a);
    // Push the cache far away and back again.
    b.prune(500_000);
    b.chimesNear(6_000, 1_500);
    b.prune(6_000);
    expect(positions(b)).toBe(first);
  });
});

describe('collection', () => {
  it('does not resurrect a collected chime after the chunk is evicted', () => {
    // The reason collected ids live outside the chunk cache. Only observable once Rewind
    // exists, which is why it is guaranteed now rather than discovered later.
    const world = new World(new Rng(64));
    const chime = [...world.chimesNear(6_000, 1_200)][0];
    expect(chime).toBeDefined();
    if (!chime) return;

    expect(world.collect(chime)).toBe(true);
    expect(world.collect(chime)).toBe(false);

    world.prune(500_000);
    world.prune(6_000);

    const stillThere = [...world.chimesNear(6_000, 1_200)].some((c) => c.id === chime.id);
    expect(stillThere).toBe(false);
    expect(world.isCollected(chime)).toBe(true);
  });

  it('restores everything on reset, so a new run is a fresh course', () => {
    const world = new World(new Rng(64));
    const before = [...world.chimesNear(6_000, 1_200)].length;
    for (const chime of [...world.chimesNear(6_000, 1_200)]) world.collect(chime);
    expect([...world.chimesNear(6_000, 1_200)].length).toBe(0);

    world.reset();
    expect([...world.chimesNear(6_000, 1_200)].length).toBe(before);
  });
});
