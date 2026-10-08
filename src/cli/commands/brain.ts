import { resolve } from 'node:path';
import { addressFor, breadcrumb, type AddressInput } from '../../brain/address.js';
import { backupRoot, listBackups, restoreBackup, runBackup, verifyBackup } from '../../brain/backup.js';
import { setBrainConfig } from '../../brain/config.js';
import { renderContext, verticalContext } from '../../brain/context.js';
import { DEMO_DEFAULT, demoNotes, writeDemo } from '../../brain/demo.js';
import { noteHistory, readVersion, trash } from '../../brain/history.js';
import { checkIntegrity, idMoves } from '../../brain/integrity.js';
import { BRAIN_PRESETS, drawerFolder, layoutOf, type BrainLayout, type BrainPreset } from '../../brain/layout.js';
import { buildBrainMigration, planBrainMigration, readBrainPlan, writeBrainPlan } from '../../brain/migrate.js';
import { addWaiting, nowView, renderNow, resolveWaiting, setObjective } from '../../brain/now.js';
import { listProducts } from '../../brain/products.js';
import { repairProposal } from '../../brain/repair.js';
import { typesFor } from '../../brain/types.js';
import { brainShape, folderForIndex, glossary, renderIndex, subjectIndex } from '../../brain/views.js';
import type { OkbConfig } from '../../config/schema.js';
import { lang as uiLang, t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { markdownLink } from '../../links/portable.js';
import { proposeFiles } from '../../proposal/files.js';
import { saveProposal } from '../../proposal/store.js';
import { setRepoProduct } from '../../repo/registry.js';
import { runSetup } from '../../setup/setup.js';
import { OkbError } from '../../util/errors.js';
import { readJsonIfExists, readTextIfExists } from '../../util/fsx.js';
import { asBundlePath } from '../../util/paths.js';
import { flagBool, flagNumber, flagString } from '../args.js';
import { paint, sym } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

function pickLang(config: OkbConfig): 'fr' | 'en' {
  const l = config.writing.language ?? config.profile.answer.language;
  return l.startsWith('fr') ? 'fr' : 'en';
}

async function brainOf(ctx: Ctx): Promise<{ config: OkbConfig; layout: BrainLayout }> {
  const { config } = await effective(ctx.args);
  const layout = layoutOf(config);
  if (!layout) throw new OkbError('E_INVALID', `KB "${config.profile.id}" is not a brain yet`, { key: 'brainNotYet', params: { id: config.profile.id }, hint: 'okb brain migrate' });
  return { config, layout };
}

function addressInput(ctx: Ctx, type: string): AddressInput {
  const a = ctx.args;
  const s = (k: string) => flagString(a, k);
  return {
    type,
    ...(s('title') ? { title: s('title')! } : {}), ...(s('product') ? { product: s('product')! } : {}),
    ...(s('repo') ? { repo: s('repo')! } : {}), ...(s('theme') ? { theme: s('theme')! } : {}),
    ...(s('ref') ? { ref: s('ref')! } : {}), ...(s('date') ? { date: s('date')! } : {}),
    ...(s('level') ? { level: s('level') as AddressInput['level'] } : {}),
  };
}

/** `okb where <type> …` — the exact place a note of this type and subject takes. */
export async function cmdWhere(ctx: Ctx, typeArg?: string): Promise<number> {
  const { config, layout } = await brainOf(ctx);
  const type = typeArg ?? ctx.args.positionals[0];
  if (!type) throw new OkbError('E_INVALID', 'which type of note?', { key: 'brainWhichType', hint: 'okb brain types' });
  const bundle = await loadBundleFor(config);
  const address = addressFor({ layout, existing: new Set(bundle.snapshot.files.keys()) }, addressInput(ctx, type));
  const name = config.profile.displayName || config.profile.id;
  const missing = address.hubs.filter((h) => !bundle.byPath.has(h.path)).map((h) => h.path);
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, ...address, breadcrumb: breadcrumb(name, address), exists: bundle.byPath.has(address.path), absolute: resolve(config.kb.root, address.path), newSubjects: missing });
    return 0;
  }
  ctx.out.line(`📍 ${paint.bold(breadcrumb(name, address))}`);
  ctx.out.line(`   ${paint.code(address.path)}${bundle.byPath.has(address.path) ? paint.dim(` (${t('brain.where.exists')})`) : ''}`);
  if (missing.length) ctx.out.line(paint.dim(`   ${t('brain.where.newSubjects', { n: missing.length })}`));
  return 0;
}

