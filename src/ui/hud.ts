/**
 * HUD.
 *
 * Emits text primitives on the `hud` layer rather than drawing directly, so it obeys
 * the active render style like everything else — the ASCII style will render the HUD
 * as ASCII without the HUD knowing that happened.
 */

import type { SceneBuilder } from '../render/scene';
import type { SafeAreaInsets } from '../core/viewport';

export interface HudModel {
  distanceMetres: number;
  bestMetres: number;
  seedCode: string;
  isDaily: boolean;
  state: 'ready' | 'running' | 'dead';
  flips: number;
  /** Diagnostics, shown only when enabled. */
  fps: number;
  frameMs: number;
  renderScale: number;
  showDiagnostics: boolean;
  landscape: boolean;
}

export function drawHud(
  builder: SceneBuilder,
  model: HudModel,
  width: number,
  height: number,
  insets: Readonly<SafeAreaInsets>,
): void {
  const left = 16 + insets.left;
  const top = 26 + insets.top;
  const right = width - 16 - insets.right;

  builder.text('text', 'hud', left, top, `${model.distanceMetres} m`, 24, 'left', 600);
  builder.text(
    'textDim',
    'hud',
    left,
    top + 20,
    `BEST ${model.bestMetres} m`,
    13,
    'left',
    500,
  );
  builder.text(
    'textDim',
    'hud',
    left,
    top + 38,
    `${model.isDaily ? 'DAILY' : 'SEED'} ${model.seedCode}`,
    13,
    'left',
    500,
  );

  if (model.showDiagnostics) {
    builder.text('textDim', 'hud', right, top, `${Math.round(model.fps)} fps`, 13, 'right');
    builder.text(
      'textDim',
      'hud',
      right,
      top + 18,
      `${model.frameMs.toFixed(1)} ms`,
      13,
      'right',
    );
    if (model.renderScale < 1) {
      builder.text(
        'textDim',
        'hud',
        right,
        top + 36,
        `scale ${model.renderScale.toFixed(2)}`,
        13,
        'right',
      );
    }
  }

  // Live trick counter, so a flip in progress reads as deliberate rather than a slip.
  if (model.flips > 0 && model.state === 'running') {
    builder.text(
      'accent',
      'hud',
      width / 2,
      height * 0.28,
      model.flips === 1 ? 'FLIP' : `${model.flips}× FLIP`,
      26,
      'center',
      700,
    );
  }

  if (!model.landscape) {
    builder.text(
      'text',
      'hud',
      width / 2,
      height * 0.5,
      'rotate to landscape',
      16,
      'center',
      600,
    );
    return;
  }

  if (model.state === 'ready') {
    builder.text('text', 'hud', width / 2, height * 0.5, 'MIRAGE', 40, 'center', 700);
    builder.text(
      'textDim',
      'hud',
      width / 2,
      height * 0.5 + 26,
      'tap to run · hold to flip · swipe down to dive',
      14,
      'center',
    );
  }

  if (model.state === 'dead') {
    builder.text('text', 'hud', width / 2, height * 0.46, `${model.distanceMetres} m`, 44, 'center', 700);
    builder.text(
      'textDim',
      'hud',
      width / 2,
      height * 0.46 + 26,
      model.distanceMetres >= model.bestMetres ? 'new best · tap to run again' : 'tap to run again',
      14,
      'center',
    );
  }
}
