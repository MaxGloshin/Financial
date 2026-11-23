import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./web/src/test/setup.ts'],
    include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx'],
    globals: false,
    restoreMocks: true,
    testTimeout: 20_000,
  },
});