export async function cmdBrain(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0] ?? 'status';
  const rest = { ...ctx, args: { ...ctx.args, positionals: ctx.args.positionals.slice(1) } };
  switch (sub) {
    case 'status': return brainStatus(ctx);
    case 'where': return cmdWhere(rest);
    case 'types': return brainTypes(ctx);
    case 'index': return brainIndex(rest);
    case 'context': return brainContext(rest);
    case 'glossary': return brainGlossary(ctx);
    case 'migrate': return brainMigrate(ctx);
    case 'check': return brainCheck(ctx);
    case 'repair': return brainRepair(ctx);
    case 'demo': return brainDemo(rest);
    case 'views': return brainViews(ctx);
    case 'session': return brainSession(ctx);
    case 'obsidian': return brainObsidian(ctx);
    default: throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, command: 'brain' }, hint: 'okb help brain' });
  }
}

async function brainStatus(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const layout = layoutOf(config);
  if (!layout) {
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, brain: null, kb: config.profile.id }); return 0; }
    ctx.out.info(t('brain.notYet', { kb: config.profile.displayName || config.profile.id }));
    ctx.out.next(['okb brain migrate']);
    return 0;
  }
  const bundle = await loadBundleFor(config);
  const shape = brainShape(layout, bundle);
  const products = await listProducts(config);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, brain: { preset: layout.preset, names: layout.lang, views: config.kb.brain?.views ?? 'app' }, kb: config.profile.id, ...shape, products }); return 0; }
  ctx.out.line(paint.bold(`🧠 ${config.profile.displayName || config.profile.id}`) + paint.dim(`  ${t(`brain.preset.${layout.preset}`)} · ${bundle.entries.length} notes`));
  for (const d of shape.drawers) {
    ctx.out.line(`  ${paint.bold(d.folder)} ${paint.dim(`(${d.notes})`)}`);
    for (const s of d.subjects.slice(0, 12)) ctx.out.line(`     ${s.name} ${paint.dim(`(${s.notes})`)}`);
    if (d.subjects.length > 12) ctx.out.line(paint.dim(`     … ${d.subjects.length - 12}`));
  }
  if (shape.outside.length) ctx.out.warn(t('brain.outside', { n: shape.outside.length }));
  return 0;
}

async function brainTypes(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const layout = layoutOf(config);
  const preset = (flagString(ctx.args, 'preset') as BrainPreset | undefined) ?? layout?.preset ?? 'work';
  const l = layout?.lang ?? pickLang(config);
  const types = typesFor(preset).filter((x) => !x.view);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, preset, types: types.map((x) => ({ id: x.id, label: l === 'fr' ? x.label.fr : x.label.en, levels: x.places.map((p) => p.level), template: x.template, category: x.category, speed: x.speed, cost: x.cost })) }); return 0; }
  ctx.out.grid(types.map((x) => [x.id, l === 'fr' ? x.label.fr : x.label.en, x.places.map((p) => p.level).join('/'), x.cost]));
  return 0;
}

