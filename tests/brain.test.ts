import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { addressFor, isoWeek, safeName } from '../src/brain/address.js';
import { keepSet, listBackups, restoreBackup, runBackup, verifyBackup } from '../src/brain/backup.js';
import { verticalContext } from '../src/brain/context.js';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { noteHistory, trash } from '../src/brain/history.js';
import { checkIntegrity } from '../src/brain/integrity.js';
import { drawerFolder, layoutOf, type BrainLayout } from '../src/brain/layout.js';
import { buildBrainMigration, planBrainMigration } from '../src/brain/migrate.js';
import { addWaiting, nowView, renderNow, setObjective } from '../src/brain/now.js';
import { repairProposal } from '../src/brain/repair.js';
import { childrenOf, hubOf, positionOf } from '../src/brain/tree.js';
import { NOTE_TYPES } from '../src/brain/types.js';
import { brainShape, glossary, subjectIndex } from '../src/brain/views.js';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { checkLinks } from '../src/links/check.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { runSetup } from '../src/setup/setup.js';
import { ensureState, statePaths } from '../src/state/paths.js';

const WORK: BrainLayout = { preset: 'work', lang: 'fr' };
const TODAY = new Date('2026-10-06T10:00:00Z');
const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function brain(options: { preset?: 'work' | 'projects' | 'topics' | 'career'; files?: Record<string, string> } = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-brain-')));
  made.push(dir);
  const home = resolve(dir, 'home');
  const kb = resolve(dir, 'kb');
  await mkdir(kb, { recursive: true });
  for (const [p, c] of Object.entries(options.files ?? {})) { await mkdir(resolve(kb, p, '..'), { recursive: true }); await writeFile(resolve(kb, p), c); }
  const env = { ...process.env, OKB_HOME: home, OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', ...(options.preset === undefined && !options.files ? { brain: { preset: 'work', names: 'fr' } } : options.preset ? { brain: { preset: options.preset, names: 'fr' } } : {}) }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  await ensureState(statePaths(config));
  return { dir, kb, env, config };
}

const note = (title: string, extra = '') => `---\ntype: Concept\ntitle: ${title}\ndescription: ${title} expliqué simplement.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-10-01T10:00:00Z\n${extra}---\n\n# ${title}\n\nTexte de ${title}.\n`;

describe('the address engine files every note the same way', () => {
  it('puts each type at its level, with readable unique names', () => {
    const at = (input: Parameters<typeof addressFor>[1], existing: string[] = []) => addressFor({ layout: WORK, existing: new Set(existing), today: TODAY }, input).path;
    expect(at({ type: 'ticket', product: 'Atlas', repo: 'atlas-api', ref: 'abc-123', title: 'Export CSV' })).toBe('2 Produits/Atlas/Code/atlas-api/Tickets/2026/abc-123 — Export CSV.md');
    expect(at({ type: 'repo-start', product: 'Atlas', repo: 'atlas-api' })).toBe('2 Produits/Atlas/Code/atlas-api/atlas-api — Démarrer.md');
    expect(at({ type: 'repo-hub', product: 'Atlas', repo: 'atlas-api' })).toBe('2 Produits/Atlas/Code/atlas-api/atlas-api.md');
    expect(at({ type: 'product-hub', product: 'Atlas' })).toBe('2 Produits/Atlas/Atlas.md');
    expect(at({ type: 'feature', product: 'Atlas', title: 'Export des données' })).toBe('2 Produits/Atlas/Fonctionnel/Export des données.md');
    expect(at({ type: 'concept', title: 'OData' })).toBe('3 Boîte à outils/Concepts/OData.md');
    expect(at({ type: 'concept', title: 'TVA', theme: 'Facturation', level: 'domain' })).toBe('1 Écosystème/Domaines/Facturation/TVA.md');
    expect(at({ type: 'business-rule', theme: 'Facturation', title: 'Avoir sur facture' })).toBe('1 Écosystème/Domaines/Facturation/Avoir sur facture.md');
    expect(at({ type: 'business-rule', product: 'Atlas', title: 'Avoir sur facture' })).toBe('2 Produits/Atlas/Fonctionnel/Avoir sur facture.md');
    expect(at({ type: 'meeting', title: 'Point d’équipe', date: '2026-10-06' })).toBe('4 Activité/Réunions/2026/2026-10-06 Point d’équipe.md');
    expect(at({ type: 'method', title: 'Déboguer un flux' })).toBe('3 Boîte à outils/Méthodes/Déboguer un flux.md');
    expect(at({ type: 'achievements', date: '2026-10-06' })).toBe('4 Activité/Carrière/Réalisations/2026.md');
    expect(at({ type: 'week', date: '2026-10-06' })).toBe('4 Activité/Journal/2026/2026-S41.md');
    expect(at({ type: 'world-hub' })).toBe('1 Écosystème/Écosystème.md');
    expect(at({ type: 'home' })).toBe('Accueil.md');
    // The same title in two subjects: the second takes its subject in front.
    expect(at({ type: 'flow', product: 'Boréal', title: 'Paiement' }, ['2 Produits/Atlas/Architecture/Paiement.md'])).toBe('2 Produits/Boréal/Architecture/Boréal — Paiement.md');
    // A repository without a product waits in « À classer ».
    expect(at({ type: 'repo-test', repo: 'tool' })).toBe('2 Produits/À classer/Code/tool/tool — Tester.md');
    expect(addressFor({ layout: { preset: 'projects', lang: 'fr' }, today: TODAY }, { type: 'ticket', product: 'Mon app', repo: 'app', ref: 'T-1', title: 'Login' }).path).toBe('2 Projets/Mon app/Code/app/Tâches/2026/T-1 — Login.md');
    expect(addressFor({ layout: { preset: 'work', lang: 'en' }, today: TODAY }, { type: 'concept', title: 'OData' }).path).toBe('3 Toolbox/Concepts/OData.md');
    expect(() => at({ type: 'ticket', repo: 'x', title: 'no ref' })).toThrow(/reference/);
    expect(() => at({ type: 'client', title: 'x' }, [])).not.toThrow();
    expect(() => addressFor({ layout: { preset: 'topics', lang: 'fr' } }, { type: 'client', title: 'x' })).toThrow(/does not exist/);
    expect(safeName('a/b: c?')).toBe('a b c');
    expect(isoWeek('2026-01-01', 'fr')).toBe('2026-S01');
  });

  it('knows every type, each with at least one place and a known category', () => {
    const categories = new Set(['concept', 'guide', 'howto', 'process', 'case', 'ticket', 'decision', 'source', 'path']);
    for (const t of NOTE_TYPES) {
      expect(t.places.length, t.id).toBeGreaterThan(0);
      expect(categories.has(t.category), `${t.id} → ${t.category}`).toBe(true);
    }
    expect(new Set(NOTE_TYPES.map((t) => t.id)).size).toBe(NOTE_TYPES.length);
  });

  it('reads a position back from a path', () => {
    const p = positionOf(WORK, '2 Produits/Atlas/Code/atlas-api/Tickets/2026/ABC-1 — X.md');
    expect(p).toMatchObject({ drawer: 'subjects', product: 'Atlas', repo: 'atlas-api', isHub: false });
    expect(p.ancestors).toContain('2 Produits/Atlas/Atlas.md');
    expect(p.ancestors).toContain('2 Produits/Atlas/Code/atlas-api/atlas-api.md');
    expect(hubOf('1 Écosystème')).toBe('1 Écosystème/Écosystème.md');
    expect(positionOf(WORK, '2 Produits/Atlas/Atlas.md').isHub).toBe(true);
  });
});

describe('a brain at the scale of real life', () => {
  it('generates 500 notes that stay organised, linked and searchable', async () => {
    const notes = demoNotes(WORK);
    expect(notes.length).toBeGreaterThan(400);
    expect(new Set(notes.map((n) => n.path)).size).toBe(notes.length);
    const { kb, config } = await brain();
    await rm(kb, { recursive: true, force: true });
    await writeDemo(kb, notes);
    const bundle = await loadBundleFor(config);
    expect(bundle.unreadable).toEqual([]);
    // Every link resolves: breadcrumbs, concepts, hubs.
    const broken = checkLinks(bundle.snapshot).issues.filter((i) => i.code === 'LINK_BROKEN_TARGET');
    expect(broken).toEqual([]);
    const shape = brainShape(WORK, bundle);
    expect(shape.outside).toEqual([]);
    expect(shape.drawers.find((d) => d.drawer === 'subjects')!.subjects.map((s) => s.name)).toEqual(expect.arrayContaining(['Atlas', 'Boréal', 'Cassini', 'Socle commun']));
    // A product's index: its features, its context and its repositories' pages, not their tickets.
    const atlas = subjectIndex(bundle, '2 Produits/Atlas');
    expect(atlas.hub).toBe('2 Produits/Atlas/Atlas.md');
    expect(atlas.items.some((i) => i.hub && i.path.endsWith('/Code/atlas-api/atlas-api.md'))).toBe(true);
    expect(atlas.items.some((i) => i.path.includes('/Tickets/'))).toBe(false);
    const repo = subjectIndex(bundle, '2 Produits/Atlas/Code/atlas-api');
    expect(repo.groups.map((g) => g.name)).toEqual(expect.arrayContaining(['', 'Tickets/2026']));
    expect(glossary(WORK, bundle).length).toBeGreaterThanOrEqual(40);
    // The vertical context of a ticket stays within its budget and starts with its parents.
    const ticket = bundle.entries.find((e) => e.path.includes('/atlas-api/Tickets/'))!.path;
    const ctx = verticalContext(WORK, bundle, ticket, 1_500);
    expect(ctx.tokens).toBeLessThanOrEqual(1_500);
    expect(ctx.items.filter((i) => i.role === 'parent').map((i) => i.path)).toEqual(expect.arrayContaining(['2 Produits/Atlas/Code/atlas-api/atlas-api.md', '2 Produits/Atlas/Atlas.md']));
    expect(childrenOf('2 Produits/Atlas/Code/atlas-api', new Set(bundle.entries.map((e) => e.path))).length).toBeGreaterThan(5);
  }, 60_000);
});

describe('a new note in a brain', () => {
  it('gets an id, a breadcrumb and the pages of its subjects, all in one proposal', async () => {
    const { config } = await brain();
    const bundle = await loadBundleFor(config);
    const path = addressFor({ layout: layoutOf(config)!, today: TODAY }, { type: 'ticket', product: 'Atlas', repo: 'atlas-api', ref: 'ABC-1', title: 'Export' }).path;
    const proposal = proposeFiles(config, bundle, new Map([[path, note('ABC-1 — Export')]]), 'test');
    await saveProposal(config, proposal);
    const saved = await loadProposal(config, proposal.id);
    const paths = saved.changes.map((c) => c.path).sort();
    expect(paths).toEqual(['2 Produits/Produits.md', '2 Produits/Atlas/Atlas.md', '2 Produits/Atlas/Code/atlas-api/atlas-api.md', 'Accueil.md', path].sort());
    const created = saved.changes.find((c) => c.path === path)!.createDocument!.content;
    expect(created).toMatch(/x_okb:\n\s+v: 1\n\s+id: n-/);
    expect(created).toContain('🧭 [🧠 Travail](');
    // The note depends on its subjects' pages: refusing a page drops the note.
    expect(saved.changes.find((c) => c.path === path)!.dependsOn.length).toBe(4);
    await grantApproval(config, saved, saved.changes.map((c) => c.id), 'human:test');
    await applyProposal(config, saved);
    const after = await loadBundleFor(config);
    expect(checkLinks(after.snapshot).issues.filter((i) => i.code === 'LINK_BROKEN_TARGET')).toEqual([]);
    expect(after.byPath.get('Accueil.md' as never)?.title).toBe('Travail');
  });
});

describe('moving a KB made before 1.0 into a brain', () => {
  it('files every note, keeps every link and every word, and can be undone', async () => {
    const link = '[voir OData](../concepts/odata.md)';
    const { config, kb } = await brain({ files: {
      'concepts/odata.md': note('OData'),
      'concepts/tva.md': note('TVA'),
      'guides/comprendre-les-flux.md': note('Comprendre les flux').replace('Texte de', `${link} — texte de`).replace('type: Concept', 'type: Guide'),
      'procedures/deployer.md': note('Déployer').replace('type: Concept', 'type: Procedure').replace('generated:', 'x_okb:\n  template: procedure\ngenerated:'),
      'index.md': '# Index\n',
    } });
    expect(layoutOf(config)).toBeNull();
    const plan = await planBrainMigration(config, 'topics', 'fr');
    expect(plan.notes.find((n) => n.path === 'index.md')).toMatchObject({ keep: true });
    expect(plan.notes.find((n) => n.path === 'concepts/odata.md')).toMatchObject({ type: 'concept', title: 'OData' });
    // Claude refines: the guide belongs to a subject.
    const refined = { ...plan, notes: plan.notes.map((n) => (n.path.startsWith('guides/') ? { ...n, product: 'Intégration', level: 'product' as const } : n)) };
    const result = await buildBrainMigration(config, refined);
    expect(result.moves.map((m) => m.to)).toEqual(expect.arrayContaining(['3 Boîte à outils/Concepts/OData.md', '2 Sujets/Intégration/Comprendre les flux.md', '3 Boîte à outils/Méthodes/Déployer.md']));
    await saveProposal(config, result.proposal);
    const saved = await loadProposal(config, result.proposal.id);
    await grantApproval(config, saved, saved.changes.map((c) => c.id), 'human:test');
    const receipt = await applyProposal(config, saved);
    const guide = await readFile(resolve(kb, '2 Sujets/Intégration/Comprendre les flux.md'), 'utf8');
    expect(guide).toContain('[voir OData](../../3%20Bo%C3%AEte%20%C3%A0%20outils/Concepts/OData.md)');
    expect(guide).toContain('🧭 ');
    expect(guide).toMatch(/id: n-/);
    const after = await loadBundleFor(config);
    expect(checkLinks(after.snapshot).issues.filter((i) => i.code === 'LINK_BROKEN_TARGET')).toEqual([]);
    expect(await readdir(resolve(kb, 'concepts')).catch(() => [])).toEqual([]);
    // The history follows the note across the move.
    const versions = await noteHistory(config, '3 Boîte à outils/Concepts/OData.md');
    expect(versions.map((v) => v.path)).toContain('concepts/odata.md');
    // Undo puts everything back.
    const { rollback } = await import('../src/apply/apply.js');
    await rollback(config, receipt.id);
    expect(await readFile(resolve(kb, 'concepts/odata.md'), 'utf8')).toBe(note('OData'));
  });
});

describe('storage that loses nothing', () => {
  it('keeps daily snapshots, verifies them and restores into a new folder', async () => {
    const { config, kb, env, dir } = await brain({ files: { 'a.md': note('A') } });
    const first = await runBackup(config, { env, now: new Date('2026-10-01T09:00:00Z') });
    expect(first.created).toBe(true);
    await writeFile(resolve(kb, 'b.md'), note('B'));
    const second = await runBackup(config, { env, now: new Date('2026-10-02T09:00:00Z') });
    expect(second.linked).toBeGreaterThan(0);
    expect((await runBackup(config, { env, now: new Date('2026-10-02T18:00:00Z') })).created).toBe(false);
    expect((await listBackups(config, env)).map((b) => b.date)).toEqual(['2026-10-02', '2026-10-01']);
    const verified = await verifyBackup(config, undefined, env);
    expect(verified.bad).toEqual([]);
    expect(verified.missing).toEqual([]);
    expect(Object.keys((JSON.parse(await readFile(resolve(second.info.path, 'manifest.json'), 'utf8')) as { files: object }).files).some((k) => k.endsWith('approval.key'))).toBe(false);
    const restored = await restoreBackup(config, '2026-10-01', resolve(dir, 'restore'), env);
    expect(restored.files).toBe(1);
    await expect(restoreBackup(config, '2026-10-01', kb, env)).rejects.toThrow(/never goes into the KB/);
    // Retention: 7 days, then weeks, then months.
    const dates = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 9, 6) - i * 86_400_000).toISOString().slice(0, 10));
    const keep = keepSet(dates, new Date('2026-10-06T12:00:00Z'));
    expect(keep.size).toBeLessThan(25);
    expect(keep.has('2026-10-06')).toBe(true);
  });

  it('finds sync copies and moved notes, and repairs them through a proposal', async () => {
    const { config, kb } = await brain();
    await mkdir(resolve(kb, '3 Boîte à outils', 'Concepts'), { recursive: true });
    await writeFile(resolve(kb, '3 Boîte à outils/Concepts/OData.md'), note('OData', 'x_okb:\n  id: n-0001\n'));
    await writeFile(resolve(kb, '3 Boîte à outils/Concepts/TVA.md'), note('TVA', 'x_okb:\n  id: n-0002\n'));
    await writeFile(resolve(kb, '3 Boîte à outils/Concepts/TVA 2.md'), note('TVA', 'x_okb:\n  id: n-0002\n'));
    await writeFile(resolve(kb, 'Accueil.md'), note('Travail').replace('Texte de Travail.', '[OData](3%20Bo%C3%AEte%20%C3%A0%20outils/Concepts/OData.md)'));
    let bundle = await loadBundleFor(config);
    const { idMoves } = await import('../src/brain/integrity.js');
    await idMoves(config, bundle, true);
    // Moved by hand, outside OKB.
    await mkdir(resolve(kb, '1 Écosystème', 'Domaines', 'Intégration'), { recursive: true });
    await writeFile(resolve(kb, '1 Écosystème/Domaines/Intégration/OData.md'), await readFile(resolve(kb, '3 Boîte à outils/Concepts/OData.md'), 'utf8'));
    await rm(resolve(kb, '3 Boîte à outils/Concepts/OData.md'));
    bundle = await loadBundleFor(config);
    const findings = await checkIntegrity(config, bundle, { disk: false });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('moved-note');
    expect(codes).toContain('no-backup');
    expect(findings.find((f) => f.code === 'sync-copy')).toMatchObject({ path: '3 Boîte à outils/Concepts/TVA 2.md', detail: 'identical' });
    const { proposal, counts } = repairProposal(config, bundle, findings, { ids: false });
    expect(counts).toMatchObject({ links: 1, copies: 1 });
    const home = proposal!.changes.find((c) => c.path === 'Accueil.md')!;
    expect(home.replaceDocument!.content).toContain('1%20%C3%89cosyst%C3%A8me/Domaines/Int%C3%A9gration/OData.md');
  });

  it('keeps deleted notes restorable from the trash', async () => {
    const { config } = await brain({ files: { 'x.md': note('X') } });
    const bundle = await loadBundleFor(config);
    const proposal = proposeFiles(config, bundle, new Map([['x.md', null]]), 'delete');
    await saveProposal(config, proposal);
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:test');
    await applyProposal(config, proposal);
    const items = await trash(config);
    expect(items).toMatchObject([{ path: 'x.md', title: 'X' }]);
  });
});

describe('Maintenant, computed without AI', () => {
  it('gathers the objective, deadlines and waiting questions', async () => {
    const { config, kb } = await brain({ files: { 'p.md': note('Présentation Atlas', 'due: 2026-10-09\n') } });
    await setObjective(config, 'Maîtriser le produit Atlas');
    await addWaiting(config, 'Quel quota pour l’API ?', 'équipe plateforme');
    const view = await nowView(config, await loadBundleFor(config), {}, new Date('2026-10-06T10:00:00Z'));
    expect(view.objective?.text).toBe('Maîtriser le produit Atlas');
    expect(view.deadlines).toMatchObject([{ title: 'Présentation Atlas', days: 3 }]);
    const text = renderNow(view, 'fr');
    expect(text).toContain('Quel quota pour l’API ? (équipe plateforme)');
    expect(text).toContain('2026-10-09 — Présentation Atlas');
    expect(kb).toBeTruthy();
    expect(drawerFolder(WORK, 'activity')).toBe('4 Activité');
  });
});
