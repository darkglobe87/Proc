/**
 * Unified touch / mouse / keyboard input.
 *
 * A platformer needs two hands' worth of intent — steer and jump, at once — so unlike
 * the runner this reads multiple simultaneous touches rather than one. The canvas is
 * split into three fixed zones, tracked by independent pointer ids so a thumb can hold
 * a zone down while another thumb operates a different one:
 *
 *   - left 40% of the screen: a virtual horizontal pad. Touch down anywhere in it and
 *     drag; the pad has no fixed knob to hit, it appears wherever the thumb landed.
 *   - top-right corner of the remaining 60%: interact. Small on purpose — it is only
 *     ever needed standing right next to something, not reached for in a hurry.
 *   - everything else (the large bottom-right area): jump. Deliberately the most
 *     forgiving hitbox on screen, since it is the most frequent input.
 *
 * Everything the simulation reads is exposed as a flat snapshot with explicit
 * one-step edges, because a fixed timestep loop can run zero or several update steps
 * per frame — "was the button pressed this frame" is not a well-defined question, but
 * "was it pressed during this simulation step" is.
 */

/** Fraction of canvas width claimed by the move pad, from the left edge. */
const MOVE_ZONE_FRACTION = 0.4;
/** Fraction of canvas height claimed by the interact corner, from the top. */
const INTERACT_ZONE_FRACTION = 0.3;
/** Drag distance for full deflection on the move pad, in CSS pixels. */
const MOVE_DRAG_PX = 36;

export interface InputSnapshot {
  /** -1..1. Continuous from touch drag; keyboard drives it to exactly -1, 0 or 1. */
  moveAxis: number;
  /** Jump began during this step. */
  jumpPressed: boolean;
  /** Jump ended during this step. */
  jumpReleased: boolean;
  /** Jump is currently down — drives variable jump height. */
  jumpHeld: boolean;
  /** How long the current hold has lasted, in seconds. */
  holdSeconds: number;
  /** Interact began during this step. */
  interactPressed: boolean;
  pausePressed: boolean;
  restartPressed: boolean;
  /** Latest pointer position in CSS pixels, for menu interaction. */
  pointerX: number;
  pointerY: number;
}

type Zone = 'move' | 'interact' | 'jump';

export class Input {
  private readonly state: InputSnapshot = {
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
  };

  private target: HTMLElement | null = null;

  private movePointerId: number | null = null;
  private movePointerDownX = 0;
  /** Keyboard drives the axis independently of any touch pointer. */
  private keyboardAxis = 0;
  /** Last live touch-drag axis, restored when a keyboard press that had overridden it ends. */
  private touchAxis = 0;

  private jumpPointerId: number | null = null;
  private interactPointerId: number | null = null;

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
    this.state.interactPressed = false;
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

  /** Which zone a CSS-pixel point falls in, relative to the target's own bounds. */
  private zoneAt(clientX: number, clientY: number): Zone {
    const rect = this.target?.getBoundingClientRect();
    const width = rect?.width || 1;
    const height = rect?.height || 1;
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);

    if (x < width * MOVE_ZONE_FRACTION) return 'move';
    if (y < height * INTERACT_ZONE_FRACTION) return 'interact';
    return 'jump';
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.noteFirstInput();
    this.state.pointerX = event.clientX;
    this.state.pointerY = event.clientY;

    const zone = this.zoneAt(event.clientX, event.clientY);
    switch (zone) {
      case 'move':
        if (this.movePointerId !== null) return; // one thumb per zone
        this.movePointerId = event.pointerId;
        this.movePointerDownX = event.clientX;
        break;
      case 'interact':
        if (this.interactPointerId !== null) return;
        this.interactPointerId = event.pointerId;
        this.state.interactPressed = true;
        break;
      case 'jump':
        if (this.jumpPointerId !== null) return;
        this.jumpPointerId = event.pointerId;
        this.beginJump();
        break;
    }
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.state.pointerX = event.clientX;
    this.state.pointerY = event.clientY;
    if (event.pointerId !== this.movePointerId) return;

    const dx = event.clientX - this.movePointerDownX;
    const touchAxis = Math.max(-1, Math.min(1, dx / MOVE_DRAG_PX));
    // Keyboard and touch both feed the same field; whichever last moved wins, which
    // in practice means "touch, unless a key is actually held" since keyboard updates
    // continuously on its own listeners rather than on this move handler.
    this.state.moveAxis = this.keyboardAxis !== 0 ? this.keyboardAxis : touchAxis;
    if (this.keyboardAxis === 0) this.touchAxis = touchAxis;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.movePointerId) {
      this.movePointerId = null;
      this.touchAxis = 0;
      if (this.keyboardAxis === 0) this.state.moveAxis = 0;
    }
    if (event.pointerId === this.jumpPointerId) {
      this.jumpPointerId = null;
      this.endJump();
    }
    if (event.pointerId === this.interactPointerId) {
      this.interactPointerId = null;
    }
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
      case 'ArrowLeft':
      case 'KeyA':
        this.keyboardAxis = -1;
        this.state.moveAxis = -1;
        event.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keyboardAxis = 1;
        this.state.moveAxis = 1;
        event.preventDefault();
        break;
      case 'KeyE':
      case 'KeyF':
      case 'Enter':
        this.state.interactPressed = true;
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
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      if (this.keyboardAxis === -1) this.keyboardAxis = 0;
      this.state.moveAxis = this.keyboardAxis !== 0 ? this.keyboardAxis : this.touchAxis;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      if (this.keyboardAxis === 1) this.keyboardAxis = 0;
      this.state.moveAxis = this.keyboardAxis !== 0 ? this.keyboardAxis : this.touchAxis;
    }
  };

  /** Losing focus mid-hold would otherwise leave the player jumping (or walking) forever. */
  private readonly onBlur = (): void => {
    this.movePointerId = null;
    this.jumpPointerId = null;
    this.interactPointerId = null;
    this.keyboardAxis = 0;
    this.touchAxis = 0;
    this.state.moveAxis = 0;
    this.endJump();
  };
}
