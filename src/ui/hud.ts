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
  furthestMetres: number;
  seedCode: string;
  isDaily: boolean;
  state: 'ready' | 'exploring';
  chimes: number;
  /** Currently active twist labels, shown persistently — a twist must be readable at a glance. */
  activeTwists: readonly string[];
  /** Non-empty only during the telegraph window ahead of a Shift landing. */
  telegraphLabels: readonly string[];
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

  builder.text('text', 'hud', left, top, `${model.distanceMetres} m`, 20, 'left', 600);
  builder.text(
    'textDim',
    'hud',
    left,
    top + 18,
    `FURTHEST ${model.furthestMetres} m`,
    12,
    'left',
    500,
  );
  builder.text(
    'textDim',
    'hud',
    left,
    top + 34,
    `${model.isDaily ? 'DAILY' : 'SEED'} ${model.seedCode}`,
    12,
    'left',
    500,
  );

  // Active twist(s), persistent for as long as they're in effect. The fairness contract
  // requires every twist be readable from the screen alone — this is that label.
  if (model.activeTwists.length > 0) {
    builder.text(
      'accent',
      'hud',
      left,
      top + 52,
      model.activeTwists.join(' + ').toUpperCase(),
      13,
      'left',
      700,
    );
  }

  if (model.chimes > 0) {
    builder.text('chime', 'hud', width / 2, top, `◈ ${model.chimes}`, 18, 'center', 600);
  }

  // The telegraph banner: the one advance warning a Shift gives before it lands.
  if (model.telegraphLabels.length > 0) {
    builder.text(
      'text',
      'hud',
      width / 2,
      top + 24,
      model.telegraphLabels.join(' + ').toUpperCase(),
      18,
      'center',
      700,
    );
  }

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
      'drag left to move · tap right to jump',
      14,
      'center',
    );
  }
}
