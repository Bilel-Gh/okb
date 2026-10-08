import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { findNotes } from '../src/find/find.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { runSetup } from '../src/setup/setup.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const FIXTURE = resolve(TEST_ROOT, 'fixtures', 'reformulated');
const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function kb() {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-meaning-')));
  made.push(dir);
  await cp(resolve(FIXTURE, 'notes'), resolve(dir, 'kb', 'notes'), { recursive: true });
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'sens', HOME: dir };
  await runSetup({ profileId: 'sens', kbRoot: resolve(dir, 'kb'), conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Sens' }, { env });
  const { config } = await loadConfig({ env, profileId: 'sens' });
  return { config, bundle: await loadBundleFor(config) };
}

describe('finding a note by what it means, not only its words (roadmap §8.1)', () => {
  it('finds the right note in the top 3 for at least 90 % of reformulated questions', async () => {
    const { config, bundle } = await kb();
    const queries = JSON.parse(await readFile(resolve(FIXTURE, 'queries.json'), 'utf8')) as { q: string; expect: string }[];
    const misses: string[] = [];
    for (const { q, expect: path } of queries) {
      const top = findNotes(config, bundle, q, { limit: 3 }).hits.map((h) => h.path);
      if (!top.includes(path as never)) misses.push(`${q} → ${top.join(', ') || '∅'}`);
    }
    const rate = (queries.length - misses.length) / queries.length;
    console.log(`reformulated top-3: ${Math.round(rate * 100)} %`, misses);
    expect(rate).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('holds on questions written after the tuning (no fitting to the first set)', async () => {
    const { config, bundle } = await kb();
    const queries = JSON.parse(await readFile(resolve(FIXTURE, 'heldout.json'), 'utf8')) as { q: string; expect: string }[];
    const misses = queries.filter(({ q, expect: path }) => !findNotes(config, bundle, q, { limit: 3 }).hits.map((h) => h.path).includes(path as never));
    console.log(`held-out top-3: ${Math.round(((queries.length - misses.length) / queries.length) * 100)} %`, misses.map((m) => m.q));
    expect(misses.length / queries.length).toBeLessThanOrEqual(0.2);
  }, 60_000);
});
