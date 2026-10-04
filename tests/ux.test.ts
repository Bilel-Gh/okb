import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { loadConfig } from '../src/config/load.js';
import { checkOwnership, foreignNotes, kbFoldersIn, kbNames, listKbs, overlappingKb, readOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { saveProposal } from '../src/proposal/store.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { suggestIntent } from '../src/routing/intent.js';
import { readSettings, writeSetting } from '../src/settings/settings.js';
import { runWizard, defaultAnswers, wizardContext, checkFolder, okbVaults, suggestedRoot } from '../src/setup/wizard.js';
import { computeStatus, proposalSummaries, resolveProposalRef } from '../src/status/status.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(boxes.splice(0).map((s) => s.cleanup())); });
async function box(id = 'alpha') { const s = await makeSandbox({ profileId: id }); boxes.push(s); return s; }

const KBS = [{ id: 'atlas', name: 'Atlas' }, { id: 'ia', name: 'IA et second cerveau' }];

describe('natural-language offers', () => {
  const cases: [string, string | null, string?][] = [
    ['ok fin de session, merci', 'done'],
    ["Je m'arrête ici pour ce soir", 'done'],
    ["that's all for today", 'done'],
    ["lis ce transcript de la réunion d'hier", 'ingest'],
    ['Read this transcript and add it to my notes', 'ingest'],
    ['note ça : relancer Sam sur le budget', 'capture'],
    ['mets à jour mon focus : sprint Orion', 'focus'],
    ['on fait la revue de la semaine ?', 'weekly'],
    ['interroge-moi sur la fiche idempotence', 'learn'],
    ['transforme cette procédure en skill', 'skillify'],
    ["que dit ma kb atlas sur l'idempotence ?", 'ask', 'atlas'],
    ['corrige ce bug dans le parser', null],
    ["fais une capture d'écran de la page", null],
    ['/okb:done', null],
    ['prépare la weekly du sprint pour la PR', null],
  ];
  for (const [message, intent, kb] of cases) {
    it(`${intent ?? 'nothing'} ← "${message}"`, () => {
      const s = suggestIntent(message, { kbs: KBS, otherTools: [] });
      expect(s?.intent ?? null).toBe(intent);
      if (kb) expect(s?.kb).toBe(kb);
    });
  }

  it('leaves requests that name another knowledge tool alone, and asks when it could be either', () => {
    expect(suggestIntent('cherche dans support-kb le ticket 42', { kbs: KBS, otherTools: ['support-kb'] })).toBeNull();
    const generic = suggestIntent('cherche dans ma kb le mot idempotence', { kbs: KBS, otherTools: ['support-kb'] });
    expect(generic).toMatchObject({ intent: 'ask', mode: 'ask-which' });
    const named = suggestIntent('cherche dans la KB support le ticket 42', { kbs: KBS, otherTools: [] });
    expect(named).toMatchObject({ mode: 'ask-which', otherTools: ['support'] });
    // A task only OKB does is offered even when other tools exist.
    expect(suggestIntent('ok fin de session', { kbs: KBS, otherTools: ['support-kb'] })).toMatchObject({ intent: 'done', mode: 'offer' });
  });
});

describe('settings', () => {
  it('changes one value, keeps the comments of the profile, refuses invalid values', async () => {
    const s = await box();
    const path = resolve(s.home, 'profiles', 'alpha', 'profile.yaml');
    await writeFile(path, `# ma note perso\n${await readFile(path, 'utf8')}`);
    await writeSetting('alpha', 'writing.preset', 'expert', s.env);
    await writeSetting('alpha', 'routing.otherKnowledgeTools', 'support-kb, wiki', s.env);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('# ma note perso');
    const values = Object.fromEntries((await readSettings('alpha', s.env)).map((v) => [v.def.key, v.value]));
    expect(values['writing.preset']).toBe('expert');
    expect(values['routing.otherKnowledgeTools']).toEqual(['support-kb', 'wiki']);
    await expect(writeSetting('alpha', 'writing.preset', 'baroque', s.env)).rejects.toMatchObject({ code: 'E_INVALID', key: 'settingBadValue' });
    await expect(writeSetting('alpha', 'nope', 'x', s.env)).rejects.toMatchObject({ key: 'settingUnknown' });
    await writeSetting('alpha', 'ui.language', 'fr', s.env);
    expect(await readFile(resolve(s.home, 'config.yaml'), 'utf8')).toContain('language: fr');
  });
});

describe('ownership: OKB writes only in its own folder', () => {
  it('marks the folder at setup and refuses a folder owned by another KB', async () => {
    const s = await box();
    const config = (await loadConfig({ env: s.env, profileId: 'alpha' })).config;
    expect(await readOwner(config.kb.root)).toBe('alpha');
    const other = { ...config, profile: { ...config.profile, id: 'beta' } };
    expect(await checkOwnership(other)).toMatchObject({ state: 'other', owner: 'alpha' });
  });

  it('refuses to apply into a folder holding another tool’s notes until it is adopted', async () => {
    const s = await box();
    const foreign = resolve(s.dir, 'support-kb');
    await writeFixture(resolve(foreign, 'tickets', 't-42.md'), '# Ticket 42\n\nNotes of the support agent.\n');
    const base = (await loadConfig({ env: s.env, profileId: 'alpha' })).config;
    const config = { ...base, kb: { ...base.kb, root: foreign } };
    expect(await foreignNotes(foreign)).toEqual(['tickets/t-42.md']);
    const bundle = await loadBundleFor(config);
    const proposal = proposeFiles(config, bundle, new Map([['okb.md', '---\ntype: Guide\ntitle: X\n---\n\n# X\n']]), 'test');
    await saveProposal(config, proposal);
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:test');
    await expect(applyProposal(config, proposal)).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH', key: 'kbForeign' });
    expect(await readOwner(foreign)).toBeNull();
  });

  it('never lets two KBs share or nest folders', async () => {
    const s = await box();
    expect((await overlappingKb(resolve(s.vault, 'sub'), null, s.env))?.id).toBe('alpha');
    expect(await overlappingKb(resolve(s.dir, 'elsewhere'), null, s.env)).toBeNull();
    expect(kbNames('Atlas Pilotage')).toEqual({ id: 'atlas-pilotage', folder: 'kb-atlas-pilotage', display: 'Atlas Pilotage' });
  });
});

describe('setup wizard model', () => {
  it('creates a working KB from answers, without Git, plugin or launcher when not asked', async () => {
    const s = await box();
    const ctx = await wizardContext(s.env, { github: false });
    const root = resolve(s.dir, 'vault2', 'kb-notes-perso');
    const answers = { ...defaultAnswers(ctx, 'Notes perso', 'fr'), root, git: false, plugin: false, launcher: null, focus: 'create' as const };
    const steps: string[] = [];
    const created = await runWizard(answers, (r) => steps.push(`${r.step}:${r.ok}`), s.env);
    expect(created.id).toBe('notes-perso');
    expect(steps).toEqual(expect.arrayContaining(['language:true', 'folder:true', 'profile:true', 'focus:true', 'activate:true']));
    expect(await readOwner(root)).toBe('notes-perso');
    const kbs = await listKbs(s.env);
    expect(kbs.find((k) => k.id === 'notes-perso')).toMatchObject({ active: true, name: 'Notes perso', writingLanguage: 'fr', owner: 'this' });
    expect(await readFile(resolve(s.dir, 'vault2', '01 Focus.md'), 'utf8')).toContain('Focus du moment');
    expect((await checkFolder(root, 'notes-perso', s.env)).state).toBe('okb');
    expect((await checkFolder(root, 'other', s.env)).state).toBe('overlap');
    await expect(runWizard({ ...answers, name: 'Notes perso' }, () => undefined, s.env)).resolves.toBeDefined();
  });

  it('never suggests a vault OKB has no KB in, nor a folder merely named kb-…', async () => {
    const s = await box();
    const base = await wizardContext(s.env, { github: false });
    await writeFixture(resolve(s.dir, 'shared', 'kb-support', 'faq.md'), '# FAQ\n');
    const ctx = { ...base, kbs: [], vaults: [{ path: resolve(s.dir, 'shared'), open: true, kbs: await kbFoldersIn(resolve(s.dir, 'shared')) }] };
    expect(ctx.vaults[0]!.kbs).toEqual([]);
    expect(okbVaults(ctx)).toEqual([]);
    expect(suggestedRoot(ctx, 'Notes', 'en')).not.toContain(resolve(s.dir, 'shared'));
    const mine = { ...ctx, vaults: [{ ...ctx.vaults[0]!, kbs: ['kb-reader'] }] };
    expect(suggestedRoot(mine, 'Notes', 'en')).toBe(resolve(s.dir, 'shared', 'kb-notes'));
  });

  it('refuses a foreign folder unless adoption is explicit', async () => {
    const s = await box();
    const ctx = await wizardContext(s.env, { github: false });
    const root = resolve(s.dir, 'theirs');
    await writeFixture(resolve(root, 'faq.md'), '# FAQ\n');
    const answers = { ...defaultAnswers(ctx, 'Support', 'en'), root, git: false, plugin: false, launcher: null };
    await expect(runWizard(answers, () => undefined, s.env)).rejects.toMatchObject({ key: 'kbForeign' });
    await expect(runWizard({ ...answers, adopt: true }, () => undefined, s.env)).resolves.toMatchObject({ id: 'support' });
  });
});

describe('status and proposal numbers', () => {
  it('numbers pending proposals newest first and resolves numbers and prefixes', async () => {
    const s = await box();
    const config = await s.config();
    const bundle = await loadBundleFor(config);
    const first = proposeFiles(config, bundle, new Map([['a.md', '---\ntype: Guide\ntitle: "Première"\n---\n\n# A\n']]), 'first');
    await saveProposal(config, first);
    await new Promise((r) => setTimeout(r, 15));
    const second = proposeFiles(config, bundle, new Map([['b.md', '---\ntype: Guide\ntitle: "Seconde"\n---\n\n# B\n']]), 'second');
    await saveProposal(config, second);
    const list = await proposalSummaries(config);
    expect(list.map((p) => [p.number, p.title])).toEqual([[1, 'Seconde'], [2, 'Première']]);
    expect((await resolveProposalRef(config, '2')).id).toBe(first.id);
    expect((await resolveProposalRef(config, first.id.slice(2, 10))).id).toBe(first.id);
    await expect(resolveProposalRef(config, '9')).rejects.toMatchObject({ key: 'proposalNumberUnknown' });
    const status = await computeStatus(config, { light: true });
    expect(status.pending).toHaveLength(2);
    expect(status.owned).toBe(true);
    await mkdir(resolve(s.dir, 'x'), { recursive: true });
  });
});
