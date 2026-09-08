import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export default defineConfig({
  testDir: './test',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3211',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
      args: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: [
    { command: 'npx peerjs --port 9001 --path /room', port: 9001, reuseExistingServer: false },
    {
      command: 'npx vite --host 127.0.0.1 --port 3211 --strictPort',
      port: 3211,
      env: { VITE_PEER_PORT: '9001' },
      reuseExistingServer: false,
    },
  ],
});
