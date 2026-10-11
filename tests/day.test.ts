import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_ROOT } from './helpers/sandbox.js';

describe('a day is the person’s own day', () => {
  it('a line written at half past one in the morning in Paris belongs to that day, not to the day before', () => {
    const script = `import { localDay } from ${JSON.stringify(resolve(TEST_ROOT, '..', 'dist', 'util', 'day.js'))}; console.log(localDay(new Date('2026-10-10T23:30:00Z')));`;
    const run = (TZ: string) => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }).trim();
    expect(run('Europe/Paris')).toBe('2026-10-11');
    expect(run('America/Los_Angeles')).toBe('2026-10-10');
    expect(run('UTC')).toBe('2026-10-10');
  });
});
