import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Repository tests spawn many short Git processes: on a busy machine they need room.
    testTimeout: 90_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // Three at a time: with four, the commands the tests spawn (Git, the hooks, the CLI)
    // sometimes miss their own short time limits on a loaded machine.
    maxWorkers: 3,
    // Messages for people are localised; the suite reads them in English, and never asks questions.
    // A test never reads or writes the person's own ~/.okb: the default home is a throwaway folder.
    // Days are the person's own (their time zone): the suite fixes one so a date in a test means the same everywhere.
    env: { TZ: 'UTC', OKB_HOME: resolve(tmpdir(), 'okb-vitest-home'), OKB_LANG: 'en', OKB_NO_INTERACTIVE: '1', NO_COLOR: '1', OKB_WEB_APPROVAL: 'off', CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '', OKB_VIA_CLAUDE: '' },
  },
});
