import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: ['index.html', 'client.html', 'share.html'],
      onwarn(warning, warn) {
        // Mantine also ships React Server Component directives; this app is client-only.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"'))
          return;
        warn(warning);
      },
    },
  },
});
