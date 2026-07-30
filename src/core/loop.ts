/**
 * Fixed-timestep game loop with an interpolated render.
 *
 * The simulation must be frame-rate independent and deterministic: a shared seed
 * has to produce the same course on a 60 Hz phone and a 120 Hz one, and the
 * determinism test in `tests/` depends on the step being exactly constant.
 *
 * The accumulator is clamped hard. An Android WebView that has been backgrounded
 * hands back a multi-second delta on resume; without the clamp that would either
 * tunnel the player through terrain or lock the phone up catching back up.
 */

export interface LoopHooks {
  /** Advances the simulation by exactly {@link GameLoop.fixedDt} seconds. */
  update(dt: number): void;
  /**
   * Draws one frame. `alpha` is the 0..1 position between the previous and
   * current simulation states, for interpolating motion.
   */
  render(alpha: number, frameDt: number): void;
}

/** 60 Hz simulation. */
const FIXED_DT = 1 / 60;
/** Deltas above this are treated as a stall and discarded, not caught up. */
const MAX_FRAME_DT = 0.25;
/** Ceiling on catch-up steps per frame, so a slow device degrades instead of freezing. */
const MAX_STEPS_PER_FRAME = 5;

export class GameLoop {
  readonly fixedDt = FIXED_DT;

  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;

  /** Exponentially smoothed frame cost, in ms. Drives the auto-downscale. */
  private smoothedFrameMs = 16.7;
  private smoothedFps = 60;

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Smoothed frames per second. */
  get fps(): number {
    return this.smoothedFps;
  }

  /** Smoothed milliseconds spent per frame. */
  get frameMs(): number {
    return this.smoothedFrameMs;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const frameStart = now;
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // A backgrounded tab or a GC pause produces a delta we must not simulate.
    if (frameDt > MAX_FRAME_DT) frameDt = FIXED_DT;
    if (frameDt < 0) frameDt = 0;

    this.smoothedFps += (1 / Math.max(frameDt, 1e-4) - this.smoothedFps) * 0.05;

    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.hooks.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    // Fell too far behind to recover: drop the backlog rather than accruing debt.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.hooks.render(this.accumulator / FIXED_DT, frameDt);

    this.smoothedFrameMs += (performance.now() - frameStart - this.smoothedFrameMs) * 0.05;
  };
}
