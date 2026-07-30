import { describe, expect, it } from 'vitest';
import { Flow, MAX_FLOW } from '../src/game/flow';

const DT = 1 / 60;

/** Advances `seconds` of idle time in fixed steps. */
function idle(flow: Flow, seconds: number): void {
  for (let step = 0; step < Math.round(seconds / DT); step++) flow.update(DT);
}

describe('Flow', () => {
  it('starts at a neutral multiplier', () => {
    const flow = new Flow();
    expect(flow.multiplier).toBe(1);
    expect(flow.peakMultiplier).toBe(1);
    expect(flow.isDecaying).toBe(false);
  });

  it('builds on clean landings, and pays more for tricks', () => {
    const plain = new Flow();
    plain.cleanLanding(0);

    const withFlips = new Flow();
    withFlips.cleanLanding(2);

    expect(plain.multiplier).toBeGreaterThan(1);
    expect(withFlips.multiplier).toBeGreaterThan(plain.multiplier);
  });

  it('builds while grinding', () => {
    const flow = new Flow();
    for (let step = 0; step < 60; step++) flow.grinding(DT);
    expect(flow.multiplier).toBeGreaterThan(1.5);
  });

  it('builds a little on chimes and more on near-misses', () => {
    const chimes = new Flow();
    chimes.chime();
    const nearMiss = new Flow();
    nearMiss.nearMiss();
    expect(nearMiss.multiplier).toBeGreaterThan(chimes.multiplier);
  });

  it('never exceeds its cap', () => {
    const flow = new Flow();
    for (let i = 0; i < 200; i++) flow.cleanLanding(3);
    expect(flow.multiplier).toBe(MAX_FLOW);
    expect(flow.peakMultiplier).toBe(MAX_FLOW);
  });

  describe('decay', () => {
    it('holds steady through the grace period', () => {
      const flow = new Flow();
      flow.cleanLanding(2);
      const built = flow.multiplier;
      idle(flow, 2);
      expect(flow.multiplier).toBeCloseTo(built, 5);
      expect(flow.isDecaying).toBe(false);
    });

    it('bleeds away after the grace period', () => {
      const flow = new Flow();
      flow.cleanLanding(2);
      const built = flow.multiplier;
      idle(flow, 3.5);
      expect(flow.multiplier).toBeLessThan(built);
      expect(flow.isDecaying).toBe(true);
    });

    it('never falls below neutral', () => {
      const flow = new Flow();
      flow.cleanLanding(1);
      idle(flow, 60);
      expect(flow.multiplier).toBe(1);
    });

    it('resets the grace period on every gain', () => {
      const flow = new Flow();
      flow.cleanLanding(2);
      const built = flow.multiplier;
      // Two near-misses of the grace window, with a chime in between to reset it.
      idle(flow, 2);
      flow.chime();
      idle(flow, 2);
      expect(flow.multiplier).toBeGreaterThanOrEqual(built);
      expect(flow.isDecaying).toBe(false);
    });

    it('reports idle progress for the HUD bar', () => {
      const flow = new Flow();
      flow.cleanLanding(1);
      expect(flow.idleFraction).toBeCloseTo(0, 2);
      idle(flow, 1.25);
      expect(flow.idleFraction).toBeGreaterThan(0.4);
      expect(flow.idleFraction).toBeLessThan(0.6);
      idle(flow, 5);
      expect(flow.idleFraction).toBe(1);
    });
  });

  describe('penalties', () => {
    it('halves the multiplier on a sloppy landing rather than clearing it', () => {
      // Breaking flow must cost the multiplier, never the run — and not all of it, or
      // players stop attempting anything ambitious.
      const flow = new Flow();
      for (let i = 0; i < 4; i++) flow.cleanLanding(1);
      const built = flow.multiplier;
      expect(built).toBeGreaterThan(2);

      flow.sloppyLanding();
      expect(flow.multiplier).toBeCloseTo(built / 2, 5);
      expect(flow.multiplier).toBeGreaterThan(1);
    });

    it('cannot be pushed below neutral by repeated sloppy landings', () => {
      const flow = new Flow();
      flow.cleanLanding(0);
      for (let i = 0; i < 40; i++) flow.sloppyLanding();
      expect(flow.multiplier).toBe(1);
    });

    it('clears fully on reset', () => {
      const flow = new Flow();
      for (let i = 0; i < 6; i++) flow.cleanLanding(2);
      flow.reset();
      expect(flow.multiplier).toBe(1);
      expect(flow.peakMultiplier).toBe(1);
      expect(flow.idleFraction).toBe(0);
    });
  });

  describe('peak tracking', () => {
    it('remembers the highest multiplier reached, not the current one', () => {
      const flow = new Flow();
      for (let i = 0; i < 5; i++) flow.cleanLanding(2);
      const peak = flow.multiplier;
      idle(flow, 30);
      expect(flow.multiplier).toBe(1);
      expect(flow.peakMultiplier).toBeCloseTo(peak, 5);
    });
  });

  describe('chime value', () => {
    it('scales with the multiplier', () => {
      const flow = new Flow();
      expect(flow.valueOfChime(10)).toBe(10);
      for (let i = 0; i < 5; i++) flow.cleanLanding(2);
      expect(flow.valueOfChime(10)).toBeGreaterThan(10);
      expect(flow.valueOfChime(10)).toBe(Math.round(10 * flow.multiplier));
    });

    it('returns whole numbers, since it is shown as a score', () => {
      const flow = new Flow();
      flow.cleanLanding(1);
      expect(Number.isInteger(flow.valueOfChime())).toBe(true);
    });
  });
});
