import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Repository tests spawn many short Git processes: on a busy machine they need room.
    testTimeout: 90_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 4,
    // Messages for people are localised; the suite reads them in English, and never asks questions.
    env: { OKB_LANG: 'en', OKB_NO_INTERACTIVE: '1', NO_COLOR: '1', OKB_WEB_APPROVAL: 'off' },
  },
});
