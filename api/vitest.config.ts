import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    globalSetup: ['./src/__tests__/global-setup.ts'],
    setupFiles: ['./src/__tests__/setup-env.ts'],
  },
});
