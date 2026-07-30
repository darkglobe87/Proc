import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.darkglobe87.mirage',
  appName: 'Mirage',
  webDir: 'dist',
  // Matches the sky at the top of the gradient, so the split-second before the
  // canvas paints does not flash white.
  backgroundColor: '#0b1026',
  android: {
    allowMixedContent: false,
    // Crisp nearest-neighbour upscaling in the pixel render style depends on the
    // WebView not applying its own smoothing on top.
    webContentsDebuggingEnabled: true,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
