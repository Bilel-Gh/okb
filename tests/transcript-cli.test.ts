import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSandbox, writeFixture, FIXTURE_SOURCES, type Sandbox } from './helpers/sandbox.js';
const exec = promisify(execFile);
const sandboxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(sandboxes.splice(0).map(s => s.cleanup())); });
async function cli(s: Sandbox, args: string[]) {
  const result = await exec(process.execPath, [resolve('dist/cli/index.js'), ...args, '--json'], { env: s.env });
  expect(result.stderr).toBe('');
  expect(Math.ceil(Buffer.byteLength(result.stdout) / 3.8)).toBeLessThanOrEqual(4000);
  return JSON.parse(result.stdout);
}
describe('bounded source reading CLI', () => {
  it('refuses a coverage budget that would return no range and an unchanged cursor', async () => {
    const s = await makeSandbox({ profileId: 'coverage-budget' }); sandboxes.push(s);
    const source = resolve(FIXTURE_SOURCES, 'weekly-sync.vtt');
    const page = await cli(s, ['ingest', source, '--extract-only', '--coverage']);
    const empty = { ...page, coverage: { ...page.coverage, unprocessedRanges: [], omittedRanges: 1, nextRangeCursor: '0' } };
    const budget = Math.ceil(Buffer.byteLength(JSON.stringify(empty, null, 2) + '\n') / 3.8);
    const profile = resolve(s.home, 'profiles', 'coverage-budget', 'profile.yaml');
    const config = YAML.parse(await readFile(profile, 'utf8'));
    config.context = { budgets: { ingestOutputTokens: budget } }; await writeFixture(profile, YAML.stringify(config));
    await expect(exec(process.execPath, [resolve('dist/cli/index.js'), 'ingest', source, '--extract-only', '--run', page.runId, '--coverage', '--json'], { env: s.env })).rejects.toMatchObject({ stdout: expect.stringContaining('E_CONFIG') });
  });
  it('keeps targeted search separate from delivered and processed meeting coverage', async () => {
    const s = await makeSandbox({ profileId: 'meeting-cli' }); sandboxes.push(s);
    const source = resolve(FIXTURE_SOURCES, 'weekly-sync.vtt');
    const query = await cli(s, ['ingest', source, '--extract-only', '--query', 'DRX']);
    expect(query.selection).toMatchObject({ mode: 'targeted', completeMeeting: false });
    expect(query.blocks.length).toBeGreaterThan(0);
    const base = ['ingest', source, '--extract-only', '--run', query.runId];
    expect((await cli(s, [...base, '--coverage'])).coverage).toMatchObject({ deliveredBlocks: 0, processedBlocks: 0, complete: false });
    const first = await cli(s, [...base, '--limit', '2']);
    expect(first.window.blocks).toBe(2);
    expect((await cli(s, [...base, '--coverage'])).coverage).toMatchObject({ deliveredBlocks: 2, processedBlocks: 0 });
    const result = resolve(s.dir, 'window-result.json');
    await writeFixture(result, JSON.stringify({ windowId: first.window.id, facts: [{ id: 'observed', kind: 'fact', text: 'The speaker introduced the topic.', evidence: [{ blockId: first.blocks[0].id, quote: first.blocks[0].text }] }] }));
    const recorded = await cli(s, [...base, '--window-result', result]);
    expect(recorded.coverage).toMatchObject({ processedBlocks: 2, complete: false });
    const report = await cli(s, [...base, '--meeting-report']);
    expect(report.facts).toHaveLength(1); expect(report.truncation.truncated).toBe(false);
    const repeated = await cli(s, [...base, '--window-result', result]);
    expect(repeated.coverage.processedBlocks).toBe(2);
  });
});
