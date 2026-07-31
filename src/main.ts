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
  fastShift: boolean;
} {
  const params = new URLSearchParams(window.location.search);
  const showDiagnostics = params.has('debug');
  // Development aid: Shifts normally land every 35-45s, which is fine to play but far too
  // slow to iterate against — this compresses the interval to a few seconds so every
  // twist can be seen without waiting a run out for real.
  const fastShift = params.has('fastshift');

  if (params.has('daily')) {
    return { seed: dailySeed(), isDaily: true, showDiagnostics, fastShift };
  }

  const requested = params.get('seed');
  if (requested) {
    const decoded = decodeSeed(requested);
    // An out-of-range or malformed code falls back to a random run rather than
    // refusing to start.
    if (decoded !== null) {
      return { seed: decoded, isDaily: false, showDiagnostics, fastShift };
    }
  }

  return { seed: randomSeed(), isDaily: false, showDiagnostics, fastShift };
}

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas is missing');
}

new Game(new Viewport(canvas), resolveOptions()).start();
