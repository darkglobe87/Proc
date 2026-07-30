/**
 * Canvas sizing, device-pixel-ratio handling and the render-scale throttle.
 *
 * All drawing happens in *logical* pixels: the context is pre-scaled, so game and
 * render code never thinks about DPR. Two caps keep a high-density phone from
 * shading four times the pixels it needs to:
 *
 *  - DPR is capped, because past ~2x the difference is invisible at arm's length.
 *  - Total backing width is capped, so a 1440p phone renders at 1080p and upscales.
 *
 * {@link Viewport.renderScale} lowers resolution further when frames get
 * expensive; it is the lever the performance watchdog pulls.
 */

const MAX_DPR = 2;
const MAX_BACKING_WIDTH = 1080;

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export class Viewport {
  readonly ctx: CanvasRenderingContext2D;

  /** Logical size in CSS pixels — the coordinate space all drawing uses. */
  width = 0;
  height = 0;

  /** Backing-store pixels per logical pixel, after all caps. */
  scale = 1;

  private quality = 1;
  private insets: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly probe: HTMLElement | null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', {
      alpha: false,
      // We repaint every pixel each frame, so the driver need not preserve the
      // previous buffer — a measurable win in a WebView.
      desynchronized: true,
    });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;

    this.probe = document.getElementById('safe-area-probe');

    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    this.resize();
  }

  /**
   * Resolution multiplier in (0, 1]. Lower values trade sharpness for frame rate.
   */
  get renderScale(): number {
    return this.quality;
  }

  set renderScale(value: number) {
    const clamped = Math.min(1, Math.max(0.4, value));
    if (Math.abs(clamped - this.quality) < 0.01) return;
    this.quality = clamped;
    this.resize();
  }

  /** Insets to keep HUD elements clear of notches and gesture bars. */
  get safeArea(): Readonly<SafeAreaInsets> {
    return this.insets;
  }

  /** True in the orientation the game is designed for. */
  get isLandscape(): boolean {
    return this.width >= this.height;
  }

  readonly resize = (): void => {
    const cssWidth = Math.max(1, window.innerWidth);
    const cssHeight = Math.max(1, window.innerHeight);

    this.width = cssWidth;
    this.height = cssHeight;

    const dprCap = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const widthCap = MAX_BACKING_WIDTH / cssWidth;
    this.scale = Math.max(0.5, Math.min(dprCap, widthCap) * this.quality);

    const backingWidth = Math.round(cssWidth * this.scale);
    const backingHeight = Math.round(cssHeight * this.scale);

    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Resizing resets context state, so the transform is reapplied here.
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    this.readInsets();
  };

  private readInsets(): void {
    if (!this.probe) return;
    const style = getComputedStyle(this.probe);
    this.insets = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
  }
}