async function brainIndex(ctx: Ctx): Promise<number> {
  const { config, layout } = await brainOf(ctx);
  const bundle = await loadBundleFor(config);
  const folder = folderForIndex(config, ctx.args.positionals[0] ?? drawerFolder(layout, 'subjects'));
  const index = subjectIndex(bundle, folder);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...index }); return 0; }
  ctx.out.line(paint.bold(`📌 ${index.title}`) + paint.dim(`  ${folder}`));
  ctx.out.line(renderIndex(index, index.hub ?? `${folder}/x.md`, layout.lang, (_f, to, text) => `${text} ${paint.dim(to)}`));
  return 0;
}

async function brainContext(ctx: Ctx): Promise<number> {
  const { config, layout } = await brainOf(ctx);
  const target = ctx.args.positionals[0];
  if (!target) throw new OkbError('E_INVALID', 'which note or subject?', { key: 'brainWhichTarget' });
  const bundle = await loadBundleFor(config);
  const result = verticalContext(layout, bundle, target, flagNumber(ctx.args, 'budget') ?? 2_000);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, ...result }); return 0; }
  ctx.out.line(renderContext(result, config.kb.root));
  ctx.out.line(paint.dim(`~${result.tokens}/${result.budget} tokens${result.truncated ? ` · ${t('brain.context.truncated')}` : ''}`));
  return 0;
}

async function brainGlossary(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const bundle = await loadBundleFor(config);
  const entries = glossary(layoutOf(config), bundle);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, entries }); return 0; }
  for (const e of entries) ctx.out.line(`${paint.bold(e.term)}${e.aliases.length ? paint.dim(` (${e.aliases.join(', ')})`) : ''} — ${e.description || paint.dim(e.path)}`);
  if (!entries.length) ctx.out.info(t('brain.glossary.empty'));
  return 0;
}

async function brainMigrate(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  if (flagBool(ctx.args, 'finish')) {
    const plan = await readBrainPlan(config);
    if (!plan) throw new OkbError('E_NOT_FOUND', 'no brain plan', { key: 'brainNoPlan', hint: 'okb brain migrate' });
    await setBrainConfig(config.profile.id, { preset: plan.preset, names: plan.names });
    if (ctx.mode === 'json') ctx.out.json({ ok: true, finished: true, preset: plan.preset });
    else ctx.out.ok(t('brain.migrate.finished', { kb: config.profile.displayName || config.profile.id }));
    return 0;
  }
  if (layoutOf(config)) throw new OkbError('E_INVALID', 'this KB is already a brain', { key: 'brainAlready' });
  const preset = (flagString(ctx.args, 'preset') ?? (config.kb.kind === 'workspace' ? 'work' : 'topics')) as BrainPreset;
  if (!(BRAIN_PRESETS as readonly string[]).includes(preset)) throw new OkbError('E_INVALID', `unknown preset ${preset}`, { key: 'brainUnknownPreset', params: { preset } });
  const names = (flagString(ctx.args, 'names') ?? pickLang(config)) as 'fr' | 'en';
  const planFile = flagString(ctx.args, 'plan-file');
  if (flagBool(ctx.args, 'build') || planFile) {
    const raw = planFile ? await readJsonIfExists<unknown>(resolve(planFile)) : await readBrainPlan(config);
    if (!raw) throw new OkbError('E_NOT_FOUND', 'no brain plan', { key: 'brainNoPlan', hint: 'okb brain migrate' });
    if (planFile) await writeBrainPlan(config, raw as never);
    const result = await buildBrainMigration(config, raw);
    await saveProposal(config, result.proposal);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, proposalId: result.proposal.id, moves: result.moves, kept: result.kept, changes: result.proposal.changes.length }); return 0; }
    ctx.out.ok(t('brain.migrate.proposed', { n: result.moves.length }));
    ctx.out.next([`okb review ${result.proposal.id} --diff`, 'okb brain migrate --finish']);
    return 0;
  }
  const plan = await planBrainMigration(config, preset, names);
  const path = await writeBrainPlan(config, plan);
  const byType = new Map<string, number>();
  for (const n of plan.notes) byType.set(n.keep ? 'keep' : n.type ?? 'folder', (byType.get(n.keep ? 'keep' : n.type ?? 'folder') ?? 0) + 1);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, planPath: path, preset, names, notes: plan.notes.length, byType: Object.fromEntries(byType), plan }); return 0; }
  ctx.out.ok(t('brain.migrate.planned', { n: plan.notes.length, path: paint.path(path) }));
  ctx.out.grid([...byType.entries()].map(([k, v]) => [k, String(v)]));
  ctx.out.next(['okb brain migrate --build']);
  return 0;
}

