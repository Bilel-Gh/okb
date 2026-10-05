import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { buildConversion, scanConversion, slugFile, writePlanSkeleton } from '../src/kb/convert.js';
import { writeOwner } from '../src/kb/registry.js';
import { maintain } from '../src/maintain/maintain.js';
import { saveProposal } from '../src/proposal/store.js';
import { suggestIntent } from '../src/routing/intent.js';
import { archiveKb, listKbs } from '../src/kb/registry.js';
import { connectKb } from '../src/setup/connect.js';
import { installKind, updateProduct } from '../src/integrations/system.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(sandboxes.splice(0).map((s) => s.cleanup())); });

/** A KB folder written by hand before OKB: no front matter, Obsidian links, spaces in names. */
async function legacyKb() {
  const s = await makeSandbox({ profileId: 'old' }, { copyVault: false });
  sandboxes.push(s);
  await mkdir(resolve(s.vault, 'cours'), { recursive: true });
  await writeFile(resolve(s.vault, 'cours', 'Les bots.md'), '# RPA : les bots\n\nUn bot automatise une tâche. Voir [[Orchestrateur]].\n');
  await writeFile(resolve(s.vault, 'Orchestrateur.md'), '---\ntags: [rpa]\nauteur: moi\n---\n# Orchestrateur\n\nIl pilote les [[RPA : les bots|bots]] et la [[Note absente]].\n');
  await writeFile(resolve(s.vault, 'Journal.md'), '# Journal\n\nNotes du jour.\n');
  // What `okb kb add` does: the person hands this folder to OKB.
  await writeOwner(s.vault, 'old');
  return { s, config: await s.config() };
}

