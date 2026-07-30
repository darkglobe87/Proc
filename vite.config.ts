import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths — the Capacitor WebView serves from a scheme where
  // absolute "/assets/..." URLs do not resolve.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 8192,
    // The game is one bundle; no route-splitting to gain from.
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