async function brainCheck(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const bundle = await loadBundleFor(config);
  const findings = await checkIntegrity(config, bundle);
  await idMoves(config, bundle, true).catch(() => []);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, findings }); return 0; }
  if (!findings.length) { ctx.out.ok(t('brain.check.clean')); return 0; }
  const by = new Map<string, number>();
  for (const f of findings) by.set(f.code, (by.get(f.code) ?? 0) + 1);
  for (const [code, n] of by) {
    const level = findings.find((f) => f.code === code)!.level;
    ctx.out.line(`${level === 'error' ? sym.err() : level === 'warning' ? sym.warn() : sym.info()} ${t(`brain.check.${code}`)} ${paint.dim(`(${n})`)}`);
    for (const f of findings.filter((x) => x.code === code).slice(0, 3)) if (f.path) ctx.out.line(paint.dim(`     ${f.path}${f.to ? ` → ${f.to}` : ''}`));
  }
  ctx.out.next(['okb brain repair', 'okb backup run']);
  return 0;
}

async function brainRepair(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const bundle = await loadBundleFor(config);
  const findings = await checkIntegrity(config, bundle, { disk: false });
  const { proposal, counts } = repairProposal(config, bundle, findings);
  if (proposal) await saveProposal(config, proposal);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, proposalId: proposal?.id ?? null, counts }); return 0; }
  if (!proposal) { ctx.out.ok(t('brain.repair.nothing')); return 0; }
  ctx.out.ok(t('brain.repair.proposed', { copies: counts.copies, ids: counts.ids, links: counts.links }));
  ctx.out.next([`okb review ${proposal.id} --diff`]);
  return 0;
}

async function brainDemo(ctx: Ctx): Promise<number> {
  const folder = ctx.args.positionals[0];
  if (!folder) throw new OkbError('E_INVALID', 'where should the demo brain go?', { key: 'brainDemoWhere' });
  const l = (flagString(ctx.args, 'names') ?? uiLang()) as 'fr' | 'en';
  const layout: BrainLayout = { preset: 'work', lang: l };
  const size = {
    products: flagNumber(ctx.args, 'products') ?? DEMO_DEFAULT.products, repos: flagNumber(ctx.args, 'repos') ?? DEMO_DEFAULT.repos,
    tickets: flagNumber(ctx.args, 'tickets') ?? DEMO_DEFAULT.tickets, meetings: flagNumber(ctx.args, 'meetings') ?? DEMO_DEFAULT.meetings,
    concepts: flagNumber(ctx.args, 'concepts') ?? DEMO_DEFAULT.concepts,
  };
  const notes = demoNotes(layout, size, l === 'fr' ? 'Démo' : 'Demo');
  // A demo written earlier without --connect: connecting it again rewrites nothing.
  const { readdir } = await import('node:fs/promises');
  const existing = (await readdir(resolve(folder)).catch(() => [] as string[])).filter((e) => !e.startsWith('.'));
  const already = flagBool(ctx.args, 'connect') && existing.length > 0 && notes.some((x) => existing.includes(x.path.split('/')[0]!)) && existing.some((e) => /^(Accueil|Home)\.md$/.test(e));
  const n = already ? notes.length : await writeDemo(folder, notes);
  let profile: string | null = null;
  if (flagBool(ctx.args, 'connect')) {
    profile = flagString(ctx.args, 'id') ?? 'demo-brain';
    await runSetup({ profileId: profile, kbRoot: resolve(folder), conceptAssist: 'targeted', humanActor: 'human:demo', answerLanguage: l, displayName: l === 'fr' ? 'Démo' : 'Demo', brain: { preset: 'work', names: l } });
  }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, folder: resolve(folder), notes: n, profile }); return 0; }
  ctx.out.ok(t(already ? 'brain.demo.connected' : 'brain.demo.done', { n, folder: paint.path(resolve(folder)) }));
  if (profile) {
    ctx.out.info(t('brain.demo.howTo', { id: profile }));
    ctx.out.next([`okb serve --kb ${profile}`, `okb brain --kb ${profile}`, `okb find "export csv" --kb ${profile}`]);
  } else {
    // Written but not connected: say how to open it, or `okb serve` shows the active KB instead.
    ctx.out.info(t('brain.demo.notConnected'));
    ctx.out.next([`okb brain demo "${folder}" --connect`]);
  }
  return 0;
}