describe('converting a KB written before OKB', () => {
  it('says what each note lacks and writes a plan to complete', async () => {
    const { config } = await legacyKb();
    const scan = await scanConversion(config);
    expect(scan.legacy).toBe(3);
    expect(scan.wikilinks).toBe(3);
    const bots = scan.page.find((n) => n.path === 'cours/Les bots.md')!;
    expect(bots).toMatchObject({ hasFrontmatter: false, title: 'RPA : les bots', wikilinks: 1 });
    expect(bots.missing).toEqual(['type', 'title', 'description', 'status', 'generated']);
    expect(bots.excerpt).toContain('Un bot automatise une tâche. Voir Orchestrateur.');
    const plan = await writePlanSkeleton(config);
    expect(plan).toMatchObject({ notes: 3, existed: false });
    expect(JSON.parse(await readFile(plan.path, 'utf8')).notes.find((n: { path: string }) => n.path === 'Journal.md')).toMatchObject({ template: '', description: '' });
    expect((await writePlanSkeleton(config)).existed).toBe(true);
  });

  it('turns a completed plan into one proposal: front matter, portable links, notes filed, nothing lost', async () => {
    const { s, config } = await legacyKb();
    const plan = {
      version: 1,
      notes: [
        { path: 'cours/Les bots.md', template: 'concept', title: 'Bot RPA', description: 'Un bot automatise une tâche répétitive à la place d’une personne.', tags: ['rpa'] },
        { path: 'Orchestrateur.md', template: 'concept', title: 'Orchestrateur', description: 'L’orchestrateur planifie et pilote les bots RPA.' },
        { path: 'Journal.md', keep: true },
      ],
    };
    const result = await buildConversion(config, plan);
    expect(result).toMatchObject({ converted: 2, kept: 1, linksRewritten: 2 });
    expect(result.moved).toEqual([{ from: 'cours/Les bots.md', to: 'concepts/les-bots.md' }, { from: 'Orchestrateur.md', to: 'concepts/orchestrateur.md' }]);
    expect(result.manualLinks.map((m) => m.url)).toEqual(['[[Note absente]]']);

    // Nothing written before approval.
    expect(await readFile(resolve(s.vault, 'Orchestrateur.md'), 'utf8')).toContain('[[RPA : les bots|bots]]');
    await saveProposal(config, result.proposal);
    await grantApproval(config, result.proposal, result.proposal.changes.map((c) => c.id), 'human:me');
    await applyProposal(config, result.proposal);

    const bots = await readFile(resolve(s.vault, 'concepts', 'les-bots.md'), 'utf8');
    expect(bots).toMatch(/^---\ntype: Concept\ntitle: Bot RPA\ndescription: Un bot automatise/);
    expect(bots).toContain('generated:\n  by: human:testuser');
    expect(bots).toContain('Un bot automatise une tâche. Voir [Orchestrateur](orchestrateur.md).');
    const orch = await readFile(resolve(s.vault, 'concepts', 'orchestrateur.md'), 'utf8');
    // Fields already there are kept, tags merged, the body untouched but for its links.
    expect(orch).toContain('auteur: moi');
    expect(orch).toContain('tags:\n  - rpa');
    expect(orch).toContain('Il pilote les [bots](les-bots.md) et la [[Note absente]].');
    expect(await readFile(resolve(s.vault, 'Journal.md'), 'utf8')).toBe('# Journal\n\nNotes du jour.\n');

    const report = await maintain(config);
    const missing = report.issues.filter((i) => i.code === 'PROD_MISSING_FIELD' && i.file.startsWith('concepts/'));
    expect(missing).toEqual([]);
  });

  it('refuses an incomplete plan, naming each problem', async () => {
    const { config } = await legacyKb();
    await expect(buildConversion(config, { version: 1, notes: [{ path: 'Orchestrateur.md', template: 'concept', title: 'Orchestrateur', description: 'court' }] })).rejects.toThrow(/problem/);
    await expect(buildConversion(config, { version: 1, notes: [{ path: 'Nulle part.md', template: 'concept', title: 'x', description: 'Une description assez longue.' }] })).rejects.toThrow(/problem/);
    await expect(buildConversion(config, { version: 1, notes: [{ path: 'Orchestrateur.md', template: 'concept', title: 'O', description: 'Une description assez longue.', folder: '../dehors' }] })).rejects.toThrow(/invalid conversion plan/);
    expect(slugFile('Les bots RPA.md')).toBe('les-bots-rpa.md');
  });

  it('offers the conversion from plain words', () => {
    const none = { kbs: [], otherTools: [] };
    for (const m of ['convertis cette KB au format OKB', 'je veux importer mon ancien vault dans okb', 'ajoute ma vieille KB à okb', 'convert my old vault to okb']) {
      expect(suggestIntent(m, none)?.command, m).toBe('/okb:convert');
    }
    expect(suggestIntent('convertis ce pdf en texte', none)).toBeNull();
  });

  it('connects a folder under the chosen name, writes no note, and removes it without touching the notes', async () => {
    const { s: sb } = await legacyKb();
    const folder = await mkdtemp(resolve(tmpdir(), 'okb-old-'));
    await writeFile(resolve(folder, 'Idée.md'), '# Idée\n\nÀ creuser.\n');
    const env = sb.env;
    const added = await connectKb({ folder, name: 'Mes archives', confidential: true }, env);
    expect(added).toMatchObject({ id: 'mes-archives', notesBeforeOkb: 1 });
    expect(await readFile(resolve(folder, 'Idée.md'), 'utf8')).toBe('# Idée\n\nÀ creuser.\n');
    expect(await readFile(resolve(folder, '.okb', 'owner.yaml'), 'utf8')).toContain('mes-archives');
    await expect(connectKb({ folder, name: 'Mes archives' }, env)).rejects.toThrow(/already exists/);
    await archiveKb('mes-archives', env);
    expect((await listKbs(env)).map((k) => k.id)).not.toContain('mes-archives');
    expect(await readFile(resolve(folder, 'Idée.md'), 'utf8')).toBe('# Idée\n\nÀ creuser.\n');
    // Connected again later, under another name: the old marker does not block it.
    expect((await connectKb({ folder, name: 'Archives' }, env)).id).toBe('archives');
  });

  it('updates from a shared package only where it makes sense, with a clear reason', async () => {
    expect(await installKind()).toBe('git');
    const steps: { step: string; ok: boolean; detail?: string }[] = [];
    // This checkout comes from Git: a package is refused, `git pull` is the way.
    const ok = await updateProduct((step, okStep, detail) => steps.push({ step, ok: okStep, ...(detail ? { detail } : {}) }), { from: resolve('.') });
    expect(ok).toBe(false);
    expect(steps.at(-1)).toMatchObject({ step: 'install', ok: false, detail: 'git-checkout' });
    const notOkb: typeof steps = [];
    expect(await updateProduct((step, okStep, detail) => notOkb.push({ step, ok: okStep, ...(detail ? { detail } : {}) }), { from: tmpdir() })).toBe(false);
    expect(notOkb[0]).toMatchObject({ step: 'package', ok: false, detail: 'not an OKB package' });
  });

  it('files a note about one of the KB’s repositories with that repository', async () => {
    const { s: sb, config } = await legacyKb();
    const saved = process.env.OKB_HOME;
    process.env.OKB_HOME = sb.home;
    try {
      const { addRepo } = await import('../src/repo/registry.js');
      const repoDir = await mkdtemp(resolve(tmpdir(), 'orders-service-'));
      await addRepo({ path: repoDir, kb: 'old', name: 'orders-service' });
      await writeFile(resolve(sb.vault, 'Notes commandes.md'), '# Déployer\n\norders-service se déploie avec cf deploy. orders-service appelle S/4.\n');
      const scan = await scanConversion(config, { limit: 100 });
      expect(scan.repos.map((r) => r.name)).toEqual(['orders-service']);
      expect(scan.page.find((n) => n.path === 'Notes commandes.md')!.guess).toMatchObject({ repo: 'orders-service', folder: 'repos/orders-service' });
      expect(scan.page.find((n) => n.path === 'Journal.md')!.guess.repo).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.OKB_HOME; else process.env.OKB_HOME = saved;
    }
  });
});
