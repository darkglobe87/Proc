import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import type { InputSnapshot } from '../src/core/input';
import { Rng } from '../src/core/rng';
import type { Terrain } from '../src/world/terrain';
import { World } from '../src/world/world';
import { LANDING_TOLERANCE, Player, classifyLanding } from '../src/player/player';
import type { GameEvents, LandingQuality } from '../src/game/events';

const DT = 1 / 60;

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
      // fails and the run is stuck. This is the single most important invariant here.
      const { terrain, player, bus } = setup(90210);
      let worstPenetration = 0;
      let worstX = 0;

      for (let step = 0; step < 10_000; step++) {
        // Jump periodically and hold sometimes, to exercise flight and dives.
        const input = makeInput({
          jumpPressed: step % 97 === 0,
          jumpHeld: step % 97 < 12,
          holdSeconds: (step % 97) * DT,
          divePressed: step % 271 === 0,
        });
        player.update(DT, input, bus);
        if (player.dead) player.reset();

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

    it('holds speed within bounds no matter the terrain', () => {
      const { player, bus } = setup(5);
      for (let step = 0; step < 6_000; step++) {
        player.update(DT, makeInput(), bus);
        if (player.dead) player.reset();
        expect(player.vx).toBeGreaterThan(0);
        expect(player.vx).toBeLessThanOrEqual(900);
        expect(Number.isFinite(player.y)).toBe(true);
      }
    });

    it('advances distance monotonically', () => {
      const { player, bus } = setup(11);
      let previous = 0;
      for (let step = 0; step < 2_000; step++) {
        player.update(DT, makeInput(), bus);
        expect(player.distance).toBeGreaterThanOrEqual(previous);
        previous = player.distance;
      }
      expect(player.distance).toBeGreaterThan(1_000);
    });
  });

  describe('difficulty', () => {
    it('never kills a passive player with terrain alone', () => {
      // Hazards are suppressed so this measures only the ground, launches and landings.
      // Dying here would mean the terrain generator or the landing tolerance is hostile —
      // crashes must come from the player's choices, not from the scenery.
      for (const seed of [1, 2, 3, 5, 8, 13, 21]) {
        const { world, player, bus } = setup(seed);
        world.suppressHazards('test', -Infinity, Infinity);
        for (let step = 0; step < 4_000 && !player.dead; step++) {
          player.update(DT, makeInput(), bus);
        }
        expect(player.distance, `seed ${seed} died at ${player.distance.toFixed(0)}px`)
          .toBeGreaterThan(5_000);
      }
    });

    it('does kill a passive player once obstacles are in play', () => {
      // The complement of the test above, and the reason obstacles exist: ignoring the
      // controls should not be a viable strategy.
      let deaths = 0;
      for (const seed of [1, 2, 3, 5, 8, 13, 21]) {
        const { player, bus } = setup(seed);
        for (let step = 0; step < 4_000 && !player.dead; step++) {
          player.update(DT, makeInput(), bus);
        }
        if (player.dead) deaths++;
      }
      expect(deaths).toBeGreaterThan(4);
    });

    it('suppression hides hazards from queries entirely', () => {
      const { world } = setup(7);
      // Wide enough to contain an obstacle regardless of how many nearby candidates the
      // uphill filter (obstacles.ts) happens to reject for this seed.
      const before = world.obstaclesNear(10_000, 10_000).length;
      expect(before).toBeGreaterThan(0);
      world.suppressHazards('test', -Infinity, Infinity);
      expect(world.obstaclesNear(10_000, 10_000).length).toBe(0);
      world.clearHazardSuppression('test');
      expect(world.obstaclesNear(10_000, 10_000).length).toBe(before);
    });
  });

  describe('classifyLanding', () => {
    /** Verdict for a body angle `offsetDegrees` away from the surface. */
    function verdict(offsetDegrees: number, surfaceDegrees = 0): LandingQuality {
      const surface = (surfaceDegrees * Math.PI) / 180;
      return classifyLanding(surface + (offsetDegrees * Math.PI) / 180, surface);
    }

    it('treats a well-aligned landing as clean', () => {
      for (const offset of [0, 10, -10, 20, -20, 34, -34]) {
        expect(verdict(offset), `${offset}°`).toBe('clean');
      }
    });

    it('treats a moderately off landing as sloppy but survivable', () => {
      for (const offset of [40, -40, 55, -55, 74, -74]) {
        expect(verdict(offset), `${offset}°`).toBe('sloppy');
      }
    });

    it('crashes when landing inverted', () => {
      for (const offset of [80, -80, 120, 180, -120]) {
        expect(verdict(offset), `${offset}°`).toBe('crash');
      }
    });

    it('pins the boundaries at the documented 35 and 75 degrees', () => {
      // These tolerances are the primary feel dial, so their values are asserted —
      // widening them should be a deliberate edit, not a silent drift.
      expect(verdict(34.9)).toBe('clean');
      expect(verdict(35.1)).toBe('sloppy');
      expect(verdict(74.9)).toBe('sloppy');
      expect(verdict(75.1)).toBe('crash');
      expect(LANDING_TOLERANCE.clean).toBeCloseTo((35 * Math.PI) / 180, 9);
      expect(LANDING_TOLERANCE.sloppy).toBeCloseTo((75 * Math.PI) / 180, 9);
    });

    it('judges relative to the surface, not to horizontal', () => {
      // On a 40° slope, matching the slope is clean while staying horizontal is not.
      // Judging against horizontal instead would invert this and make every steep
      // landing lethal.
      const slope = (40 * Math.PI) / 180;
      expect(classifyLanding(slope, slope)).toBe('clean');
      expect(classifyLanding(0, slope)).toBe('sloppy');
    });

    it('wraps angles, so a rotation of 350 degrees is nearly upright', () => {
      expect(verdict(350)).toBe('clean');
      expect(verdict(-350)).toBe('clean');
      expect(verdict(365)).toBe('clean');
    });
  });

  describe('landing', () => {
    it('kills the player only on a crash', () => {
      const { world, terrain, player, bus } = setup(31337);
      // Landing classification is what is under test; an obstacle at the chosen spot
      // would be a different cause of death.
      world.suppressHazards('test', -Infinity, Infinity);
      const flatX = findFlat(terrain, 1_500, 3_000);
      player.x = flatX;
      player.y = terrain.heightAt(flatX) - 40;
      player.vy = 260;
      player.grounded = false;
      player.rotation = terrain.angleAt(flatX);
      for (let step = 0; step < 120 && !player.grounded; step++) {
        player.update(DT, makeInput(), bus);
      }
      expect(player.grounded).toBe(true);
      expect(player.dead).toBe(false);
    });

    it('crashes when a committed flip is landed part-way round', () => {
      // The end-to-end version of the risk mechanic: choosing to rotate disables
      // self-levelling, so bailing out mid-flip is fatal.
      const { player, bus } = setup(4242);
      let crashed = false;
      bus.on('player:crash', () => {
        crashed = true;
      });

      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      player.vy = -1100;
      // Hold past the spin delay and on into roughly a half rotation, then release and
      // ride it down.
      for (let step = 0; step < 42; step++) {
        player.update(DT, makeInput({ jumpHeld: true, holdSeconds: step * DT }), bus);
      }
      for (let step = 0; step < 200 && !player.grounded; step++) {
        player.update(DT, makeInput(), bus);
      }
      expect(crashed).toBe(true);
      expect(player.dead).toBe(true);
    });

    it('does not pay a boost for merely brushing the ground', () => {
      // Guards the feedback loop that once pinned speed at maximum: a tangential launch
      // re-contacted within two frames, each touch scored as a clean landing, and the
      // boost compounded until the player was stuck at max speed making no progress.
      const { terrain, player, bus } = setup(31337);
      const flatX = findFlat(terrain, 1_500, 3_000);

      player.x = flatX;
      player.y = terrain.heightAt(flatX) - 1; // a hair above the surface
      player.vx = 300;
      player.vy = 20;
      player.grounded = false;
      player.rotation = terrain.angleAt(flatX);

      let landedAirtime = Infinity;
      bus.on('player:land', ({ airtime }) => {
        landedAirtime = Math.min(landedAirtime, airtime);
      });

      const before = player.vx;
      for (let step = 0; step < 10 && !player.grounded; step++) {
        player.update(DT, makeInput(), bus);
      }

      expect(player.grounded).toBe(true);
      expect(landedAirtime).toBeLessThan(0.12); // genuinely a brush, not a jump
      // Speed may ease toward its cruise target, but must not have been boosted.
      expect(player.vx).toBeLessThanOrEqual(before + 10);
    });
  });

  describe('launching', () => {
    it('leaves the ground without a jump when fast over a crest', () => {
      // The curvature criterion: air should be earned by speed and line, not only by
      // pressing the button. Hazards are suppressed because a passive player otherwise
      // dies near the start and never builds the speed a natural launch requires.
      const { world, player, bus } = setup(777);
      world.suppressHazards('test', -Infinity, Infinity);
      let naturalLaunches = 0;
      bus.on('player:launch', ({ jumped }) => {
        if (!jumped) naturalLaunches++;
      });

      for (let step = 0; step < 8_000; step++) {
        player.update(DT, makeInput(), bus);
        if (player.dead) player.reset();
      }
      expect(naturalLaunches).toBeGreaterThan(0);
    });

    it('does not launch off flat ground', () => {
      const { terrain, player, bus } = setup(31337);
      const flatX = findFlat(terrain, 1_500, 3_000);
      let launched = false;
      bus.on('player:launch', () => {
        launched = true;
      });

      player.x = flatX - 20;
      player.y = terrain.heightAt(player.x);
      player.vx = 300;
      player.grounded = true;
      for (let step = 0; step < 8; step++) player.update(DT, makeInput(), bus);
      expect(launched).toBe(false);
    });

    it('jumps when asked', () => {
      const { player, bus } = setup(42);
      const before = player.y;
      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      expect(player.grounded).toBe(false);
      expect(player.y).toBeLessThan(before); // smaller y is higher
    });
  });

  describe('tricks', () => {
    it('counts a full rotation as a flip', () => {
      const { player, bus } = setup(8);
      const flips: number[] = [];
      bus.on('player:trick', ({ flips: count }) => flips.push(count));

      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      // Buy generous airtime. A flip needs more air than a flat jump provides by
      // design, so doing this off a bare jump would measure the jump tuning rather
      // than the flip counter.
      player.vy = -1400;
      for (let step = 0; step < 150; step++) {
        player.update(DT, makeInput({ jumpHeld: true, holdSeconds: step * DT }), bus);
        if (player.grounded) break;
      }
      expect(flips[0]).toBe(1);
    });

    it('does not spin during a maximum-height jump', () => {
      // Jump height and tricks share one button. If holding for height also rotated the
      // player, every full-power jump would land inverted and kill the run — the game
      // would punish using its own jump. This is the regression guard for that.
      const { player, bus } = setup(8);
      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      const launchRotation = player.rotation;

      // Hold for the full variable-height window, then release, as a player reaching
      // for maximum height would.
      for (let step = 0; step < 14; step++) {
        player.update(DT, makeInput({ jumpHeld: true, holdSeconds: step * DT }), bus);
        if (player.grounded) break;
      }
      // Self-levelling tracks the ground angle beneath, so a few degrees of drift is
      // expected and fine. What must not happen is the ~120° of spin that holding for
      // height used to produce.
      expect(Math.abs(player.rotation - launchRotation)).toBeLessThan(0.2);
      expect(player.isFlipping).toBe(false);
    });

    it('freezes rotation when the button is released, so a landing can be aimed', () => {
      const { player, bus } = setup(8);
      player.update(DT, makeInput({ jumpPressed: true, jumpHeld: true }), bus);
      player.vy = -1400;

      // Hold well past the spin delay so rotation is genuinely under way.
      let held = 0;
      for (let step = 0; step < 30; step++) {
        held = step * DT;
        player.update(DT, makeInput({ jumpHeld: true, holdSeconds: held }), bus);
      }
      expect(player.isFlipping).toBe(true);

      const frozen = player.rotation;
      for (let step = 0; step < 5; step++) {
        player.update(DT, makeInput(), bus);
        if (player.grounded) break;
      }
      expect(player.rotation).toBeCloseTo(frozen, 6);
    });
  });

  describe('reset', () => {
    it('returns to a clean starting state', () => {
      const { terrain, player, bus } = setup(3);
      for (let step = 0; step < 500; step++) player.update(DT, makeInput(), bus);
      player.dead = true;
      player.reset();

      expect(player.x).toBe(0);
      expect(player.y).toBeCloseTo(terrain.heightAt(0), 6);
      expect(player.dead).toBe(false);
      expect(player.grounded).toBe(true);
      expect(player.distance).toBe(0);
    });
  });
});
