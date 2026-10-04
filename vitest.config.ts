import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    // Messages for people are localised; the suite reads them in English, and never asks questions.
    env: { OKB_LANG: 'en', OKB_NO_INTERACTIVE: '1', NO_COLOR: '1' },
  },
});
