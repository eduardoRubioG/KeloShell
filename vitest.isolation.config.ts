import { defineConfig } from 'vitest/config';

// The Supabase isolation suite. It needs the local stack (`npx supabase
// start`), so `npm test` (vitest.config.ts) never includes it.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    globalSetup: ['supabase/tests/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: { enabled: false },
  },
});
