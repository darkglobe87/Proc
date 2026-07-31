import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';
import { Rng } from '../../src/core/rng';
import { World } from '../../src/world/world';
import { Player } from '../../src/player/player';
import type { GameEvents } from '../../src/game/events';
import { TELEGRAPH_SECONDS, TwistScheduler, type SchedulerHooks } from '../../src/twists/scheduler';
import type { Twist, TwistId } from '../../src/twists/types';

const DT = 1 / 60;

/** A twist with no behaviour beyond identity — for exercising the scheduler alone. */
function stub(id: TwistId, label: string, conflicts: readonly TwistId[] = []): Twist {
  return { id, label, conflicts };
}

/**
 * Advances the scheduler by `seconds` of fixed steps.
 *
 * The test player never actually runs (`player.update` is not called), so its distance
 * stays at 0 and the distance-based trigger can never fire — every advance in this file
 * is long enough to guarantee the *time* threshold (35–45s) fires instead, regardless of
 * which value that particular seed happened to draw.
 */
function advance(scheduler: TwistScheduler, hooks: SchedulerHooks, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) scheduler.update(DT, hooks);
}

/**
 * Advances one fixed step at a time until the telegraph begins.
 *
 * The threshold that triggers it is redrawn per cycle from 35–45s, so a fixed-duration
 * advance cannot safely stop "right after the threshold but before the telegraph also
 * finishes" — for a threshold drawn near the low end, a flat 46s advance runs long
 * enough to fall through the entire 1.5s telegraph too. Stepping until the phase itself
 * flips is exact regardless of which value was drawn.
 */
function advanceUntilTelegraphing(
  scheduler: TwistScheduler,
  hooks: SchedulerHooks,
  maxSteps = 60 * 60,
): void {
  for (let i = 0; i < maxSteps && !scheduler.isTelegraphing; i++) scheduler.update(DT, hooks);
  if (!scheduler.isTelegraphing) throw new Error('telegraph never began within maxSteps');
}

function makeHooks(seed = 1): { hooks: SchedulerHooks; bus: EventBus<GameEvents> } {
  const world = new World(new Rng(seed));
  const player = new Player(world);
  const bus = new EventBus<GameEvents>();
  return {
    hooks: { world, player, bus, collectChime: () => {} },
    bus,
  };
}

