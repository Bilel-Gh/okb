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

describe('ask your brain (roadmap §8.1)', () => {
  it('finds the passages that answer a question, numbered as citations', async () => {
    const { passagesFor } = await import('../src/find/answer.js');
    const { config, bundle } = await kb();
    const r = passagesFor(config, bundle, 'que faire si un client ne paie pas');
    expect(r.passages.length).toBeGreaterThan(0);
    expect(r.passages[0]).toMatchObject({ n: 1, path: 'notes/n01.md', title: 'Relance des impayés' });
    expect(r.passages[0]!.text).toContain('relance');
  }, 60_000);

  it('writes an answer from the passages only, citing them, within the budget', async () => {
    const { composeAnswer, passagesFor } = await import('../src/find/answer.js');
    const { config, bundle } = await kb();
    const { passages } = passagesFor(config, bundle, 'comment on facture un client');
    const env = { ...process.env, OKB_AI: 'fake' };
    const r = await composeAnswer(config, 'comment on facture un client', passages, env);
    expect(r.answer).toContain('[fake]');
    expect(r.tokens).toBeGreaterThan(0);
    // The prompt carried the numbered passages.
    expect(r.answer).toContain('[1]');
  }, 60_000);

  it('never sends a 🔒 note to the AI', async () => {
    const { composeAnswer } = await import('../src/find/answer.js');
    const { config } = await kb();
    const passages = [{ n: 1, path: 'notes/secret.md', title: 'Secret', text: 'Le code du coffre est 1234.', line: 3, secret: true }];
    await expect(composeAnswer(config, 'quel est le code', passages, { ...process.env, OKB_AI: 'fake' })).rejects.toMatchObject({ key: 'askNothingToSend' });
  }, 60_000);
});

describe('passages read as text', () => {
  it('drops link targets and emphasis marks from a passage', async () => {
    const { passagesFor } = await import('../src/find/answer.js');
    const { writeFile } = await import('node:fs/promises');
    const { config } = await kb();
    await writeFile(resolve(config.kb.root, 'notes', 'n99.md'), '---\ntype: Guide\ntitle: Relance manuelle\ndescription: x\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\n---\n\n# Relance manuelle\n\nPour une **relance** manuelle, voir [la procédure](../procedures/relance.md) et `okb relance`.\n');
    const { passages } = passagesFor(config, await loadBundleFor(config), 'relance manuelle');
    const p = passages.find((x) => x.path === 'notes/n99.md')!;
    expect(p.text).toBe('Pour une relance manuelle, voir la procédure et okb relance.');
  }, 60_000);
});