/**
 * What Claude gets when a session starts: the brain's drawers and subjects, « Maintenant »,
 * the subject of the folder it opens in, and the rules for a new note. Short on purpose
 * (≤ ~800 tokens whatever the size of the brain). Also starts today's backup in the background.
 */
async function brainSession(ctx: Ctx): Promise<number> {
  let config: OkbConfig;
  try { config = (await effective(ctx.args)).config; } catch { return 0; }
  const layout = layoutOf(config);
  const { backupsEnabled } = await import('../../brain/backup.js');
  if (await backupsEnabled().catch(() => false)) {
    const latest = (await listBackups(config).catch(() => []))[0];
    if (!latest || Date.now() - Date.parse(latest.createdAt) > 20 * 3_600_000) {
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [process.argv[1]!, 'backup', 'run', '--kb', config.profile.id, '--quiet'], { detached: true, stdio: 'ignore', env: process.env });
      child.unref();
    }
  }
  if (!layout) return 0;
  const { sessionBrief } = await import('../../brain/session.js');
  ctx.out.line(await sessionBrief(config, layout, await loadBundleFor(config), flagString(ctx.args, 'cwd')));
  return 0;
}

/**
 * Obsidian: the graph's colour groups (one colour per drawer) to paste in
 * Graph view › Groups, and tables (Bases) to embed in a note. OKB does not
 * write Obsidian's own settings: they belong to the person.
 */
const DRAWER_COLORS: Record<string, number> = { inbox: 0x94a3b8, world: 0x10b981, subjects: 0x3b82f6, toolbox: 0xf59e0b, activity: 0xa855f7 };
async function brainObsidian(ctx: Ctx): Promise<number> {
  const { layout } = await brainOf(ctx);
  const groups = (['inbox', 'world', 'subjects', 'toolbox', 'activity'] as const).map((d) => ({ query: `path:"${drawerFolder(layout, d)}"`, color: { a: 1, rgb: DRAWER_COLORS[d]! } }));
  const fr = layout.lang === 'fr';
  const bases = [
    { title: fr ? 'Tickets en cours' : 'Tickets in progress', filter: `file.path.contains("/${fr ? 'Tickets' : 'Tickets'}/")` },
    { title: fr ? 'Erreurs connues' : 'Known errors', filter: `file.path.contains("/Support/")` },
    { title: fr ? 'Fiches concept' : 'Concept cards', filter: `file.path.contains("/Concepts/")` },
    { title: fr ? 'Réunions' : 'Meetings', filter: `file.path.contains("/${fr ? 'Réunions' : 'Meetings'}/")` },
  ].map((b) => ['```base', 'filters:', '  and:', `    - ${b.filter}`, 'views:', '  - type: table', `    name: ${b.title}`, '    order:', '      - file.name', '      - status', '      - file.mtime', '```'].join('\n'));
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, colorGroups: groups, bases }); return 0; }
  ctx.out.line(paint.bold(t('brain.obsidian.colors')));
  ctx.out.line(JSON.stringify({ colorGroups: groups }, null, 2));
  ctx.out.line('');
  ctx.out.line(paint.bold(t('brain.obsidian.bases')));
  for (const b of bases) ctx.out.line(`${b}\n`);
  return 0;
}

