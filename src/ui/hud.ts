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
  chimes: number;
  bestChimes: number;
  score: number;
  /** Current multiplier, 1..MAX_FLOW. */
  flow: number;
  /** 0..1 through the idle grace period; 1 means it is about to bleed away. */
  flowIdle: number;
  grinding: boolean;
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

  // Active twist(s), persistent for as long as they're in effect. The fairness contract
  // requires every twist be readable from the screen alone — this is that label.
  if (model.activeTwists.length > 0) {
    builder.text(
      'accent',
      'hud',
      left,
      top + 58,
      model.activeTwists.join(' + ').toUpperCase(),
      13,
      'left',
      700,
    );
  }

  // Chimes and multiplier, centred at the top — the pair the player watches while chaining.
  builder.text('chime', 'hud', width / 2, top, `◈ ${model.chimes}`, 20, 'center', 600);
  if (model.score > 0) {
    builder.text('textDim', 'hud', width / 2, top + 18, `${model.score}`, 13, 'center');
  }

  if (model.flow > 1.05) {
    const y = top + 42;
    builder.text('accent', 'hud', width / 2, y, `×${model.flow.toFixed(1)}`, 22, 'center', 700);

    // Decay bar: drains as the idle grace runs out, so the player can see the chain
    // slipping before it actually starts costing them.
    const barWidth = 74;
    const remaining = 1 - model.flowIdle;
    builder.polyline('textDim', 'hud', 3, 0.3);
    builder.point(width / 2 - barWidth / 2, y + 10);
    builder.point(width / 2 + barWidth / 2, y + 10);
    builder.end();
    if (remaining > 0) {
      builder.polyline('accent', 'hud', 3, 0.9);
      builder.point(width / 2 - barWidth / 2, y + 10);
      builder.point(width / 2 - barWidth / 2 + barWidth * remaining, y + 10);
      builder.end();
    }
  }

  if (model.grinding) {
    builder.text('accent', 'hud', width / 2, height * 0.36, 'GRIND', 20, 'center', 700);
  }

  // The telegraph banner: the one advance warning a Shift gives before it lands.
  if (model.telegraphLabels.length > 0) {
    builder.text(
      'text',
      'hud',
      width / 2,
      top + 78,
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
    builder.text('text', 'hud', width / 2, height * 0.42, `${model.distanceMetres} m`, 44, 'center', 700);
    builder.text(
      'chime',
      'hud',
      width / 2,
      height * 0.42 + 26,
      `◈ ${model.chimes}   ·   ${model.score} pts`,
      15,
      'center',
      600,
    );
    builder.text(
      'textDim',
      'hud',
      width / 2,
      height * 0.42 + 50,
      model.distanceMetres >= model.bestMetres ? 'new best · tap to run again' : 'tap to run again',
      14,
      'center',
    );
  }
}
