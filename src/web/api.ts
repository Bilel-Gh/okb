import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyProposal, rollback } from '../apply/apply.js';
import { approvalPath, grantApproval } from '../apply/approval.js';
import { commitKbChanges } from '../apply/git.js';
import { guardApply } from '../apply/guard.js';
import { expandHome, loadConfig } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { doctor } from '../doctor/doctor.js';
import { focusPaths, initFocus, readFocus, recordSession, sessionsSince, setFocus } from '../focus/focus.js';
import { EN } from '../i18n/en.js';
import { FR } from '../i18n/fr.js';
import { has, lang, t } from '../i18n/index.js';
import { capture, listInbox, settleInboxItem } from '../inbox/inbox.js';
import { loadBundleFor } from '../kb/bundle.js';
import { buildGraph, neighbours } from '../kb/graph.js';
import { categorise, loadCategories, templateCategories } from '../categories/categories.js';
import { parseOkf } from '../okf/document.js';
import { archiveKb, foreignNotes, listKbs, readOwner, writeOwner } from '../kb/registry.js';
import { claudeState, installClaudePlugin, installLauncher, launcherState, obsidianInstalled, obsidianUrl, openExternal, productVersion, updateProduct } from '../integrations/system.js';
import { maintain } from '../maintain/maintain.js';
import { buildNavigation } from '../nav/nav.js';
import { ask } from '../pipeline/ask.js';
import { prepareProposal } from '../pipeline/ingest.js';
import { unifiedDiff } from '../proposal/diff.js';
import { proposeFiles } from '../proposal/files.js';
import { groupChangesByPath, materializeFile } from '../proposal/materialize.js';
import { resolveSelection } from '../proposal/model.js';
import { loadProposal, saveProposal, updateProposalStatus } from '../proposal/store.js';
import { readSettings, writeSetting } from '../settings/settings.js';
import { draftSkill, writeSkillDraft } from '../skillify/skillify.js';
import { acquire, extractSource } from '../sources/registry.js';
import { ensureState, statePaths } from '../state/paths.js';
import { computeStatus, gitState, health, proposalSummaries, proposalTitle, receipts } from '../status/status.js';
import { renderBrief } from '../style/brief.js';
import { resolveStyle } from '../style/resolve.js';
import { switchProfile } from '../setup/setup.js';
import { defaultAnswers, runWizard, suggestedRoot, wizardContext, checkFolder, type WizardAnswers } from '../setup/wizard.js';
import { loadTemplates, pick } from '../templates/registry.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath } from '../util/paths.js';
import { weeklyReport } from '../weekly/weekly.js';
import { confirmPresence, presenceMethod } from './presence.js';
import { renderMarkdown } from './render.js';

export type ApiContext = {
  readonly env: NodeJS.ProcessEnv;
  /** Null before the first KB exists: only the setup wizard works then. */
  readonly defaultConfig: OkbConfig | null;
  readonly token: string;
};
type Query = URLSearchParams;
type Body = Record<string, unknown>;
export type Handler = (ctx: ApiContext, q: Query, body: Body) => Promise<unknown>;

/** The KB a request is about: `kb` when given, else the KB the server started with. */
async function kbConfig(ctx: ApiContext, kb: unknown): Promise<OkbConfig> {
  const id = typeof kb === 'string' && kb ? kb : ctx.defaultConfig?.profile.id;
  if (!id) throw new OkbError('E_CONFIG', 'no KB yet', { key: 'noKbYet' });
  // Read on every request: a setting changed here or in the terminal applies at once.
  const { config } = await loadConfig({ env: ctx.env, profileId: id });
  await ensureState(statePaths(config));
  return config;
}
const str = (v: unknown, name: string, max = 20_000): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new OkbError('E_INVALID', `${name} is required`);
  return v;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);

function catalog(): Record<string, string> {
  return { ...EN, ...(lang() === 'fr' ? FR : {}) } as Record<string, string>;
}

