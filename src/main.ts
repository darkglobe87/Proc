/**
 * Bootstrap: resolve the seed, wire up the canvas, start the game.
 */

import { Viewport } from './core/viewport';
import { Game } from './game/game';
import { dailySeed, decodeSeed, randomSeed } from './core/rng';

function resolveOptions(): {
  seed: number;
  isDaily: boolean;
  showDiagnostics: boolean;
  noHazards: boolean;
} {
  const params = new URLSearchParams(window.location.search);
  const showDiagnostics = params.has('debug');
  // Development aid: lets a long stretch of world be inspected without dodging. The twist
  // and render-style work in later milestones will want the same kind of switch.
  const noHazards = params.has('nohazards');

  if (params.has('daily')) {
    return { seed: dailySeed(), isDaily: true, showDiagnostics, noHazards };
  }

  const requested = params.get('seed');
  if (requested) {
    const decoded = decodeSeed(requested);
    // An out-of-range or malformed code falls back to a random run rather than
    // refusing to start.
    if (decoded !== null) return { seed: decoded, isDaily: false, showDiagnostics, noHazards };
  }

  return { seed: randomSeed(), isDaily: false, showDiagnostics, noHazards };
}

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas is missing');
}

new Game(new Viewport(canvas), resolveOptions()).start();
