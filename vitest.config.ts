import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['functions/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: { enabled: false },
  },
});

