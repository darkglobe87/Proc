import { describe, expect, it } from 'vitest';
import { screenToWorld } from '../src/render/renderer';
import type { CameraView } from '../src/render/scene';

const WIDTH = 800;
const HEIGHT = 380;

function camera(overrides: Partial<CameraView> = {}): CameraView {
  return { x: 5000, y: -120, zoom: 1, rotation: 0, mirrorX: false, ...overrides };
}

describe('screenToWorld', () => {
  /**
   * Regression test for a real reported bug: "the screen splits weirdly when Mirror
   * starts." Mirroring was originally folded into the world-space camera transform,
   * which is anchored off-centre (`ANCHOR_X` = 32%, not 50%, so the runner has room
   * ahead to see what's coming). Mirroring around an off-centre point doesn't just
   * flip the view — it *shifts* it sideways, so the world range that exactly covered
   * the screen when drawn normally lands mostly off to one side once mirrored, and
   * the screen's other edge is left with nothing drawn on it at all.
   *
   * The fix moved mirroring to a whole-frame post-process around the viewport centre,
   * which has one clean, checkable consequence: whatever world point appears at
   * screen x when unmirrored must appear at screen (width - x) when mirrored — a pure
   * left-right flip of the visible range, with nothing shifted and nothing lost.
   */
  it('mirroring reflects the visible world range around the screen centre, with no shift', () => {
    for (const zoom of [1, 0.6, 1.8]) {
      const cam = camera({ zoom });
      for (const sx of [0, 137, WIDTH / 2, WIDTH - 1, WIDTH]) {
        const unmirroredHere = screenToWorld(cam, WIDTH, HEIGHT, sx, HEIGHT / 2);
        const mirroredThere = screenToWorld(
          camera({ zoom, mirrorX: true }),
          WIDTH,
          HEIGHT,
          WIDTH - sx,
          HEIGHT / 2,
        );
        expect(mirroredThere.x, `zoom=${zoom} sx=${sx}`).toBeCloseTo(unmirroredHere.x, 6);
      }
    }
  });

  it('mirroring does not change the total world-x span visible across the screen', () => {
    // The span (world-x at the right edge minus world-x at the left edge) is what
    // determines how much of the world is on screen. The old bug changed this span's
    // effective position without changing its size, which is exactly why it looked
    // like a correct amount of world had simply been shoved off one edge.
    const plain = camera();
    const mirrored = camera({ mirrorX: true });

    const spanOf = (cam: CameraView): number => {
      const left = screenToWorld(cam, WIDTH, HEIGHT, 0, HEIGHT / 2).x;
      const right = screenToWorld(cam, WIDTH, HEIGHT, WIDTH, HEIGHT / 2).x;
      return Math.abs(right - left);
    };

    expect(spanOf(mirrored)).toBeCloseTo(spanOf(plain), 6);
    expect(spanOf(plain)).toBeCloseTo(WIDTH / plain.zoom, 6);
  });

  it('is the identity when nothing is active', () => {
    const cam = camera();
    // Screen anchor (ANCHOR_X, ANCHOR_Y — see game/camera.ts) must map back to the
    // camera position when there is no rotation or mirror to displace it.
    const anchorScreenX = WIDTH * 0.32;
    const anchorScreenY = HEIGHT * 0.58;
    const result = screenToWorld(cam, WIDTH, HEIGHT, anchorScreenX, anchorScreenY);
    expect(result.x).toBeCloseTo(cam.x, 6);
    expect(result.y).toBeCloseTo(cam.y, 6);
  });

  it('scales screen distance by zoom', () => {
    const near = screenToWorld(camera({ zoom: 2 }), WIDTH, HEIGHT, 0, HEIGHT / 2);
    const far = screenToWorld(camera({ zoom: 0.5 }), WIDTH, HEIGHT, 0, HEIGHT / 2);
    // Lower zoom shows more world per screen pixel, so the same screen edge reaches
    // further from the camera in world space.
    const cam = camera();
    expect(Math.abs(far.x - cam.x)).toBeGreaterThan(Math.abs(near.x - cam.x));
  });
});