/** With `views: files`: Glossaire and Maintenant as files, through a proposal. */
async function brainViews(ctx: Ctx): Promise<number> {
  const { config, layout } = await brainOf(ctx);
  const bundle = await loadBundleFor(config);
  const fr = layout.lang === 'fr';
  const glossaryPath = asBundlePath(fr ? 'Glossaire.md' : 'Glossary.md');
  const nowPath = asBundlePath(fr ? 'Maintenant.md' : 'Now.md');
  const head = (title: string, desc: string) => `---\ntype: Reference\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(desc)}\nstatus: stable\ngenerated:\n  by: ${config.okf.machineActor}\n  at: ${new Date().toISOString()}\nx_okb:\n  v: 1\n  brain:\n    type: ${title === 'Glossaire' || title === 'Glossary' ? 'glossary' : 'now'}\n---\n\n`;
  const g = glossary(layout, bundle);
  const glossaryText = `${head(fr ? 'Glossaire' : 'Glossary', fr ? 'Tous les concepts du cerveau, de A à Z.' : 'Every concept of the brain, A to Z.')}# ${fr ? 'Glossaire' : 'Glossary'}\n\n${g.map((e) => `- ${markdownLink(glossaryPath, e.path, e.term)}${e.description ? ` — ${e.description}` : ''}`).join('\n') || (fr ? '_Aucun concept encore._' : '_No concept yet._')}\n`;
  const now = renderNow(await nowView(config, bundle), layout.lang);
  const nowText = `${head(fr ? 'Maintenant' : 'Now', fr ? 'Sur quoi je suis en ce moment (calculé par OKB).' : 'What I am on right now (computed by OKB).')}# ${fr ? 'Maintenant' : 'Now'}\n\n${now.split('\n').map((l) => (l.startsWith('   ') ? l.trim() : l)).join('\n\n')}\n`;
  const proposal = proposeFiles(config, bundle, new Map([[glossaryPath, glossaryText], [nowPath, nowText]]), fr ? 'tableaux de bord' : 'dashboards');
  if (proposal.changes.length) await saveProposal(config, proposal);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, proposalId: proposal.changes.length ? proposal.id : null }); return 0; }
  if (!proposal.changes.length) ctx.out.info(t('brain.views.upToDate'));
  else { ctx.out.ok(t('brain.views.proposed')); ctx.out.next([`okb review ${proposal.id}`]); }
  return 0;
}

/* ------------------------------------------------------------------ now */

export async function cmdNow(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub, ...rest] = ctx.args.positionals;
  const l = layoutOf(config)?.lang ?? pickLang(config);
  if (sub === 'objective' || sub === 'objectif') {
    const objective = await setObjective(config, rest.join(' ') || null);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, objective }); else ctx.out.ok(objective ? t('now.objectiveSet', { text: objective.text }) : t('now.objectiveCleared'));
    return 0;
  }
  if (sub === 'wait' || sub === 'attente') {
    const w = await addWaiting(config, rest.join(' '), flagString(ctx.args, 'who') ?? '');
    if (ctx.mode === 'json') ctx.out.json({ ok: true, waiting: w }); else ctx.out.ok(t('now.waitAdded', { id: w.id }));
    return 0;
  }
  if (sub === 'answered' || sub === 'repondu' || sub === 'répondu') {
    const w = await resolveWaiting(config, rest.join(' '));
    if (ctx.mode === 'json') ctx.out.json({ ok: true, resolved: w }); else ctx.out.ok(t('now.waitResolved', { text: w.text }));
    return 0;
  }
  const bundle = await loadBundleFor(config);
  const view = await nowView(config, bundle);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...view }); return 0; }
  ctx.out.line(paint.bold(`🎯 ${l === 'fr' ? 'Maintenant' : 'Now'} — ${config.profile.displayName || config.profile.id}`));
  ctx.out.line(renderNow(view, l));
  return 0;
}

