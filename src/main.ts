/**
 * Bootstrap: resolve the seed, wire up the canvas, start the game.
 */

import { Viewport } from './core/viewport';
import { Game } from './game/game';
import { dailySeed, decodeSeed, randomSeed } from './core/rng';

function resolveOptions(): { seed: number; isDaily: boolean; showDiagnostics: boolean } {
  const params = new URLSearchParams(window.location.search);
  const showDiagnostics = params.has('debug');

  if (params.has('daily')) {
    return { seed: dailySeed(), isDaily: true, showDiagnostics };
  }

  const requested = params.get('seed');
  if (requested) {
    const decoded = decodeSeed(requested);
    // An out-of-range or malformed code falls back to a random run rather than
    // refusing to start.
    if (decoded !== null) return { seed: decoded, isDaily: false, showDiagnostics };
  }

  return { seed: randomSeed(), isDaily: false, showDiagnostics };
}

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas is missing');
}

new Game(new Viewport(canvas), resolveOptions()).start();