describe('TwistScheduler', () => {
  it('stays idle with no active twists until the first Shift lands', () => {
    const { hooks } = makeHooks();
    // A synthetic registry with a threshold reachable well inside the test's time budget
    // is unnecessary here: we only assert nothing activates prematurely, so real timing
    // constants are fine to advance toward without reaching.
    const scheduler = new TwistScheduler(new Rng(1), [stub('inversion', 'Inversion')]);
    advance(scheduler, hooks, 10);
    expect(scheduler.activeTwists).toEqual([]);
  });

  it('telegraphs before committing, in that order', () => {
    const { hooks } = makeHooks();
    const scheduler = new TwistScheduler(new Rng(1), [stub('inversion', 'Inversion')]);

    const events: string[] = [];
    hooks.bus.on('twist:telegraph', ({ labels }) => events.push(`telegraph:${labels.join(',')}`));
    hooks.bus.on('twist:shift', ({ ids }) => events.push(`shift:${ids.join(',')}`));

    advanceUntilTelegraphing(scheduler, hooks);

    expect(events[0]).toMatch(/^telegraph:/);
    expect(scheduler.activeTwists).toEqual([]); // not yet committed

    advance(scheduler, hooks, TELEGRAPH_SECONDS + 0.1);
    expect(events[1]).toMatch(/^shift:/);
    expect(scheduler.activeTwists.map((t) => t.id)).toEqual(['inversion']);
  });

  it('commits after exactly the telegraph window, not before', () => {
    const { hooks } = makeHooks();
    const scheduler = new TwistScheduler(new Rng(2), [stub('mirror', 'Mirror')]);
    advanceUntilTelegraphing(scheduler, hooks);
    expect(scheduler.activeTwists).toEqual([]);

    advance(scheduler, hooks, TELEGRAPH_SECONDS - 0.05);
    expect(scheduler.activeTwists).toEqual([]);

    advance(scheduler, hooks, 0.1);
    expect(scheduler.activeTwists.length).toBe(1);
  });

  it('does not repeat a twist before the pool is exhausted', () => {
    const ids: TwistId[] = ['inversion', 'mirror', 'moonwalk'];
    const { hooks } = makeHooks();
    const scheduler = new TwistScheduler(
      new Rng(3),
      ids.map((id) => stub(id, id)),
    );

    const seen: TwistId[] = [];
    hooks.bus.on('twist:shift', ({ ids: shiftIds }) => seen.push(shiftIds[0] as TwistId));

    // Five single-twist shifts (pairing starts at the 6th) exhausts a 3-item pool once
    // and dips into it again — the first 3 must be a permutation with no repeat.
    for (let i = 0; i < 5; i++) advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);

    expect(seen).toHaveLength(5);
    expect(new Set(seen.slice(0, 3)).size).toBe(3); // first full cycle: no repeats
  });

  it('pairs twists from the 6th Shift onward', () => {
    const ids: TwistId[] = ['inversion', 'mirror', 'moonwalk', 'wind'];
    const { hooks } = makeHooks();
    const scheduler = new TwistScheduler(
      new Rng(4),
      ids.map((id) => stub(id, id)),
    );

    const counts: number[] = [];
    hooks.bus.on('twist:shift', ({ ids: shiftIds }) => counts.push(shiftIds.length));

    for (let i = 0; i < 7; i++) advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);

    expect(counts.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(counts[5]).toBe(2);
    expect(counts[6]).toBe(2);
  });

  it('never pairs two twists that conflict', () => {
    // A conflicts with B; with only these two in the registry, a pair is impossible, so
    // the scheduler must fall back to a single twist rather than forcing the conflict.
    const { hooks } = makeHooks();
    const scheduler = new TwistScheduler(new Rng(5), [
      stub('inversion', 'A', ['mirror']),
      stub('mirror', 'B', ['inversion']),
    ]);

    const sets: TwistId[][] = [];
    hooks.bus.on('twist:shift', ({ ids }) => sets.push([...ids] as TwistId[]));

    for (let i = 0; i < 6; i++) advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);

    // Every shift from the 6th on would ask for a pair; every one must still be a
    // single twist, since the only two available conflict.
    for (const set of sets.slice(5)) {
      expect(set.length).toBe(1);
    }
  });

  it('does pair two twists that do not conflict', () => {
    const { hooks } = makeHooks();
    const scheduler = new TwistScheduler(new Rng(6), [
      stub('inversion', 'A'),
      stub('mirror', 'B'),
      stub('moonwalk', 'C'),
    ]);

    let lastSet: TwistId[] = [];
    hooks.bus.on('twist:shift', ({ ids }) => {
      lastSet = [...ids] as TwistId[];
    });

    for (let i = 0; i < 6; i++) advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);
    expect(lastSet.length).toBe(2);
    expect(new Set(lastSet).size).toBe(2); // the pair is two distinct twists
  });

  it('calls onDeactivate on the outgoing set and onActivate on the incoming one', () => {
    const { hooks } = makeHooks();
    const log: string[] = [];
    const a: Twist = {
      id: 'inversion',
      label: 'A',
      onActivate: () => log.push('a:activate'),
      onDeactivate: () => log.push('a:deactivate'),
    };
    const b: Twist = {
      id: 'mirror',
      label: 'B',
      onActivate: () => log.push('b:activate'),
      onDeactivate: () => log.push('b:deactivate'),
    };
    const scheduler = new TwistScheduler(new Rng(7), [a, b]);

    advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);
    expect(log).toEqual(['a:activate']);

    advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);
    // Whichever twist landed first is deactivated before the second activates.
    expect(log[1]).toBe('a:deactivate');
    expect(log[2]).toBe('b:activate');
  });

  it('is deterministic: same seed produces the same shift sequence', () => {
    const ids: TwistId[] = ['inversion', 'mirror', 'moonwalk', 'wind', 'metronome', 'echo'];
    function run(): string[] {
      const { hooks } = makeHooks(11);
      const scheduler = new TwistScheduler(
        new Rng(999),
        ids.map((id) => stub(id, id)),
      );
      const shifts: string[] = [];
      hooks.bus.on('twist:shift', ({ ids: shiftIds }) => shifts.push([...shiftIds].sort().join(',')));
      for (let i = 0; i < 8; i++) advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);
      return shifts;
    }

    expect(run()).toEqual(run());
  });

  it('resets fully: no leftover active twists, pool, or grace suppression', () => {
    const { hooks } = makeHooks();
    const deactivated: string[] = [];
    const scheduler = new TwistScheduler(new Rng(12), [
      { id: 'inversion', label: 'A', onDeactivate: () => deactivated.push('a') },
    ]);

    advance(scheduler, hooks, 46 + TELEGRAPH_SECONDS + 0.1);
    expect(scheduler.activeTwists.length).toBe(1);

    scheduler.reset();
    expect(scheduler.activeTwists).toEqual([]);
    expect(deactivated).toEqual(['a']);
    expect(scheduler.computePhysicsModifiers()).toEqual({
      gravityScale: 1,
      windAccel: 0,
    });
  });

  it('folds physics and render hooks over the neutral baseline when nothing is active', () => {
    const scheduler = new TwistScheduler(new Rng(13), [stub('inversion', 'Inversion')]);
    expect(scheduler.computePhysicsModifiers()).toEqual({
      gravityScale: 1,
      windAccel: 0,
    });
    expect(scheduler.computeRenderModifiers()).toEqual({ rotation: 0, mirrorX: false });
  });

  it('passes input through unchanged when no active twist transforms it', () => {
    const scheduler = new TwistScheduler(new Rng(14), [stub('inversion', 'Inversion')]);
    const input = {
      moveAxis: 0,
      jumpPressed: true,
      jumpReleased: false,
      jumpHeld: true,
      holdSeconds: 0.1,
      interactPressed: false,
      pausePressed: false,
      restartPressed: false,
      pointerX: 0,
      pointerY: 0,
    };
    expect(scheduler.transformInput(input, DT)).toEqual(input);
  });
});