/* ------------------------------------------------------------- products */

export async function cmdProduct(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub = 'list', ...rest] = ctx.args.positionals;
  if (sub === 'set') {
    const [repo, ...name] = rest;
    if (!repo) throw new OkbError('E_INVALID', 'which repository?', { key: 'productWhichRepo' });
    const product = name.join(' ').trim() || null;
    const entry = await setRepoProduct(repo, product);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, repo: entry }); else ctx.out.ok(product ? t('product.set', { repo: entry.name, product }) : t('product.unset', { repo: entry.name }));
    return 0;
  }
  if (sub === 'show') {
    const name = rest.join(' ').trim();
    if (!name) throw new OkbError('E_INVALID', 'which product?', { key: 'productWhich' });
    const layout = layoutOf(config);
    if (!layout) throw new OkbError('E_INVALID', `KB "${config.profile.id}" is not a brain yet`, { key: 'brainNotYet', params: { id: config.profile.id }, hint: 'okb brain migrate' });
    const { productView } = await import('../../dev/dev.js');
    const view = productView(layout, await loadBundleFor(config), name);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, product: view }); return 0; }
    ctx.out.line(`📦 ${paint.bold(view.name)}  ${paint.dim(`${view.notes} · ${view.folder}`)}`);
    for (const side of view.sides) ctx.out.line(`   ${side.name} (${side.notes})`);
    for (const h of view.have) ctx.out.line(`   ✅ ${h.label} — ${h.notes.map((n) => n.title).join(' · ')}`);
    if (view.missing.length) ctx.out.line(paint.dim(`   ${t('product.missing')} ${view.missing.map((m) => m.label).join(' · ')}`));
    return 0;
  }
  const products = await listProducts(config);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, products }); return 0; }
  if (!products.length) { ctx.out.info(t('product.none')); return 0; }
  for (const p of products) {
    ctx.out.line(`📦 ${paint.bold(p.name)}${p.exists ? '' : paint.dim(` (${t('product.noFolder')})`)}`);
    for (const r of p.repos) ctx.out.line(`   💻 ${r.name}${r.folder ? '' : paint.dim(` (${t('product.noNotes')})`)}`);
  }
  return 0;
}

/* -------------------------------------------------------- history, trash */

export async function cmdHistory(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const target = ctx.args.positionals[0];
  if (!target) throw new OkbError('E_INVALID', 'which note?', { key: 'historyWhich' });
  const versions = await noteHistory(config, target);
  const show = flagNumber(ctx.args, 'show');
  const restore = flagNumber(ctx.args, 'restore');
  if (show !== undefined || restore !== undefined) {
    const v = versions.find((x) => x.n === (show ?? restore));
    if (!v) throw new OkbError('E_NOT_FOUND', `no version ${show ?? restore}`, { key: 'historyNoVersion', params: { n: String(show ?? restore) } });
    const text = await readVersion(v);
    if (text === null) throw new OkbError('E_NOT_FOUND', 'this version is no longer kept', { key: 'historyGone' });
    if (show !== undefined) { if (ctx.mode === 'json') ctx.out.json({ ok: true, version: v, text }); else ctx.out.line(text); return 0; }
    const bundle = await loadBundleFor(config);
    const proposal = proposeFiles(config, bundle, new Map([[asBundlePath(target), text]]), `restore ${target} (version ${v.n})`);
    if (proposal.changes.length) await saveProposal(config, proposal);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: proposal.changes.length ? proposal.id : null });
    else if (!proposal.changes.length) ctx.out.info(t('history.same'));
    else { ctx.out.ok(t('history.restoreProposed', { n: v.n })); ctx.out.next([`okb review ${proposal.id} --diff`]); }
    return 0;
  }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, path: target, versions }); return 0; }
  if (!versions.length) { ctx.out.info(t('history.none')); return 0; }
  ctx.out.grid(versions.map((v) => [`#${v.n}`, v.at.slice(0, 16).replace('T', ' '), t(`history.action.${v.action}`), v.path !== target ? v.path : '']));
  ctx.out.next([`okb history "${target}" --show 1`, `okb history "${target}" --restore 1`]);
  return 0;
}

