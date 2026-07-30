import { describe, expect, it, vi } from 'vitest';
import { Rng } from '../../src/core/rng';
import { World } from '../../src/world/world';
import { Player } from '../../src/player/player';
import { EventBus } from '../../src/core/events';
import type { GameEvents } from '../../src/game/events';
import type { InputSnapshot } from '../../src/core/input';
import { createInversionTwist } from '../../src/twists/inversion';
import { createMirrorTwist } from '../../src/twists/mirror';
import { createMoonwalkTwist } from '../../src/twists/moonwalk';
import { createWindTwist } from '../../src/twists/wind';
import { createMetronomeTwist } from '../../src/twists/metronome';
import { createEchoTwist } from '../../src/twists/echo';
import { DEFAULT_MODIFIERS } from '../../src/player/player';
import { DEFAULT_RENDER_MODIFIERS } from '../../src/game/camera';
import type { TwistRuntimeContext } from '../../src/twists/types';

const DT = 1 / 60;

function makeCtx(seed = 1): TwistRuntimeContext {
  const world = new World(new Rng(seed));
  const player = new Player(world);
  const bus = new EventBus<GameEvents>();
  return { world, player, bus, collectChime: vi.fn() };
}

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

describe('createInversionTwist', () => {
  it('rolls the camera 180 degrees and touches nothing else', () => {
    const twist = createInversionTwist();
    const render = twist.render?.(DEFAULT_RENDER_MODIFIERS);
    expect(render).toEqual({ rotation: Math.PI, mirrorX: false });
    expect(twist.physics).toBeUndefined();
  });
});

describe('createMirrorTwist', () => {
  it('mirrors rendering and reverses trick spin', () => {
    const twist = createMirrorTwist();
    expect(twist.render?.(DEFAULT_RENDER_MODIFIERS)).toEqual({ rotation: 0, mirrorX: true });
    expect(twist.physics?.(DEFAULT_MODIFIERS)).toEqual({
      gravityScale: 1,
      windAccel: 0,
      spinSign: -1,
    });
  });

  it('toggles rather than forcing, so stacking with itself would cancel out', () => {
    const twist = createMirrorTwist();
    const once = twist.render?.(DEFAULT_RENDER_MODIFIERS) ?? DEFAULT_RENDER_MODIFIERS;
    const twice = twist.render?.(once) ?? once;
    expect(twice.mirrorX).toBe(false);
  });
});

describe('createMoonwalkTwist', () => {
  it('softens gravity and leaves everything else neutral', () => {
    const twist = createMoonwalkTwist();
    const result = twist.physics?.(DEFAULT_MODIFIERS);
    expect(result?.gravityScale).toBeLessThan(1);
    expect(result?.gravityScale).toBeGreaterThan(0);
    expect(result?.windAccel).toBe(0);
    expect(result?.spinSign).toBe(1);
  });
});

