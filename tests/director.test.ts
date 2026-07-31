import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/events';
import type { GameEvents } from '../src/game/events';
import type { InputSnapshot } from '../src/core/input';
import { RegionDirector, type DirectorHooks } from '../src/game/director';
import type { Region } from '../src/world/regions';
import type { Twist, TwistId } from '../src/twists/types';
import { DEFAULT_MODIFIERS } from '../src/player/player';
import { DEFAULT_RENDER_MODIFIERS } from '../src/game/camera';
import type { World } from '../src/world/world';
import type { Player } from '../src/player/player';

function region(overrides: Partial<Region> & { index: number; from: number; to: number }): Region {
  return {
    name: `Region ${overrides.index}`,
    law: [],
    paletteId: 'dusk',
    kind: 'natural',
    ...overrides,
  };
}

/** A world standing in for just the one method the director calls. */
function fakeWorld(regions: readonly Region[]): World {
  return {
    regionAt: (x: number) => regions.find((r) => x >= r.from && x < r.to) ?? (regions[0] as Region),
  } as unknown as World;
}

function fakePlayer(x: number, facing: 1 | -1 = 1): Player {
  return { x, facing, distance: Math.abs(x) } as unknown as Player;
}

function stubTwist(id: TwistId, label: string, log: string[]): Twist {
  return {
    id,
    label,
    onActivate: () => log.push(`${id}:activate`),
    onDeactivate: () => log.push(`${id}:deactivate`),
  };
}

function makeInput(overrides: Partial<InputSnapshot> = {}): InputSnapshot {
  return {
    moveAxis: 0,
    jumpPressed: false,
    jumpReleased: false,
    jumpHeld: false,
    holdSeconds: 0,
    interactPressed: false,
    pausePressed: false,
    restartPressed: false,
    pointerX: 0,
    pointerY: 0,
    ...overrides,
  };
}

function makeHooks(
  regions: readonly Region[],
  playerX = 0,
  facing: 1 | -1 = 1,
): { hooks: DirectorHooks; bus: EventBus<GameEvents> } {
  const bus = new EventBus<GameEvents>();
  return {
    hooks: { world: fakeWorld(regions), player: fakePlayer(playerX, facing), bus, collectChime: vi.fn() },
    bus,
  };
}

const DT = 1 / 60;