export async function cmdTrash(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub, target] = ctx.args.positionals;
  const items = await trash(config, { days: flagNumber(ctx.args, 'days') ?? 30 });
  if (sub === 'restore') {
    const item = items.find((i) => i.path === target || i.title === target);
    if (!item) throw new OkbError('E_NOT_FOUND', `not in the trash: ${target ?? ''}`, { key: 'trashUnknown', params: { path: target ?? '' } });
    const text = await readTextIfExists(item.file);
    const bundle = await loadBundleFor(config);
    const proposal = proposeFiles(config, bundle, new Map([[item.path, text!]]), `restore ${item.path} from the trash`);
    if (proposal.changes.length) await saveProposal(config, proposal);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: proposal.id }); else { ctx.out.ok(t('trash.restoreProposed', { title: item.title })); ctx.out.next([`okb review ${proposal.id}`]); }
    return 0;
  }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, items }); return 0; }
  if (!items.length) { ctx.out.info(t('trash.empty')); return 0; }
  ctx.out.grid(items.map((i) => [i.deletedAt.slice(0, 10), i.title, paint.dim(i.path)]));
  ctx.out.next([`okb trash restore "${items[0]!.path}"`]);
  return 0;
}

/* --------------------------------------------------------------- backups */

export async function cmdBackup(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub = 'list', arg] = ctx.args.positionals;
  if (sub === 'run') {
    const r = await runBackup(config, { force: flagBool(ctx.args, 'force') });
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...r }); return 0; }
    if (!r.created) ctx.out.info(t('backup.already', { date: r.info.date }));
    else ctx.out.ok(t('backup.done', { date: r.info.date, files: r.info.files, linked: r.linked, path: paint.path(r.info.path) }));
    return 0;
  }
  if (sub === 'verify') {
    const r = await verifyBackup(config, arg);
    if (ctx.mode === 'json') { ctx.out.json({ ...r, ok: r.bad.length === 0 && r.missing.length === 0 }); return r.bad.length || r.missing.length ? 1 : 0; }
    if (!r.bad.length && !r.missing.length) ctx.out.ok(t('backup.verified', { date: r.date, files: r.files }));
    else ctx.out.fail(t('backup.broken', { date: r.date, bad: r.bad.length + r.missing.length }));
    return r.bad.length || r.missing.length ? 1 : 0;
  }
  if (sub === 'restore') {
    const to = flagString(ctx.args, 'to');
    if (!arg || !to) throw new OkbError('E_INVALID', 'okb backup restore <date> --to <new folder>', { key: 'backupRestoreUsage' });
    const r = await restoreBackup(config, arg, to);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, ...r }); else ctx.out.ok(t('backup.restored', { files: r.files, to: paint.path(r.to) }));
    return 0;
  }
  const list = await listBackups(config);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, dir: await backupRoot(), backups: list }); return 0; }
  ctx.out.line(paint.dim(`${t('backup.where')} ${await backupRoot()}`));
  if (!list.length) { ctx.out.info(t('backup.none')); ctx.out.next(['okb backup run']); return 0; }
  ctx.out.grid(list.map((b) => [b.date, `${b.files} ${t('backup.files')}`, `${Math.round(b.bytes / 1024)} Ko`]));
  return 0;
}

export const BRAIN_PRESET_LIST = BRAIN_PRESETS;