async function proposalDetail(config: OkbConfig, id: string) {
  const bundle = await loadBundleFor(config);
  const proposal = await loadProposal(config, id);
  const done = proposal.status === 'applied' || proposal.status === 'partially-applied';
  const guard = done || proposal.status === 'superseded' ? { ok: true, violations: [] } : await guardApply(config, proposal, proposal.changes);
  for (const path of guard.ok && !done ? new Set(proposal.changes.map((c) => c.path)) : []) {
    const text = bundle.snapshot.files.get(path);
    if ((text === undefined ? null : sha256(text)) !== proposal.baseline[path]) throw new OkbError('E_STALE', 'The KB changed while loading the preview.', { key: 'staleFile', params: { path } });
  }
  const cx = await categoryContext(config);
  const files = guard.ok && !done && proposal.status === 'prepared' ? await Promise.all([...groupChangesByPath(proposal.changes)].map(async ([path, changes]) => {
    const before = bundle.snapshot.files.get(path) ?? null;
    const after = materializeFile(path, before, changes);
    const diff = unifiedDiff(before ?? '', after, { path });
    return { path, created: before === null, after, html: await renderMarkdown(after, path), diff: diff.text, stats: diff.stats, changeIds: changes.map((c) => c.id), category: changes[0]!.category, noteCategory: categoryOfText(path, after, cx) };
  })) : [];
  const number = (await proposalSummaries(config)).find((p) => p.id === proposal.id)?.number ?? null;
  return {
    id: proposal.id, number, title: proposalTitle(proposal), status: proposal.status, createdAt: proposal.createdAt, contentHash: proposal.contentHash,
    notes: proposal.notes, contradictions: proposal.contradictions, guard, files,
    evidence: proposal.evidence.slice(0, 300).map((e) => ({ id: e.id, quote: e.quote, locator: e.locator, kind: e.claimKind })),
    changes: proposal.changes.map((c) => ({ id: c.id, path: c.path, label: c.label, category: c.category, dependsOn: c.dependsOn })),
    categories: cx.categories,
    approvalCommand: `okb review ${number ?? proposal.id}${config.profile.id !== '' ? ` --kb ${config.profile.id}` : ''}`,
  };
}

/** The KB's categories and its templates, the inputs of every category decision. */
async function categoryContext(config: OkbConfig) {
  const [categories, templates] = await Promise.all([loadCategories(config), loadTemplates(config)]);
  return { categories, templates, byTemplate: templateCategories(templates) };
}

/** Category of a note's text (for proposals: the note as it will be written). */
function categoryOfText(path: string, text: string, cx: Awaited<ReturnType<typeof categoryContext>>): string {
  try {
    const doc = parseOkf(path, text);
    const ext = (doc.data.x_okb ?? {}) as { template?: unknown; category?: unknown };
    return categorise({ path, type: doc.data.type, template: ext.template, explicit: ext.category }, cx.categories, cx.byTemplate).category;
  } catch {
    return 'other';
  }
}

