/**
 * Unified touch / mouse / keyboard input.
 *
 * The game is designed for one thumb, so touch is the reference implementation
 * and keyboard exists for desktop development. Everything the simulation reads is
 * exposed as a flat snapshot with explicit one-step edges, because a fixed
 * timestep loop can run zero or several update steps per frame — "was the button
 * pressed this frame" is not a well-defined question, but "was it pressed during
 * this simulation step" is.
 */

/** Downward drag past this many CSS pixels counts as a dive. */
const DIVE_THRESHOLD_PX = 44;

export interface InputSnapshot {
  /** Jump began during this step. */
  jumpPressed: boolean;
  /** Jump ended during this step. */
  jumpReleased: boolean;
  /** Jump is currently down — drives variable jump height. */
  jumpHeld: boolean;
  /** How long the current hold has lasted, in seconds. */
  holdSeconds: number;
  /** A downward swipe or Down key began during this step. */
  divePressed: boolean;
  pausePressed: boolean;
  restartPressed: boolean;
  /** Latest pointer position in CSS pixels, for menu interaction. */
  pointerX: number;
  pointerY: number;
}

export class Input {
  private readonly state: InputSnapshot = {
    jumpPressed: false,
    jumpReleased: false,
    jumpHeld: false,
    holdSeconds: 0,
    divePressed: false,
    pausePressed: false,
    restartPressed: false,
    pointerX: 0,
    pointerY: 0,
  };

  private target: HTMLElement | null = null;
  private activePointerId: number | null = null;
  private pointerDownY = 0;
  private pointerDownX = 0;
  private diveFiredForPointer = false;
  private holdStartedAt = 0;
  private firstInputListeners: Array<() => void> = [];
  private sawFirstInput = false;

  /** Read-only view of the current step's input. */
  get snapshot(): Readonly<InputSnapshot> {
    if (this.state.jumpHeld) {
      this.state.holdSeconds = (performance.now() - this.holdStartedAt) / 1000;
    }
    return this.state;
  }

  attach(target: HTMLElement): void {
    this.detach();
    this.target = target;

    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
    // A pointer that leaves the surface must not leave the jump stuck down.
    target.addEventListener('lostpointercapture', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    const target = this.target;
    if (target) {
      target.removeEventListener('pointerdown', this.onPointerDown);
      target.removeEventListener('pointermove', this.onPointerMove);
      target.removeEventListener('pointerup', this.onPointerUp);
      target.removeEventListener('pointercancel', this.onPointerUp);
      target.removeEventListener('lostpointercapture', this.onPointerUp);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target = null;
  }

  /**
   * Registers a callback for the very first user gesture. The audio engine uses
   * this: a WebView `AudioContext` starts suspended and can only be resumed from
   * inside a real input event.
   */
  onFirstInput(listener: () => void): void {
    if (this.sawFirstInput) listener();
    else this.firstInputListeners.push(listener);
  }

  /** Clears one-step edges. The game calls this at the end of every update. */
  endStep(): void {
    this.state.jumpPressed = false;
    this.state.jumpReleased = false;
    this.state.divePressed = false;
    this.state.pausePressed = false;
    this.state.restartPressed = false;
  }

  private noteFirstInput(): void {
    if (this.sawFirstInput) return;
    this.sawFirstInput = true;
    const listeners = this.firstInputListeners;
    this.firstInputListeners = [];
    for (const listener of listeners) listener();
  }

  private beginJump(): void {
    // Edges are sticky until the next endStep, so a press that lands between
    // simulation steps is never dropped.
    this.state.jumpPressed = true;
    this.state.jumpHeld = true;
    this.state.holdSeconds = 0;
    this.holdStartedAt = performance.now();
  }

  private endJump(): void {
    if (!this.state.jumpHeld) return;
    this.state.jumpHeld = false;
    this.state.jumpReleased = true;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.noteFirstInput();
    this.state.pointerX = event.clientX;
    this.state.pointerY = event.clientY;

    // Secondary fingers are ignored; this is a one-thumb game.
    if (this.activePointerId !== null) return;

    this.activePointerId = event.pointerId;
    this.pointerDownX = event.clientX;
    this.pointerDownY = event.clientY;
    this.diveFiredForPointer = false;
    this.beginJump();
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.state.pointerX = event.clientX;
    this.state.pointerY = event.clientY;
    if (event.pointerId !== this.activePointerId || this.diveFiredForPointer) return;

    const dy = event.clientY - this.pointerDownY;
    const dx = event.clientX - this.pointerDownX;
    // Predominantly downward, so a horizontal drag does not dive.
    if (dy > DIVE_THRESHOLD_PX && dy > Math.abs(dx)) {
      this.state.divePressed = true;
      this.diveFiredForPointer = true;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.endJump();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    this.noteFirstInput();

    switch (event.code) {
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        this.beginJump();
        event.preventDefault();
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.state.divePressed = true;
        event.preventDefault();
        break;
      case 'Escape':
      case 'KeyP':
        this.state.pausePressed = true;
        break;
      case 'KeyR':
        this.state.restartPressed = true;
        break;
      default:
        break;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      this.endJump();
    }
  };

  /** Losing focus mid-hold would otherwise leave the player jumping forever. */
  private readonly onBlur = (): void => {
    this.activePointerId = null;
    this.endJump();
  };
}
