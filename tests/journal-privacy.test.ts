import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { loadConfig } from '../src/config/load.js';
import { findNotes } from '../src/find/find.js';
import { journal } from '../src/journal/journal.js';
import { metrics } from '../src/metrics/metrics.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { gradeCard } from '../src/learn/learn.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { isUnlocked, personalData, proposeConfidentiality, secretNotes, unlockFromPrompt } from '../src/security/confidential.js';
import { runSetup } from '../src/setup/setup.js';
import { ensureState, statePaths } from '../src/state/paths.js';
import { asBundlePath } from '../src/util/paths.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

const note = (title: string, body: string, extra = '') => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title} en une phrase.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\n${extra}---\n\n# ${title}\n\n${body}\n`;

async function brain(extra: Record<string, string> = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-priv-')));
  made.push(dir);
  const kb = resolve(dir, 'kb');
  await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 2, repos: 2, tickets: 4, meetings: 2, concepts: 4 }));
  for (const [p, c] of Object.entries(extra)) { await mkdir(resolve(kb, p, '..'), { recursive: true }); await writeFile(resolve(kb, p), c); }
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  await ensureState(statePaths(config));
  return { dir, env, kb, config, bundle: await loadBundleFor(config) };
}

const SECRET = note('Retour du manager', 'Un retour sur le projet export.', 'x_okb:\n  confidentiality: secret\n');

describe('confidential notes', () => {
  it('leave a search Claude runs, and open only when the person names them', async () => {
    const { env, kb, config, bundle } = await brain({ '4 Activité/Carrière/Retours/2026-10-01 Retour du manager.md': SECRET });
    expect(secretNotes(bundle).map((n) => n.title)).toEqual(['Retour du manager']);
    expect(findNotes(config, bundle, 'retour manager').hits.map((h) => h.title)).toContain('Retour du manager');
    const forClaude = findNotes(config, bundle, 'retour manager', { hideSecret: true });
    expect(forClaude.hits.map((h) => h.title)).not.toContain('Retour du manager');
    expect(forClaude.hidden).toBe(1);
    const abs = resolve(kb, '4 Activité/Carrière/Retours/2026-10-01 Retour du manager.md');
    expect(await unlockFromPrompt('lis-moi une note sur les exports', [config], env)).toEqual([]);
    expect(await unlockFromPrompt('Ouvre mon « retour du manager » et résume-le', [config], env)).toEqual([abs]);
    expect(await isUnlocked(abs, env)).toBe(true);
    expect(await isUnlocked(abs, env, new Date(Date.now() + 31 * 60_000))).toBe(false);
  }, 60_000);

  it('is set through a proposal the person approves', async () => {
    const { config } = await brain();
    const proposal = await proposeConfidentiality(config, '1 Écosystème/Écosystème.md', 'secret');
    expect(proposal.changes[0]).toMatchObject({ kind: 'patch-frontmatter', patchFrontmatter: { patch: { x_okb: { confidentiality: 'secret' } } } });
    await expect(proposeConfidentiality(config, '1 Écosystème/Écosystème.md', 'normal')).rejects.toMatchObject({ key: 'secretSame' });
  }, 60_000);
});

describe('personal data', () => {
  it('is found in what a proposal writes and flagged for the reviewer, not refused', async () => {
    expect(personalData('Écrire à jeanne.martin@entreprise.fr ou au 06 12 34 56 78.\nIBAN FR76 3000 6000 0112 3456 7890 189.\nCarte 4111 1111 1111 1111.\nadresse@example.com').map((f) => f.kind)).toEqual(['email', 'phone', 'iban', 'card']);
    expect(personalData('Rien ici : 2026-10-07, version 1.0.0, port 4399.')).toEqual([]);
    const { config, bundle } = await brain();
    const p = proposeFiles(config, bundle, new Map([[asBundlePath('3 Boîte à outils/Contacts.md'), note('Contacts', 'Le référent : jeanne.martin@entreprise.fr')]]), 'test');
    await saveProposal(config, p);
    const saved = await loadProposal(config, p.id);
    expect(saved.notes.some((n) => n.startsWith('⚠️ personal data in 3 Boîte à outils/Contacts.md: email'))).toBe(true);
  }, 60_000);
});

describe('the journal', () => {
  it('tells what happened day by day: notes applied, cards reviewed', async () => {
    const { config, bundle } = await brain();
    const p = proposeFiles(config, bundle, new Map([[asBundlePath('3 Boîte à outils/Méthodes/Lire un log.md'), note('Lire un log', 'Commencer par la fin.')]]), 'test');
    await saveProposal(config, p);
    const saved = await loadProposal(config, p.id);
    await grantApproval(config, saved, saved.changes.map((c) => c.id), 'human:test');
    await applyProposal(config, saved);
    await gradeCard(config, 'c-abc', 3);
    const j = await journal(config, await loadBundleFor(config), { days: 2 });
    const today = j.days[0]!;
    expect(today.created.map((n) => n.title)).toContain('Lire un log');
    expect(today.reviews).toBe(1);
    expect(j.totals.created).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('the 1.0 criteria, measured', () => {
  it('reports control, filing, search, speed, cost and robustness on the brain', async () => {
    const { config, bundle, env } = await brain();
    const m = await metrics(config, bundle, { sample: 40, env });
    const by = new Map(m.metrics.map((x) => [x.id, x]));
    expect([...by.keys()]).toEqual(expect.arrayContaining(['control', 'filing', 'robustness', 'search', 'speed', 'gaps', 'quality', 'cost', 'discretion', 'use']));
    expect(by.get('control')?.verdict).toBe('ok');
    expect(by.get('filing')?.params?.percent).toBe(100);
    expect(Number(by.get('search')?.params?.percent)).toBeGreaterThanOrEqual(90);
    expect(Number(by.get('speed')?.params?.p95)).toBeLessThan(50);
    expect(Number(by.get('cost')?.params?.tokens)).toBeLessThanOrEqual(800);
  }, 60_000);
});