describe('RegionDirector', () => {
  it('starts with nothing active and no current region', () => {
    const director = new RegionDirector([]);
    expect(director.activeLabels).toEqual([]);
    expect(director.region).toBeNull();
    expect(director.approachingRegion).toBeNull();
  });

  it('activates the region under the player on the very first update', () => {
    const log: string[] = [];
    const mirror = stubTwist('mirror', 'Mirror', log);
    const regions = [region({ index: 0, from: -Infinity, to: 1000, law: ['mirror'] })];
    const director = new RegionDirector([mirror]);
    const { hooks, bus } = makeHooks(regions, 0);

    const entered: string[] = [];
    bus.on('region:enter', ({ name }) => entered.push(name));

    director.update(DT, hooks);

    expect(log).toEqual(['mirror:activate']);
    expect(director.activeLabels).toEqual(['Mirror']);
    expect(director.region?.index).toBe(0);
    expect(entered).toEqual(['Region 0']);
  });

  it('deactivates the outgoing law and activates the incoming one when crossing a boundary', () => {
    const log: string[] = [];
    const mirror = stubTwist('mirror', 'Mirror', log);
    const wind = stubTwist('wind', 'Wind', log);
    const regions = [
      region({ index: 0, from: -Infinity, to: 1000, law: ['mirror'] }),
      region({ index: 1, from: 1000, to: 2000, law: ['wind'] }),
    ];
    const director = new RegionDirector([mirror, wind]);
    const { hooks } = makeHooks(regions, 0);

    director.update(DT, hooks);
    expect(director.activeLabels).toEqual(['Mirror']);

    hooks.player = { x: 1500, facing: 1, distance: 1500 } as unknown as Player;
    director.update(DT, hooks);

    expect(log).toEqual(['mirror:activate', 'mirror:deactivate', 'wind:activate']);
    expect(director.activeLabels).toEqual(['Wind']);
    expect(director.region?.index).toBe(1);
  });

  it('does not re-activate anything while the player stays inside the same region', () => {
    const log: string[] = [];
    const mirror = stubTwist('mirror', 'Mirror', log);
    const regions = [region({ index: 0, from: -Infinity, to: 5000, law: ['mirror'] })];
    const director = new RegionDirector([mirror]);
    const { hooks } = makeHooks(regions, 0);

    for (let x = 0; x <= 2000; x += 100) {
      hooks.player = { x, facing: 1, distance: x } as unknown as Player;
      director.update(DT, hooks);
    }

    expect(log).toEqual(['mirror:activate']);
  });

  it('crosses a boundary correctly when walking backward too', () => {
    const log: string[] = [];
    const mirror = stubTwist('mirror', 'Mirror', log);
    const regions = [
      region({ index: 0, from: -Infinity, to: 1000, law: [] }),
      region({ index: 1, from: 1000, to: 2000, law: ['mirror'] }),
    ];
    const director = new RegionDirector([mirror]);
    const { hooks } = makeHooks(regions, 1500, -1);

    director.update(DT, hooks); // starts inside region 1
    expect(director.activeLabels).toEqual(['Mirror']);

    hooks.player = { x: 500, facing: -1, distance: 500 } as unknown as Player;
    director.update(DT, hooks); // walked backward into region 0

    expect(log).toEqual(['mirror:activate', 'mirror:deactivate']);
    expect(director.activeLabels).toEqual([]);
    expect(director.region?.index).toBe(0);
  });

  describe('approaching', () => {
    it('reports the region ahead once within the lookahead, in the facing direction', () => {
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 2000, law: [] }),
      ];
      const director = new RegionDirector([]);
      const { hooks, bus } = makeHooks(regions, 780, 1); // 220px from the boundary, facing right

      const approached: string[] = [];
      bus.on('region:approach', ({ name }) => approached.push(name));

      director.update(DT, hooks);
      expect(director.approachingRegion?.index).toBe(1);
      expect(approached).toEqual(['Region 1']);
    });

    it('is null while far from any boundary', () => {
      const regions = [region({ index: 0, from: -Infinity, to: 10_000, law: [] })];
      const director = new RegionDirector([]);
      const { hooks } = makeHooks(regions, 100, 1);
      director.update(DT, hooks);
      expect(director.approachingRegion).toBeNull();
    });

    it('follows facing, not just position — the same spot approaches different regions depending on direction', () => {
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 2000, law: [] }),
      ];
      const director = new RegionDirector([]);

      const { hooks: rightHooks } = makeHooks(regions, 900, 1);
      director.update(DT, rightHooks);
      expect(director.approachingRegion?.index).toBe(1);

      const fresh = new RegionDirector([]);
      const { hooks: leftHooks } = makeHooks(regions, 1100, -1);
      fresh.update(DT, leftHooks);
      expect(fresh.approachingRegion?.index).toBe(0);
    });

    it('only emits region:approach once per approach, not every frame', () => {
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 2000, law: [] }),
      ];
      const director = new RegionDirector([]);
      const { hooks, bus } = makeHooks(regions, 780, 1);
      const approached: string[] = [];
      bus.on('region:approach', ({ name }) => approached.push(name));

      for (let i = 0; i < 10; i++) director.update(DT, hooks);
      expect(approached).toEqual(['Region 1']);
    });
  });

  it('reset() deactivates the active law and forces re-entry on the next update', () => {
    const log: string[] = [];
    const mirror = stubTwist('mirror', 'Mirror', log);
    const regions = [region({ index: 0, from: -Infinity, to: 1000, law: ['mirror'] })];
    const director = new RegionDirector([mirror]);
    const { hooks } = makeHooks(regions, 0);

    director.update(DT, hooks);
    expect(director.activeLabels).toEqual(['Mirror']);

    director.reset();
    expect(director.activeLabels).toEqual([]);
    expect(director.region).toBeNull();
    expect(log).toEqual(['mirror:activate', 'mirror:deactivate']);

    // Re-entering the very same region still re-activates: reset forgot it was ever entered.
    director.update(DT, hooks);
    expect(log).toEqual(['mirror:activate', 'mirror:deactivate', 'mirror:activate']);
  });

  it('folds physics and render hooks over the neutral baseline when nothing is active', () => {
    const director = new RegionDirector([]);
    expect(director.computePhysicsModifiers()).toEqual(DEFAULT_MODIFIERS);
    expect(director.computeRenderModifiers()).toEqual(DEFAULT_RENDER_MODIFIERS);
  });

  it('folds an active twist\'s physics/render/input hooks', () => {
    const twist: Twist = {
      id: 'moonwalk',
      label: 'Moonwalk',
      physics: (base) => ({ ...base, gravityScale: base.gravityScale * 0.5 }),
      render: (base) => ({ ...base, rotation: Math.PI }),
      transformInput: (input) => ({ ...input, moveAxis: -input.moveAxis }),
    };
    const regions = [region({ index: 0, from: -Infinity, to: 1000, law: ['moonwalk'] })];
    const director = new RegionDirector([twist]);
    const { hooks } = makeHooks(regions, 0);
    director.update(DT, hooks);

    expect(director.computePhysicsModifiers().gravityScale).toBeCloseTo(0.5, 6);
    expect(director.computeRenderModifiers().rotation).toBeCloseTo(Math.PI, 6);
    expect(director.transformInput(makeInput({ moveAxis: 1 }), DT).moveAxis).toBe(-1);
  });

  describe('rejection grace (escaping a Mirror-style boundary trap)', () => {
    // A law that flips moveAxis (Mirror's actual behaviour) is its own inverse: under
    // unchanging held input, entering and being pushed straight back out is a perfectly
    // symmetric round trip that never makes net progress on its own — see director.ts's
    // GRACE_BASE_SECONDS for the full derivation, confirmed by direct simulation
    // (25/25 random seeds deadlocked forever with hysteresis alone, at every margin
    // tried). These tests cover the escalating-grace mechanism that guarantees escape.

    it('applies a region\'s law immediately on a first, unrejected entry', () => {
      const log: string[] = [];
      const mirror = stubTwist('mirror', 'Mirror', log);
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 5000, law: ['mirror'] }),
      ];
      const director = new RegionDirector([mirror]);
      const { hooks } = makeHooks(regions, 900);
      director.update(DT, hooks);

      hooks.player = { x: 1100, facing: 1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks);

      expect(director.activeLabels).toEqual(['Mirror']);
      expect(log).toEqual(['mirror:activate']);
    });

    it('suppresses the law on re-entry after a rejection, then applies it once the grace window elapses', () => {
      const log: string[] = [];
      const mirror = stubTwist('mirror', 'Mirror', log);
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 5000, law: ['mirror'] }),
      ];
      const director = new RegionDirector([mirror]);
      const { hooks } = makeHooks(regions, 900);

      director.update(DT, hooks); // region 0

      hooks.player = { x: 1100, facing: 1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks); // first entry: law applies immediately
      expect(director.activeLabels).toEqual(['Mirror']);

      hooks.player = { x: 900, facing: -1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks); // pushed back out: a rejection
      expect(director.activeLabels).toEqual([]);

      hooks.player = { x: 1100, facing: 1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks); // re-entry: suppressed, not refought immediately
      expect(director.activeLabels).toEqual([]);
      expect(director.region?.index).toBe(1);

      // Still within the grace window: staying put doesn't apply the law early.
      for (let i = 0; i < 10; i++) director.update(DT, hooks);
      expect(director.activeLabels).toEqual([]);

      // The grace window (GRACE_BASE_SECONDS * 2^0 = 0.35s) has now elapsed.
      for (let i = 0; i < 30; i++) director.update(DT, hooks);
      expect(director.activeLabels).toEqual(['Mirror']);
    });

    it('doubles the grace window on each further rejection of the same region', () => {
      const log: string[] = [];
      const mirror = stubTwist('mirror', 'Mirror', log);
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 5000, law: ['mirror'] }),
      ];
      const director = new RegionDirector([mirror]);
      const { hooks } = makeHooks(regions, 900);
      director.update(DT, hooks);

      // Reject the region twice in a row.
      for (let rejection = 0; rejection < 2; rejection++) {
        hooks.player = { x: 1100, facing: 1, distance: 1100 } as unknown as Player;
        director.update(DT, hooks);
        hooks.player = { x: 900, facing: -1, distance: 1100 } as unknown as Player;
        director.update(DT, hooks);
      }

      // Third entry: grace should now be 0.35 * 2^1 = 0.7s — not yet applied at 0.35s...
      hooks.player = { x: 1100, facing: 1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks);
      for (let i = 0; i < Math.round(0.35 / DT); i++) director.update(DT, hooks);
      expect(director.activeLabels).toEqual([]);

      // ...but is active well past 0.7s.
      for (let i = 0; i < Math.round(0.5 / DT); i++) director.update(DT, hooks);
      expect(director.activeLabels).toEqual(['Mirror']);
    });

    it('forgets a region\'s rejection count once cleanly cleared, so a later revisit is unopposed at first', () => {
      const log: string[] = [];
      const mirror = stubTwist('mirror', 'Mirror', log);
      const regions = [
        region({ index: 0, from: -Infinity, to: 1000, law: [] }),
        region({ index: 1, from: 1000, to: 2000, law: ['mirror'] }),
        region({ index: 2, from: 2000, to: 6000, law: [] }),
      ];
      const director = new RegionDirector([mirror]);
      const { hooks } = makeHooks(regions, 900);
      director.update(DT, hooks);

      // Reject once, then walk all the way through to the far side and beyond
      // (stepping back into region 1 on the way, as real per-frame movement would,
      // rather than jumping straight past it).
      hooks.player = { x: 1100, facing: 1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks);
      hooks.player = { x: 900, facing: -1, distance: 1100 } as unknown as Player;
      director.update(DT, hooks);
      hooks.player = { x: 1500, facing: 1, distance: 1500 } as unknown as Player;
      director.update(DT, hooks); // back into region 1, still under grace
      hooks.player = { x: 2100, facing: 1, distance: 2100 } as unknown as Player;
      director.update(DT, hooks); // clears region 1 into region 2

      // Walk backward into region 1 again and then forward once more — a fresh visit,
      // no leftover grace, so its law should apply immediately again.
      hooks.player = { x: 1500, facing: -1, distance: 2100 } as unknown as Player;
      director.update(DT, hooks);
      expect(director.activeLabels).toEqual(['Mirror']);
    });
  });
});
