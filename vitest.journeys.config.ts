import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The journeys (F2.0-20): the built app in a real browser, screen by screen,
 * as a person uses it. Run with `npm run test:journeys`; they need a Chromium
 * (Playwright's, or the Chrome or Edge of the machine) and are not part of
 * `npm run check`, which stays runnable anywhere.
 */
export default defineConfig({
  test: {
    include: ['tests/journeys/**/*.journey.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 1,
    // The person's words: the journeys read the app in French, in a fixed time zone.
    env: { TZ: 'UTC', OKB_HOME: resolve(tmpdir(), 'okb-vitest-home'), OKB_LANG: 'fr', OKB_NO_INTERACTIVE: '1', NO_COLOR: '1', OKB_WEB_APPROVAL: 'off', OKB_NO_OPEN: '1', CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '', OKB_VIA_CLAUDE: '' },
  },
});