export const ROUTES: Record<string, Handler> = {
  /* ---------- session ---------- */
  'GET /api/session': async (ctx) => ({
    token: ctx.token, ui: lang(), version: await productVersion(), kbs: await listKbs(ctx.env), active: ctx.defaultConfig?.profile.id ?? null,
    presence: presenceMethod(), obsidian: await obsidianInstalled(),
  }),
  'GET /api/i18n': async () => ({ lang: lang(), messages: catalog() }),

  /* ---------- reading ---------- */
  /** The repositories documented in this KB, with where each stands. */
  'GET /api/repos': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const { listRepos } = await import('../repo/registry.js');
    const { repoContext } = await import('../repo/notes.js');
    const { repoStatus } = await import('../repo/status.js');
    const { loadMap } = await import('../repo/state.js');
    const bundle = await loadBundleFor(config);
    const repos = (await listRepos(ctx.env)).filter((r) => r.kb === config.profile.id);
    const out = [];
    for (const repo of repos) {
      const rctx = await repoContext(config, repo);
      const [status, map] = await Promise.all([repoStatus(rctx, { bundle }), loadMap(rctx.paths)]);
      out.push({ ...repo, description: map?.repo.description ?? null, stack: map?.stack.slice(0, 5).map((x) => x.label) ?? [], status });
    }
    return { repos: out, kbConfidential: config.kb.confidential };
  },
  'GET /api/repo': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const { findRepo } = await import('../repo/registry.js');
    const { repoContext } = await import('../repo/notes.js');
    const { repoStatus, freshness } = await import('../repo/status.js');
    const { loadMap } = await import('../repo/state.js');
    const { questionById } = await import('../repo/questions.js');
    const { askWho, riskText, landscapeNote } = await import('../repo/generated.js');
    const { compact } = await import('../cli/commands/repo.js');
    const { notePath, PACK } = await import('../repo/pack.js');
    const repo = await findRepo(q.get('id') ?? '', ctx.env);
    if (!repo || repo.kb !== config.profile.id) throw new OkbError('E_NOT_FOUND', 'repository not found in this KB', { key: 'repoUnknown', params: { id: q.get('id') ?? '' } });
    const rctx = await repoContext(config, repo);
    const bundle = await loadBundleFor(config);
    const [status, map, fresh] = await Promise.all([repoStatus(rctx, { bundle }), loadMap(rctx.paths), freshness(rctx, { bundle })]);
    const writing = config.writing.language ?? config.profile.answer.language;
    const questions = status.questions.map((v) => {
      const def = questionById(v.id)!;
      const hint = map?.questions.find((x) => x.id === v.id);
      const files = v.looked?.length ? v.looked : hint?.hints.map((x) => x.file) ?? [];
      return { ...v, text: pick(def.text, writing), why: v.why ?? pick(def.why, writing), target: notePath(repo.id, def.note, writing), askWho: v.askWho ?? (map ? askWho(map, files, writing) : null), hints: hint?.hints.slice(0, 4) ?? [] };
    });
    const landscape = await landscapeNote(config).catch(() => null);
    const mermaid = landscape && landscape.repos.length > 1 ? /```mermaid\n([\s\S]*?)```/.exec(landscape.content)?.[1] ?? null : null;
    const home = ctx.env.HOME ?? '';
    return {
      repo: { ...repo, displayPath: home && repo.path.startsWith(`${home}/`) ? `~${repo.path.slice(home.length)}` : repo.path }, status, freshness: fresh, questions,
      map: map ? compact(map) : null,
      risks: map ? map.risks.map((r) => ({ kind: r.kind, text: riskText(r, writing) })) : [],
      pack: PACK.map((p) => ({ kind: p.kind, emoji: p.emoji, path: notePath(repo.id, p.kind, writing), title: bundle.byPath.get(notePath(repo.id, p.kind, writing))?.title ?? null })),
      landscape: mermaid,
    };
  },
  'GET /api/status': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const s = await computeStatus(config);
    return { ...s, name: config.profile.displayName || config.profile.id };
  },
  'GET /api/notes': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const [bundle, cx] = await Promise.all([loadBundleFor(config), categoryContext(config)]);
    const category = (e: { path: string; type: string; ext: { template?: unknown; category?: unknown } }) => categorise({ path: e.path, type: e.type, template: e.ext.template, explicit: e.ext.category }, cx.categories, cx.byTemplate).category;
    return {
      root: config.kb.root,
      categories: cx.categories,
      notes: bundle.entries.filter((e) => !e.reserved || e.path === 'index.md').map((e) => ({ path: e.path, title: e.title, description: e.description, type: e.type, status: e.status, category: e.reserved ? 'other' : category(e) })),
    };
  },
  /** Every note and every link between notes, coloured by category: the graph view. */
  'GET /api/graph': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const [bundle, cx] = await Promise.all([loadBundleFor(config), categoryContext(config)]);
    return buildGraph(bundle, cx.categories, cx.templates, { includeNav: q.get('nav') === '1' });
  },
  'GET /api/categories': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const [bundle, cx] = await Promise.all([loadBundleFor(config), categoryContext(config)]);
    const graph = buildGraph(bundle, cx.categories, cx.templates);
    const writing = config.writing.language ?? config.profile.answer.language;
    return {
      categories: graph.categories.map((c) => ({
        ...c,
        templates: cx.templates.filter((t) => (cx.byTemplate.get(t.id) ?? cx.categories.find((x) => x.templates.includes(t.id))?.id) === c.id).map((t) => ({ id: t.id, label: pick(t.label, writing), folder: t.folder })),
      })),
      uncategorized: graph.nodes.filter((n) => n.category === 'other').map((n) => ({ path: n.id, title: n.title })).slice(0, 50),
    };
  },
  'GET /api/note': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const path = asBundlePath(q.get('path') ?? '');
    const [bundle, cx] = await Promise.all([loadBundleFor(config), categoryContext(config)]);
    const doc = bundle.docs.get(path);
    const entry = bundle.byPath.get(path);
    if (!doc || !entry) throw new OkbError('E_NOT_FOUND', 'Note not found in this bundle.');
    const graph = buildGraph(bundle, cx.categories, cx.templates, { includeNav: entry.reserved });
    const { incoming, outgoing } = neighbours(graph, path);
    const pickNode = (n: { id: string; title: string; category: string }) => ({ path: n.id, title: n.title, category: n.category });
    return {
      path, title: entry.title, type: entry.type, status: entry.status, description: entry.description,
      category: graph.nodes.find((n) => n.id === path)?.category ?? 'other',
      sources: Array.isArray((doc.data as { sources?: unknown[] }).sources) ? (doc.data as { sources: unknown[] }).sources.length : 0,
      html: await renderMarkdown(doc.raw, path), raw: doc.raw,
      backlinks: incoming.map(pickNode).slice(0, 60), outlinks: outgoing.map(pickNode).slice(0, 60),
      obsidian: obsidianUrl(resolve(config.kb.root, path)),
    };
  },
  'GET /api/search': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const query = (q.get('q') ?? '').trim();
    if (!query || query.length > 500) throw new OkbError('E_INVALID', 'Enter a question of 1–500 characters.');
    const [result, bundle, cx] = await Promise.all([ask(config, query, { limit: 20 }), loadBundleFor(config), categoryContext(config)]);
    const withCategory = (path: string) => {
      const e = bundle.byPath.get(asBundlePath(path));
      return e ? categorise({ path, type: e.type, template: e.ext.template, explicit: (e.ext as { category?: unknown }).category }, cx.categories, cx.byTemplate).category : 'other';
    };
    return { ...result, hits: result.hits.map((h) => ({ ...h, noteCategory: withCategory(h.path) })) };
  },
  'GET /api/proposals': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    return { proposals: await proposalSummaries(config, { all: q.get('all') === '1' }) };
  },
  'GET /api/proposal': async (ctx, q) => proposalDetail(await kbConfig(ctx, q.get('kb')), q.get('id') ?? ''),
  'GET /api/receipts': async (ctx, q) => ({ receipts: (await receipts(await kbConfig(ctx, q.get('kb')))).filter((r) => r.sameKb) }),
  'GET /api/inbox': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const { readTextIfExists } = await import('../util/fsx.js');
    const items = await listInbox(config, { statuses: q.get('all') === '1' ? ['open', 'done', 'dropped'] : ['open'] });
    return { items: await Promise.all(items.map(async (i) => ({ ...i, text: ((await readTextIfExists(i.path)) ?? '').replace(/^---\n[\s\S]*?\n---\n/, '').trim() }))) };
  },
  'GET /api/focus': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const state = await readFocus(config);
    const { readTextIfExists } = await import('../util/fsx.js');
    const raw = (await readTextIfExists(state.path)) ?? '';
    return { ...state, raw, html: state.exists ? await renderMarkdown(raw, 'focus.md') : '', journal: focusPaths(config).journal };
  },
  'GET /api/journal': async (ctx, q) => ({ sessions: await sessionsSince(await kbConfig(ctx, q.get('kb')), new Date(0)) }),
  'GET /api/weekly': async (ctx, q) => weeklyReport(await kbConfig(ctx, q.get('kb')), { days: Number(q.get('days') ?? 7) || 7 }),
  'GET /api/health': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const report = await maintain(config, { checkSources: q.get('sources') === '1' });
    const issues = [
      ...report.okfFindings.map((f) => ({ level: f.level, code: f.code, where: f.path, message: f.message })),
      ...report.linkIssues.map((i) => ({ level: i.level, code: i.code, where: `${i.file}:${i.line}`, message: i.message })),
      ...report.issues.map((i) => ({ level: i.level, code: i.code, where: i.path, message: i.message })),
    ];
    const codes = [...new Set(issues.map((i) => i.code))].map((code) => ({
      code, title: has(`issue.${code}.title`) ? t(`issue.${code}.title`) : code, why: has(`issue.${code}.why`) ? t(`issue.${code}.why`) : '', fix: has(`issue.${code}.fix`) ? t(`issue.${code}.fix`) : '',
      items: issues.filter((i) => i.code === code),
    }));
    return { scanned: report.scanned, okf: report.okfConformant, health: health(report), groups: codes };
  },
  'GET /api/settings': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    return { kb: config.profile.id, settings: (await readSettings(config.profile.id, ctx.env)).map((v) => ({ key: v.def.key, group: v.def.group, type: v.def.type, options: v.def.options ?? [], recommended: v.def.recommended ?? null, value: v.value, isDefault: v.isDefault, scope: v.def.scope })) };
  },
  'GET /api/templates': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const language = config.profile.answer.language;
    const style = resolveStyle(config);
    const cx = await categoryContext(config);
    return {
      categories: cx.categories,
      templates: cx.templates.map((tp) => ({ id: tp.id, category: cx.byTemplate.get(tp.id) ?? cx.categories.find((c) => c.templates.includes(tp.id))?.id ?? 'other', label: pick(tp.label, language), when: pick(tp.when, language), folder: tp.folder, sections: tp.sections.map((s) => ({ emoji: s.emoji, heading: pick(s.heading, language), required: s.required, guide: pick(s.guide, language) })) })),
      style: style.style, reader: style.reader, conceptAssist: style.conceptAssist, brief: renderBrief(style),
    };
  },
  'GET /api/doctor': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const report = await doctor(config);
    const claude = await claudeState();
    const launcher = await launcherState();
    const owner = await readOwner(config.kb.root);
    const foreign = owner ? [] : await foreignNotes(config.kb.root, 1);
    const focus = await readFocus(config);
    const git = await gitState(config.kb.root);
    const version = await productVersion();
    const checks = [
      ...report.checks.map((c) => ({ name: c.name, status: c.status, detail: c.hint ? `${c.detail} — ${c.hint}` : c.detail, fix: null as string | null })),
      { name: 'claude-plugin', status: !claude.cli ? 'unknown' : claude.installed && (!claude.version || claude.version === version) ? 'ok' : 'warn', detail: !claude.cli ? t('doctor.noClaude') : claude.installed ? t('doctor.pluginOk', { version: claude.version ?? '?' }) : t('doctor.pluginMissing'), fix: claude.cli && (!claude.installed || claude.version !== version) ? 'plugin' : null },
      { name: 'okb-command', status: launcher.onPath ? 'ok' : 'warn', detail: launcher.onPath ?? t('doctor.noLauncher'), fix: !launcher.onPath && launcher.candidates[0] ? 'launcher' : null },
      { name: 'kb-owner', status: owner === config.profile.id ? 'ok' : owner ? 'fail' : 'warn', detail: owner === config.profile.id ? t('doctor.ownerOk') : owner ? t('err.kbOtherOwner.why', { owner, root: config.kb.root }) : foreign.length ? t('doctor.ownerForeign') : t('doctor.ownerMissing'), fix: !owner && !foreign.length ? 'owner' : null },
      { name: 'focus', status: focus.exists ? (focus.stale ? 'warn' : 'ok') : 'warn', detail: focus.exists ? focus.path : t('focus.none'), fix: focus.exists ? null : 'focus' },
      { name: 'kb-git', status: git.repo ? (git.dirty || (git.ahead ?? 0) > 0 ? 'warn' : 'ok') : 'unknown', detail: git.repo ? (git.dirty ? `${git.dirty} ✎` : (git.ahead ?? 0) > 0 ? `${git.ahead} ↑` : t('status.gitClean')) : t('doctor.noGit'), fix: null },
    ];
    return { checks: checks.map((c) => ({ ...c, label: has(`doctor.check.${c.name}`) ? t(`doctor.check.${c.name}`) : c.name })), support: report.support, version };
  },
  'GET /api/cards': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const bundle = await loadBundleFor(config);
    const prefix = `${config.kb.layout.concepts}/`;
    return { cards: bundle.entries.filter((e) => e.path.startsWith(prefix) && !e.reserved).map((e) => ({ path: e.path, title: e.title, definition: e.description })) };
  },
  'GET /api/skillify': async (ctx, q) => {
    const config = await kbConfig(ctx, q.get('kb'));
    const path = q.get('path');
    if (!path) {
      const bundle = await loadBundleFor(config);
      return { candidates: bundle.entries.filter((e) => ['Runbook', 'Process', 'Automation'].includes(e.type)).map((e) => ({ path: e.path, title: e.title, type: e.type })) };
    }
    return { draft: await draftSkill(config, path) };
  },
  'GET /api/wizard': async (ctx) => {
    const wctx = await wizardContext(ctx.env);
    return { context: wctx, defaults: defaultAnswers(wctx, t('wiz.name.default'), lang()) };
  },
  'GET /api/wizard/folder': async (ctx, q) => {
    const name = q.get('name') ?? '';
    const wctx = await wizardContext(ctx.env, { github: false });
    const root = q.get('root') ? resolve(expandHome(q.get('root')!.trim())) : suggestedRoot(wctx, name, lang());
    const { kbNames } = await import('../kb/registry.js');
    return { root, names: kbNames(name), check: await checkFolder(root, kbNames(name).id, ctx.env) };
  },
  'GET /api/explain': async (_ctx, q) => {
    const code = (q.get('code') ?? '').toUpperCase();
    const base = code.startsWith('E_') ? `code.${code}` : `issue.${code}`;
    if (!has(`${base}.title`)) throw new OkbError('E_NOT_FOUND', 'unknown code');
    return { code, title: t(`${base}.title`), explain: has(`${base}.explain`) ? t(`${base}.explain`) : t(`${base}.why`), fix: has(`${base}.fix`) ? t(`${base}.fix`) : '' };
  },

  /* ---------- actions ---------- */
  'POST /api/kb/switch': async (ctx, _q, b) => { await switchProfile(str(b.id, 'id', 80), { env: ctx.env }); return { ok: true, active: b.id }; },
  'POST /api/kb/archive': async (ctx, _q, b) => ({ ok: true, archived: await archiveKb(str(b.id, 'id', 80), ctx.env) }),
  'POST /api/kb/adopt': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const owner = await readOwner(config.kb.root);
    if (owner && owner !== config.profile.id) throw new OkbError('E_CONFLICT', 'owned by another KB', { key: 'kbOtherOwner', params: { owner, root: config.kb.root } });
    await writeOwner(config.kb.root, config.profile.id);
    return { ok: true };
  },
  'POST /api/wizard': async (ctx, _q, b) => {
    const steps: unknown[] = [];
    const raw = b.answers;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OkbError('E_INVALID', 'answers are required');
    const given = raw as Partial<WizardAnswers>;
    // "~/…" typed in the page means the person's home, as in the terminal.
    const answers = { ...given, name: str(given.name, 'name', 80), root: resolve(expandHome(str(given.root, 'root', 1000).trim())) } as WizardAnswers;
    const created = await runWizard(answers, (r) => steps.push(r), ctx.env);
    const { resolveLanguage, setLanguage } = await import('../i18n/index.js');
    setLanguage(resolveLanguage(ctx.env));
    return { ok: true, ...created, steps };
  },
  'POST /api/settings': async (ctx, _q, b) => {
    const key = str(b.key, 'key', 80);
    if (key === 'ui.language') {
      const { setUiLanguage } = await import('../kb/registry.js');
      const { resolveLanguage, setLanguage } = await import('../i18n/index.js');
      const value = b.value === 'fr' || b.value === 'en' ? b.value : 'auto';
      await setUiLanguage(value, ctx.env);
      setLanguage(resolveLanguage(ctx.env));
      return { ok: true, value };
    }
    const config = await kbConfig(ctx, b.kb);
    return { ok: true, value: await writeSetting(config.profile.id, key, b.value, ctx.env) };
  },
  'POST /api/capture': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const item = await capture(config, { text: str(b.text, 'text'), ...(typeof b.title === 'string' && b.title ? { title: b.title } : {}), ...(typeof b.source === 'string' && b.source ? { source: b.source } : {}), tags: list(b.tags) });
    return { ok: true, item: { ...item, path: undefined } };
  },
  'POST /api/inbox/settle': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const status = b.status === 'done' ? 'done' : 'dropped';
    const item = await settleInboxItem(config, str(b.id, 'id', 80), status, { ...(typeof b.reason === 'string' && b.reason ? { reason: b.reason } : {}) });
    return { ok: true, item: { ...item, path: undefined } };
  },
  'POST /api/focus': async (ctx, _q, b) => ({ ok: true, ...(await setFocus(await kbConfig(ctx, b.kb), str(b.text, 'text'))) }),
  'POST /api/focus/init': async (ctx, _q, b) => ({ ok: true, path: await initFocus(await kbConfig(ctx, b.kb)) }),
  'POST /api/done': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const record = await recordSession(config, { summary: str(b.summary, 'summary', 2000), did: list(b.did), decided: list(b.decided), keep: list(b.keep), ...(typeof b.next === 'string' && b.next.trim() ? { next: b.next } : {}) });
    return { ok: true, ...record, captured: record.captured.map((c) => ({ ...c, path: undefined })) };
  },
  'POST /api/proposal/discard': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const proposal = await loadProposal(config, str(b.id, 'id', 80));
    if (proposal.status !== 'prepared') throw new OkbError('E_CONFLICT', 'only a prepared proposal can be discarded', { key: 'discardNotPending', params: { status: t(`review.status.${proposal.status}`) } });
    await updateProposalStatus(config, proposal.id, 'superseded');
    await rm(approvalPath(config, proposal.id), { force: true });
    return { ok: true };
  },
  /**
   * The only route that signs an approval. It needs the person: a native dialog
   * on their screen (or their terminal); without it, nothing is signed.
   */
  'POST /api/proposal/approve': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const proposal = await loadProposal(config, str(b.id, 'id', 80));
    if (proposal.status !== 'prepared') throw new OkbError('E_CONFLICT', 'not pending', { key: proposal.status === 'superseded' ? 'supersededProposal' : 'alreadyApplied', params: { when: '' } });
    const requested = list(b.selection).length ? list(b.selection) : proposal.changes.map((c) => c.id);
    const { accepted } = resolveSelection(proposal, requested);
    if (!accepted.length) throw new OkbError('E_INVALID', 'empty selection');
    const files = new Set(proposal.changes.filter((c) => accepted.includes(c.id)).map((c) => c.path)).size;
    const presence = await confirmPresence(t('web.presence.message', { title: proposalTitle(proposal), files, kb: config.profile.displayName || config.profile.id }), { approve: t('web.presence.approve'), cancel: t('web.presence.cancel'), title: 'OKB' });
    if (presence !== 'confirmed') return { ok: false, presence };
    await grantApproval(config, proposal, accepted, config.profile.humanActor);
    if (b.apply === false) return { ok: true, presence, applied: false };
    const receipt = await applyProposal(config, proposal, accepted.length < proposal.changes.length ? { only: accepted } : {});
    const written = receipt.results.filter((r) => r.action !== 'skipped').map((r) => r.path);
    const git = await commitKbChanges(config, written, `okb: apply ${proposal.id} (${written.length} file(s))\n\n${proposalTitle(proposal)}\nReceipt: ${receipt.id}`);
    return { ok: true, presence, applied: true, receipt: { id: receipt.id, results: receipt.results }, git };
  },
  'POST /api/proposal/apply': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const proposal = await loadProposal(config, str(b.id, 'id', 80));
    const receipt = await applyProposal(config, proposal);
    const written = receipt.results.filter((r) => r.action !== 'skipped').map((r) => r.path);
    const git = await commitKbChanges(config, written, `okb: apply ${proposal.id} (${written.length} file(s))\n\n${proposalTitle(proposal)}\nReceipt: ${receipt.id}`);
    return { ok: true, receipt: { id: receipt.id, results: receipt.results }, git };
  },
  'POST /api/undo': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const id = str(b.receipt, 'receipt', 120);
    const restored = await rollback(config, id);
    const git = await commitKbChanges(config, restored.map((r) => r.path), `okb: roll back ${id}\n\n${restored.length} file(s) restored.`);
    return { ok: true, restored, git };
  },
  'POST /api/nav': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const bundle = await loadBundleFor(config);
    const files = await buildNavigation(config, { bundle });
    const changed = files.filter((f) => f.status !== 'current');
    if (!changed.length) return { ok: true, proposalId: null };
    const proposal = proposeFiles(config, bundle, new Map(changed.map((f) => [f.path, f.content])), 'navigation refresh');
    await saveProposal(config, proposal);
    return { ok: true, proposalId: proposal.id };
  },
  'POST /api/skillify': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const draft = await draftSkill(config, str(b.path, 'path', 500), { ...(typeof b.name === 'string' && b.name ? { name: b.name } : {}) });
    return { ok: true, path: await writeSkillDraft(config, draft, resolve(str(b.dir, 'dir', 1000)), { force: b.force === true }) };
  },
  'POST /api/open': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const path = typeof b.path === 'string' && b.path ? resolve(config.kb.root, asBundlePath(b.path)) : config.kb.root;
    const url = (await obsidianInstalled()) ? obsidianUrl(path) : path;
    return { ok: await openExternal(url) };
  },
  'POST /api/doctor/fix': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const fix = str(b.fix, 'fix', 40);
    if (fix === 'plugin') return { ok: (await installClaudePlugin()).ok };
    if (fix === 'launcher') { const l = await launcherState(); if (!l.candidates[0]) return { ok: false }; return { ok: true, path: await installLauncher(l.candidates[0]) }; }
    if (fix === 'owner') { await writeOwner(config.kb.root, config.profile.id); return { ok: true }; }
    if (fix === 'focus') return { ok: true, path: await initFocus(config) };
    throw new OkbError('E_INVALID', 'unknown fix');
  },
  'POST /api/source': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const source = str(b.source, 'source', 2000);
    if (b.mode === 'digest') {
      const doc = await extractSource(await acquire(source, config), config);
      const target = asBundlePath(str(b.path, 'path', 300));
      const report = await prepareProposal(config, [doc], { target: { mode: 'create', path: target, title: typeof b.title === 'string' && b.title ? b.title : doc.source.title ?? 'Notes' } });
      await saveProposal(config, report.proposal);
      return { ok: true, proposalId: report.proposal.id };
    }
    const doc = await extractSource(await acquire(source, config), config);
    const item = await capture(config, { text: `${t('web.source.captureText', { source })}\n\n${doc.blocks.slice(0, 6).map((x) => x.text).join('\n\n').slice(0, 3000)}`, title: doc.source.title ?? source, source, tags: ['source'] });
    return { ok: true, item: { ...item, path: undefined }, blocks: doc.blocks.length, support: doc.source.support, claude: `/okb:ingest ${source}` };
  },
  'POST /api/categories/set': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const { proposeCategory } = await import('../categories/assign.js');
    const proposal = await proposeCategory(config, str(b.path, 'path', 500), str(b.category, 'category', 60));
    await saveProposal(config, proposal);
    return { ok: true, proposalId: proposal.id };
  },
  'POST /api/repos/scan': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const { findRepo } = await import('../repo/registry.js');
    const { scanAndStore } = await import('../repo/scan.js');
    const repo = await findRepo(str(b.id, 'id', 120), ctx.env);
    if (!repo || repo.kb !== config.profile.id) throw new OkbError('E_NOT_FOUND', 'repository not found in this KB', { key: 'repoUnknown', params: { id: String(b.id) } });
    const { map } = await scanAndStore(config, repo);
    return { ok: true, head: map.repo.head, files: map.files.total };
  },
  'POST /api/repos/answer': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const { findRepo } = await import('../repo/registry.js');
    const { recordAnswer, repoContext } = await import('../repo/notes.js');
    const repo = await findRepo(str(b.id, 'id', 120), ctx.env);
    if (!repo || repo.kb !== config.profile.id) throw new OkbError('E_NOT_FOUND', 'repository not found in this KB', { key: 'repoUnknown', params: { id: String(b.id) } });
    const by = typeof b.by === 'string' && b.by.trim() ? b.by.trim().slice(0, 80) : config.profile.humanActor.replace(/^human:/, '');
    const result = await recordAnswer(await repoContext(config, repo), { ...(typeof b.question === 'string' && b.question ? { question: b.question } : {}), text: str(b.text, 'text', 8000), by });
    return { ok: true, question: result.question };
  },
  'POST /api/repos/questions': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const { findRepo } = await import('../repo/registry.js');
    const { repoContext } = await import('../repo/notes.js');
    const { proposeQuestionsNote } = await import('../repo/generated.js');
    const repo = await findRepo(str(b.id, 'id', 120), ctx.env);
    if (!repo || repo.kb !== config.profile.id) throw new OkbError('E_NOT_FOUND', 'repository not found in this KB', { key: 'repoUnknown', params: { id: String(b.id) } });
    const proposal = await proposeQuestionsNote(await repoContext(config, repo));
    if (!proposal.changes.length) return { ok: true, proposalId: null };
    await saveProposal(config, proposal);
    return { ok: true, proposalId: proposal.id };
  },
  'POST /api/repos/landscape': async (ctx, _q, b) => {
    const config = await kbConfig(ctx, b.kb);
    const { proposeLandscape } = await import('../repo/generated.js');
    const proposal = await proposeLandscape(config);
    if (!proposal?.changes.length) return { ok: true, proposalId: null };
    await saveProposal(config, proposal);
    return { ok: true, proposalId: proposal.id };
  },
  'POST /api/update': async () => {
    const steps: { step: string; ok: boolean; detail?: string }[] = [];
    const ok = await updateProduct((step, okStep, detail) => steps.push({ step, ok: okStep, ...(detail ? { detail } : {}) }));
    return { ok, steps, version: await productVersion() };
  },
  'POST /api/tour': async () => {
    const { tourScenario } = await import('../cli/commands/tour.js');
    const steps: unknown[] = [];
    await tourScenario({ step: (s) => steps.push(s), pause: async () => true });
    return { ok: true, steps };
  },
};

export const MUTATING = new Set(Object.keys(ROUTES).filter((k) => k.startsWith('POST ')));
export function routeFor(method: string, pathname: string): Handler | undefined {
  return ROUTES[`${method} ${pathname}`];
}