describe('createWindTwist', () => {
  it('draws nothing before activation', () => {
    const twist = createWindTwist(new Rng(1));
    expect(twist.physics?.(DEFAULT_MODIFIERS).windAccel).toBe(0);
  });

  it('picks a nonzero push on activation, within the documented range', () => {
    const twist = createWindTwist(new Rng(1));
    twist.onActivate?.(makeCtx());
    const accel = twist.physics?.(DEFAULT_MODIFIERS).windAccel ?? 0;
    expect(Math.abs(accel)).toBeGreaterThanOrEqual(70);
    expect(Math.abs(accel)).toBeLessThanOrEqual(160);
  });

  it('is deterministic: the same seed draws the same sequence of directions', () => {
    const a = createWindTwist(new Rng(42));
    const b = createWindTwist(new Rng(42));
    const draws = (twist: ReturnType<typeof createWindTwist>): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        twist.onActivate?.(makeCtx());
        out.push(twist.physics?.(DEFAULT_MODIFIERS).windAccel ?? 0);
      }
      return out;
    };
    expect(draws(a)).toEqual(draws(b));
  });

  it('redraws on every activation, not just the first', () => {
    const twist = createWindTwist(new Rng(7));
    const seen = new Set<number>();
    for (let i = 0; i < 10; i++) {
      twist.onActivate?.(makeCtx());
      seen.add(twist.physics?.(DEFAULT_MODIFIERS).windAccel ?? 0);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('createMetronomeTwist', () => {
  it('passes an on-beat press through unchanged', () => {
    const twist = createMetronomeTwist();
    twist.onActivate?.(makeCtx());
    // t=0 is a beat boundary; a press right there is on-beat.
    const input = makeInput({ jumpPressed: true, jumpHeld: true, holdSeconds: 0.05 });
    const result = twist.transformInput?.(input, DT) ?? input;
    expect(result).toEqual(input);
  });

  it('buffers an off-beat press and fires it fixed-height at the next window', () => {
    const twist = createMetronomeTwist();
    twist.onActivate?.(makeCtx());

    // Well off-beat (beat period is 0.5s; land at the midpoint).
    let result = twist.transformInput?.(
      makeInput({ jumpPressed: true, jumpHeld: true, holdSeconds: 0.01 }),
      0.25,
    );
    expect(result?.jumpPressed).toBe(false); // swallowed for now

    // Advance to the next beat boundary in small steps, holding the button down.
    let fired = false;
    for (let i = 0; i < 40 && !fired; i++) {
      result = twist.transformInput?.(makeInput({ jumpHeld: true, holdSeconds: 0.3 }), DT);
      if (result?.jumpPressed) fired = true;
    }
    expect(fired).toBe(true);
    expect(result?.holdSeconds).toBe(0); // fixed-height: reported hold is reset
    expect(result?.jumpHeld).toBe(true);
  });

  it('forgets a buffered press if no window arrives before the timeout', () => {
    const twist = createMetronomeTwist();
    twist.onActivate?.(makeCtx());

    twist.transformInput?.(makeInput({ jumpPressed: true, jumpHeld: false }), 0.25);
    // A single huge dt jumps straight past the buffer timeout without ever landing in a
    // window — the implementation must not fire something stale from long ago.
    const result = twist.transformInput?.(makeInput(), 10);
    expect(result?.jumpPressed).toBe(false);
  });

  it('resets its beat clock on every activation', () => {
    const twist = createMetronomeTwist();
    twist.onActivate?.(makeCtx());
    twist.transformInput?.(makeInput(), 0.3); // advance partway into a beat

    twist.onActivate?.(makeCtx());
    // Immediately after a fresh activation, t=0 is a beat boundary again — an on-beat
    // press right away must pass straight through, proving elapsed was reset to 0.
    const input = makeInput({ jumpPressed: true, jumpHeld: true, holdSeconds: 0 });
    const result = twist.transformInput?.(input, DT);
    expect(result).toEqual(input);
  });

  it('does not touch input when nothing is pressed and nothing is queued', () => {
    const twist = createMetronomeTwist();
    twist.onActivate?.(makeCtx());
    const input = makeInput({ jumpHeld: false });
    expect(twist.transformInput?.(input, DT)).toEqual(input);
  });
});

describe('createEchoTwist', () => {
  it('renders no ghost before three seconds of history exist', () => {
    const twist = createEchoTwist();
    const ctx = makeCtx();
    twist.onActivate?.(ctx);

    for (let i = 0; i < 60; i++) twist.update?.(DT); // 1s, well short of the 3s delay

    const spy = { polygon: vi.fn(), disc: vi.fn() };
    twist.emit?.(spy as never);
    expect(spy.polygon).not.toHaveBeenCalled();
    expect(spy.disc).not.toHaveBeenCalled();
  });

  it('retraces the exact position from three seconds ago once the buffer fills', () => {
    const twist = createEchoTwist();
    const ctx = makeCtx();
    twist.onActivate?.(ctx);

    const history: number[] = [];
    const totalSteps = Math.round(4 / DT); // 4s: one second past the delay
    for (let i = 0; i < totalSteps; i++) {
      ctx.player.x = i; // a simple, checkable position sequence
      // The real Player starts at whatever angle the terrain has at x=0, not flat — pin it
      // so the disc-offset maths below (which depends on rotation) is exactly checkable.
      ctx.player.rotation = 0;
      history.push(ctx.player.x);
      twist.update?.(DT);
    }

    // 3s later at 60Hz is exactly 180 steps behind.
    const delaySteps = Math.round(3 / DT);
    const expectedX = history[history.length - 1 - delaySteps];

    let capturedX: number | null = null;
    const spy = {
      polygon: () => {},
      point: () => {},
      end: () => {},
      disc: (_role: unknown, _layer: unknown, x: number) => {
        capturedX = x;
      },
    };
    twist.emit?.(spy as never);
    expect(capturedX).not.toBeNull();
    // The disc is drawn offset from the ghost's exact x by a rotation-dependent term;
    // with rotation 0 (the player never moved vertically here) it lands exactly on x.
    expect(capturedX).toBeCloseTo(expectedX as number, 6);
  });

  it('collects chimes near the ghost through the shared collectChime hook', () => {
    const twist = createEchoTwist();
    const ctx = makeCtx();
    const collectChime = vi.fn();
    twist.onActivate?.({ ...ctx, collectChime });

    // Park the player directly on top of a real chime the world actually generated, then
    // hold still long enough for the ghost to catch up to that exact spot.
    const chime = [...ctx.world.chimesNear(6_000, 1_500)][0];
    expect(chime).toBeDefined();
    if (!chime) return;

    const steps = Math.round(3.2 / DT);
    for (let i = 0; i < steps; i++) {
      ctx.player.x = chime.x;
      ctx.player.y = chime.y;
      twist.update?.(DT);
    }

    expect(collectChime).toHaveBeenCalled();
  });

  it('stops tracking after onDeactivate, so update() does nothing once inactive', () => {
    const twist = createEchoTwist();
    const ctx = makeCtx();
    twist.onActivate?.(ctx);
    twist.onDeactivate?.();

    // Should not throw despite no captured player/world/collectChime.
    expect(() => twist.update?.(DT)).not.toThrow();
  });

  it('restarts its history on re-activation rather than carrying stale positions', () => {
    const twist = createEchoTwist();
    const first = makeCtx();
    twist.onActivate?.(first);
    for (let i = 0; i < Math.round(4 / DT); i++) {
      first.player.x = 999; // a position that must not leak into the next activation
      twist.update?.(DT);
    }
    twist.onDeactivate?.();

    const second = makeCtx();
    twist.onActivate?.(second);
    for (let i = 0; i < 60; i++) {
      second.player.x = 0;
      twist.update?.(DT);
    }

    // Only 1s of fresh history exists — nowhere near the 3s needed for a ghost yet.
    const spy = { polygon: vi.fn(), disc: vi.fn() };
    twist.emit?.(spy as never);
    expect(spy.polygon).not.toHaveBeenCalled();
  });
});
