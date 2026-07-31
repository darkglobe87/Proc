import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { InputSnapshot } from '../src/core/input';
import { Rng } from '../src/core/rng';
import type { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { Player } from '../src/player/player';
import type { GameEvents } from '../src/game/events';

const DT = 1 / 60;

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

function setup(seed = 1234) {
  const world = new World(new Rng(seed));
  const player = new Player(world);
  const bus = new EventBus<GameEvents>();
  return { world, terrain: world.terrain, player, bus };
}

/** Finds an x where the ground is close to flat and not curving. */
function findFlat(terrain: Terrain, from: number, to: number): number {
  let bestX = from;
  let bestScore = Infinity;
  for (let x = from; x < to; x += 3) {
    const score = Math.abs(terrain.slopeAt(x)) + Math.abs(terrain.curvatureAt(x)) * 40;
    if (score < bestScore) {
      bestScore = score;
      bestX = x;
    }
  }
  return bestX;
}

describe('Player', () => {
  describe('ground contact', () => {
    it('never passes through terrain over a long run', () => {
      // Tunnelling is unrecoverable: once below the surface every later test also
      // fails. This is the single most important invariant here.
      const { terrain, player, bus } = setup(90210);
      let worstPenetration = 0;
      let worstX = 0;

      for (let step = 0; step < 10_000; step++) {
        const input = makeInput({
          moveAxis: Math.sin(step * 0.01) > 0 ? 1 : -1,
          jumpPressed: step % 53 === 0,
          jumpHeld: step % 53 < 20,
          holdSeconds: (step % 53) * DT,
        });
        player.update(DT, input, bus);

        const penetration = player.y - terrain.heightAt(player.x);
        if (penetration > worstPenetration) {
          worstPenetration = penetration;
          worstX = player.x;
        }
      }

      expect(
        worstPenetration,
        `sank ${worstPenetration.toFixed(2)}px below ground at x=${worstX}`,
      ).toBeLessThan(1);
    });

    /**
     * Regression test for a real bug found in play, not caught by the test above:
     * sustained forward movement with periodic held jumps eventually tunnelled
     * through an uphill slope and fell forever, `vy` climbing without bound.
     *
     * Root cause was in the old `sweepVertical`, which compared the fall's end
     * height against terrain sampled only at the final x — wrong the instant the
     * ground under the end of a step differs even slightly from the ground under
     * where the crossing actually happened, which any slope does, every step. Once
     * one fall was misjudged "still airborne" by a single step, the very next
     * step's "was above the ground at the start" guard could never be true again,
     * since y only grows deeper from there — see `world/solids.ts`'s `sweepVertical`
     * and its own direct test for the fix. This test is the end-to-end guard: sustained
     * one-directional play, across many seeds and far enough to cross real uphill
     * ground, must never let `vy` run away.
     */
    it('never falls forever, across sustained forward movement and many jumps', () => {
      for (const seed of [1, 7, 90210, 31337, 5028]) {
        const { terrain, player, bus } = setup(seed);
        for (let step = 0; step < 15_000; step++) {
          const jumpPhase = step % 180;
          player.update(
            DT,
            makeInput({
              moveAxis: 1,
              jumpPressed: jumpPhase === 0,
              jumpHeld: jumpPhase < 10,
              holdSeconds: jumpPhase * DT,
            }),
            bus,
          );
          expect(Math.abs(player.vy), `seed ${seed} runaway at step ${step}`).toBeLessThan(3000);
          // A generous bound, not a tight one: the very step a jump fires, `y` hasn't
          // integrated yet while `x` has already moved, so this reads a few px of
          // "penetration" against the new x's (possibly sloped) ground for exactly one
          // frame before self-correcting — harmless. Runaway tunnelling is nothing like
          // this: it grows without bound from the very next frame on, never recovers.
          expect(
            player.y - terrain.heightAt(player.x),
            `seed ${seed} tunnelled at step ${step}, x=${player.x.toFixed(0)}`,
          ).toBeLessThan(20);
        }
      }
    });

    it('never exceeds top speed no matter how long the pad is held', () => {
      const { player, bus } = setup(5);
      for (let step = 0; step < 3_000; step++) {
        player.update(DT, makeInput({ moveAxis: 1 }), bus);
        expect(Math.abs(player.vx)).toBeLessThanOrEqual(210 + 1e-6);
        expect(Number.isFinite(player.y)).toBe(true);
      }
    });

    it('tracks the furthest x reached as `distance`, in either direction', () => {
      const { player, bus } = setup(11);
      for (let step = 0; step < 300; step++) player.update(DT, makeInput({ moveAxis: 1 }), bus);
      // Let vx fully decelerate through zero and turn around before snapshotting the
      // peak — while vx is still positive during that turnaround, x (and so distance)
      // keeps growing for a few more frames even though the pad has already reversed.
      for (let step = 0; step < 30; step++) player.update(DT, makeInput({ moveAxis: -1 }), bus);
      const peak = player.distance;

      for (let step = 0; step < 400; step++) player.update(DT, makeInput({ moveAxis: -1 }), bus);
      // Walking back past the origin does not erase how far right was once reached.
      expect(player.distance).toBe(peak);
      expect(player.x).toBeLessThan(peak);
    });
  });

  describe('walking', () => {
    it('accelerates toward the pad axis and stops accelerating at top speed', () => {
      const { player, bus } = setup(1);
      let previous = 0;
      for (let step = 0; step < 200; step++) {
        player.update(DT, makeInput({ moveAxis: 1 }), bus);
        expect(player.vx).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = player.vx;
      }
      expect(player.vx).toBeCloseTo(210, 0);
    });

    it('faces the direction last pushed, and holds that facing when released', () => {
      const { player, bus } = setup(1);
      player.update(DT, makeInput({ moveAxis: -1 }), bus);
      expect(player.facing).toBe(-1);
      player.update(DT, makeInput({ moveAxis: 0 }), bus);
      expect(player.facing).toBe(-1); // releasing the pad does not turn you around
    });

    it('decelerates to a stop once the pad is released', () => {
      const { player, bus } = setup(1);
      for (let step = 0; step < 60; step++) player.update(DT, makeInput({ moveAxis: 1 }), bus);
      expect(player.vx).toBeGreaterThan(50);

      for (let step = 0; step < 60; step++) player.update(DT, makeInput(), bus);
      expect(player.vx).toBe(0);
    });
  });

  describe('jumping', () => {
    it('jumps when pressed, leaving the ground', () => {
      const { player, bus } = setup(42);
      const before = player.y;
      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      expect(player.grounded).toBe(false);
      expect(player.vy).toBeLessThan(0); // the impulse fires this step...
      player.update(DT, makeInput({ jumpHeld: true, holdSeconds: DT }), bus);
      expect(player.y).toBeLessThan(before); // ...and y actually rises the next
    });

    it('jumps higher the longer the button is held, up to the cap', () => {
      const { terrain } = setup(31337);
      const flatX = findFlat(terrain, 1_500, 3_000);

      function apexHeight(holdSteps: number): number {
        const { player, bus } = setup(31337);
        player.x = flatX;
        player.y = terrain.heightAt(flatX);
        player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
        let apex = player.y;
        for (let step = 0; step < 90; step++) {
          const held = step < holdSteps;
          player.update(DT, makeInput({ jumpHeld: held, holdSeconds: step * DT }), bus);
          apex = Math.min(apex, player.y);
          if (player.grounded) break;
        }
        return apex;
      }

      const shortHop = apexHeight(1);
      const fullHop = apexHeight(30);
      expect(fullHop).toBeLessThan(shortHop); // smaller y is higher
    });

    it('grants coyote time: a jump just after walking off an edge still fires', () => {
      const { world, player, bus } = setup(9001);
      player.x = 0;
      player.y = world.terrain.heightAt(0);
      player.grounded = true;

      // Force airborne the way walking off a ledge would, without a jump input.
      player.update(DT, makeInput({ moveAxis: 1 }), bus);
      player.grounded = false;
      player.vy = 0;

      // Within the coyote window (a couple of steps), a press must still jump.
      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      expect(player.vy).toBeLessThan(0);
    });

    it('does not grant coyote time long after leaving the ground', () => {
      const { world, player, bus } = setup(9001);
      // Well clear of the ground, so the fall genuinely lasts the whole loop below
      // rather than landing partway through it and confusing "airborne" with "grounded".
      player.y = world.terrain.heightAt(0) - 500;
      player.grounded = false;
      player.vy = 50; // already falling, well past any edge
      for (let step = 0; step < 30; step++) player.update(DT, makeInput(), bus);
      expect(player.grounded).toBe(false); // still genuinely airborne
      const vyBefore = player.vy;
      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      // No jump impulse this late — vy keeps integrating gravity, it does not snap negative.
      expect(player.vy).toBeGreaterThan(vyBefore);
    });

    it('buffers a jump pressed just before landing', () => {
      const { terrain, player, bus } = setup(31337);
      const flatX = findFlat(terrain, 1_500, 3_000);
      player.x = flatX;
      player.y = terrain.heightAt(flatX) - 20;
      player.vy = 200; // already falling, about to land
      player.grounded = false;

      // Press now, one step before contact.
      player.update(DT, makeInput({ jumpPressed: true }), bus);
      // Ride it down; the buffered press should fire the instant the ground is reached.
      let jumped = false;
      for (let step = 0; step < 10; step++) {
        player.update(DT, makeInput(), bus);
        if (!player.grounded && player.vy < 0) jumped = true;
      }
      expect(jumped).toBe(true);
    });
  });

  describe('decor', () => {
    it('walking through where a decor piece stands neither stops nor diverts the player', () => {
      // Decor is scenery, not a hazard (see world/decor.ts) — there is nothing here to
      // collide with at all. Confirms passing straight through one changes nothing about
      // motion: no snag, no redirect, no event.
      const { world, player, bus } = setup(7);
      const decor = [...world.decorNear(10_000, 10_000)][0];
      expect(decor).toBeDefined();
      if (!decor) return;

      player.x = decor.x - 40;
      player.y = decor.y;
      player.grounded = true;
      for (let step = 0; step < 30; step++) {
        player.update(DT, makeInput({ moveAxis: 1 }), bus);
      }
      // Walked straight past it under constant rightward input, same as over open ground.
      expect(player.x).toBeGreaterThan(decor.x);
    });
  });

  describe('reset', () => {
    it('returns to a clean starting state', () => {
      const { terrain, player, bus } = setup(3);
      for (let step = 0; step < 500; step++) player.update(DT, makeInput({ moveAxis: 1 }), bus);
      player.reset();

      expect(player.x).toBe(0);
      expect(player.y).toBeCloseTo(terrain.heightAt(0), 6);
      expect(player.grounded).toBe(true);
      expect(player.vx).toBe(0);
      expect(player.distance).toBe(0);
    });
  });
});
