import type { OkbConfig } from '../config/schema.js';
import { installClaudeModule } from '../integrations/system.js';
import { moduleDef, setModule, type ModuleId } from '../modules/catalog.js';
import { OkbError } from '../util/errors.js';

/**
 * The web app's routes added after 1.0: modules, the knowledge level of
 * repositories, concepts and translation. Reading, except the person's own
 * acts (a module turned on or installed, a translation they ask for).
 */
type Q = URLSearchParams;
type B = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { env: NodeJS.ProcessEnv } & Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KbConfig = (ctx: any, kb: unknown) => Promise<OkbConfig>;

function moduleId(v: unknown): ModuleId {
  if (typeof v !== 'string' || !moduleDef(v)) throw new OkbError('E_INVALID', 'unknown module', { key: 'moduleUnknown', params: { id: String(v ?? '') } });
  return v as ModuleId;
}

/** A repository of the KB by its id or its name: a brain's (linked or not), or one registered for the KB. */
async function examRepo(config: OkbConfig, wanted: unknown, env: NodeJS.ProcessEnv): Promise<{ id: string; name: string; folder: string | null }> {
  if (typeof wanted !== 'string' || !wanted) throw new OkbError('E_INVALID', 'repo is required', { key: 'usage', params: { usage: '{ repo }' } });
  const { brainRepos } = await import('../knowledge/brain-repos.js');
  const { listRepos } = await import('../repo/registry.js');
  const brain = await brainRepos(config, env);
  const registered = (await listRepos(env)).filter((r) => r.kb === config.profile.id).map((r) => ({ id: r.id, name: r.name, folder: null }));
  const found = [...brain, ...registered].find((r) => r.id === wanted || r.name === wanted);
  if (!found) throw new OkbError('E_NOT_FOUND', `no repository ${wanted} in this KB`, { key: 'repoUnknown', params: { id: wanted } });
  return { id: found.id, name: found.name, folder: found.folder };
}

export function nextRoutes(kbConfig: KbConfig): Record<string, (ctx: Ctx, q: Q, b: B) => Promise<unknown>> {
  return {
    'GET /api/modules': async (ctx) => {
      const { moduleList } = await import('../cli/commands/modules.js');
      return { modules: await moduleList(ctx.env) };
    },
    'POST /api/modules/toggle': async (ctx, _q, b) => ({ ok: true, enabled: [...(await setModule(moduleId(b.id), b.on === true, ctx.env))].sort() }),
    'POST /api/modules/install': async (_ctx, _q, b) => installClaudeModule(moduleId(b.id)),
    // « Use OKB in Claude Code »: is Claude Code here, and which OKB plugins does it have?
    'GET /api/claude': async (ctx) => {
      const { claudeState, claudeModules } = await import('../integrations/system.js');
      const state = await claudeState();
      return { cli: Boolean(state.cli), marketplace: state.marketplace, plugins: await claudeModules(ctx.env.HOME ?? '') };
    },
    'GET /api/translate/estimate': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const { estimateTranslation } = await import('../translate/translate.js');
      const { asBundlePath } = await import('../util/paths.js');
      return estimateTranslation(config, asBundlePath(q.get('path') ?? ''), q.get('lang') ?? '', q.get('scope') === 'full' ? 'full' : 'brief', ctx.env, { confirmSecret: q.get('confirmSecret') === '1' });
    },
    'POST /api/translate': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const { translateNote } = await import('../translate/translate.js');
      const { asBundlePath } = await import('../util/paths.js');
      const { renderMarkdown } = await import('./render.js');
      const path = asBundlePath(String(b.path ?? ''));
      const r = await translateNote(config, path, String(b.lang ?? ''), b.scope === 'full' ? 'full' : 'brief', ctx.env, { confirmSecret: b.confirmSecret === true });
      return { ok: true, ...r, html: await renderMarkdown(r.markdown, path) };
    },
    'POST /api/translate/save': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const { proposeTranslation } = await import('../translate/translate.js');
      const { asBundlePath } = await import('../util/paths.js');
      const proposal = await proposeTranslation(config, asBundlePath(String(b.path ?? '')), String(b.lang ?? ''));
      return { ok: true, proposalId: proposal.id, target: proposal.changes[0]?.path ?? null };
    },
    // « Ask your brain »: the passages that answer, then (on request) an answer written from them only.
    'GET /api/ask': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const question = (q.get('q') ?? '').trim().slice(0, 300);
      if (!question) return { question, passages: [], notes: [] };
      const { passagesFor } = await import('../find/answer.js');
      const { loadBundleFor } = await import('../kb/bundle.js');
      return { question, ...passagesFor(config, await loadBundleFor(config), question) };
    },
    'POST /api/ask/answer': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const question = String(b.q ?? '').trim().slice(0, 300);
      if (!question) throw new OkbError('E_INVALID', 'a question is needed', { key: 'usage', params: { usage: '{ q }' } });
      const { composeAnswer, passagesFor } = await import('../find/answer.js');
      const { loadBundleFor } = await import('../kb/bundle.js');
      const { passages } = passagesFor(config, await loadBundleFor(config), question);
      return { ok: true, passages, ...(await composeAnswer(config, question, passages, ctx.env)) };
    },
    'GET /api/progress': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const { readRootConfig } = await import('../kb/registry.js');
      const show = ((await readRootConfig(ctx.env).catch(() => ({}))) as { progress?: { show?: unknown } }).progress?.show !== false;
      if (!show) return { show: false };
      const { progress } = await import('../progress/progress.js');
      return { show: true, ...(await progress(config)) };
    },
    // The system map: computed from the scans (no AI), three views, each with its self-check.
    'GET /api/repos/arch': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const { systemOf } = await import('../arch/system.js');
      const sys = await systemOf(config);
      if (!sys) return { system: null };
      const { containersView, contextView, entryPoints, flowView } = await import('../arch/views.js');
      const { checkDiagram } = await import('../arch/check.js');
      const { model, name, lang, maps } = sys;
      const entries = entryPoints(model);
      const from = q.get('from') ? `repo:${q.get('from')!.replace(/^repo:/, '')}` : entries[0]?.repo;
      const call = q.get('call') ?? (from ? model.links.filter((l) => l.from === from && l.kind === 'http').flatMap((l) => l.calls).sort((a, b) => a.line - b.line)[0]?.what : undefined);
      const withCheck = <V extends Parameters<typeof checkDiagram>[1]>(view: V) => ({ ...view, check: checkDiagram(model, view) });
      return {
        system: name,
        model,
        entryPoints: entries,
        calls: model.links.filter((l) => l.kind === 'http').flatMap((l) => l.calls.map((c) => ({ from: l.from, call: c.what }))),
        views: {
          containers: withCheck(containersView(model, { lang })),
          context: withCheck(contextView(model, name, { lang })),
          flow: from && call ? withCheck(flowView(model, from, call, { lang })) : null,
        },
        // Where each repository's page is in the app (its registry id).
        pages: Object.fromEntries(maps.map((m) => [`repo:${m.repo.name}`, m.repo.id])),
      };
    },
    // The knowledge exam of a repository (src/knowledge/exam.ts): its plan and cost, its last result, the team's questions.
    'GET /api/repos/exam': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const repo = await examRepo(config, q.get('repo'), ctx.env);
      const exam = await import('../knowledge/exam.js');
      const [plan, last, custom] = await Promise.all([exam.planExam(config, repo, { env: ctx.env }), exam.lastExam(config, repo), exam.examQuestionsOf(config, repo)]);
      const { pickProvider } = await import('../ai/provider.js');
      return { repo: { id: repo.id, name: repo.name }, plan, last, custom, ai: Boolean(await pickProvider(ctx.env)) };
    },
    'POST /api/repos/exam': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const repo = await examRepo(config, b.repo, ctx.env);
      const { runExam } = await import('../knowledge/exam.js');
      const only = Array.isArray(b.only) ? b.only.filter((x): x is string => typeof x === 'string') : [];
      return { ok: true, exam: await runExam(config, repo, { env: ctx.env, ...(only.length ? { only } : {}) }) };
    },
    'POST /api/repos/exam/question': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const repo = await examRepo(config, b.repo, ctx.env);
      const exam = await import('../knowledge/exam.js');
      if (typeof b.remove === 'string') { await exam.removeExamQuestion(config, repo, b.remove); return { ok: true }; }
      return { ok: true, question: await exam.addExamQuestion(config, repo, String(b.text ?? ''), String(b.expected ?? '')) };
    },
    // Packs (src/packs/pack.ts): a subject's notes in one file to hand over; a received one compared, then merged by a proposal.
    'GET /api/packs/export': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const { exportPack } = await import('../packs/pack.js');
      const { loadBundleFor } = await import('../kb/bundle.js');
      return exportPack(config, await loadBundleFor(config), q.get('folder') ?? '');
    },
    'POST /api/packs/compare': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const { comparePack } = await import('../packs/pack.js');
      const { loadBundleFor } = await import('../kb/bundle.js');
      const { unifiedDiff } = await import('../proposal/diff.js');
      const { asBundlePath } = await import('../util/paths.js');
      const pack = b.pack as Parameters<typeof comparePack>[1];
      const into = typeof b.into === 'string' && b.into.trim() ? b.into.trim() : String((pack as { subject?: unknown } | null)?.subject ?? '');
      const bundle = await loadBundleFor(config);
      const diff = comparePack(bundle, pack, into);
      const local = (path: string) => bundle.snapshot.files.get(asBundlePath(`${into.replace(/\/+$/, '')}/${path}`)) ?? '';
      return {
        subject: pack.subject, exportedAt: pack.exportedAt, from: pack.from, into, skipped: pack.skipped.length,
        added: diff.added.map((n) => ({ path: n.path, title: n.title })),
        changed: diff.changed.map((n) => ({ path: n.path, title: n.title, diff: unifiedDiff(local(n.path), n.content, { path: n.path }).text })),
        same: diff.same,
      };
    },
    'POST /api/packs/merge': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const { mergePack } = await import('../packs/pack.js');
      if (typeof b.into !== 'string' || !b.into.trim()) throw new OkbError('E_INVALID', 'into is required', { key: 'usage', params: { usage: '{ pack, into }' } });
      const proposal = await mergePack(config, b.pack as Parameters<typeof mergePack>[1], b.into.trim());
      return { ok: true, proposalId: proposal.id, notes: proposal.changes.length };
    },
    'POST /api/repos/link': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      if (typeof b.folder !== 'string' || typeof b.path !== 'string' || !b.path.trim()) throw new OkbError('E_INVALID', 'folder and path are required', { key: 'usage', params: { usage: '{ folder, path }' } });
      const { linkBrainRepo } = await import('../knowledge/brain-repos.js');
      const { expandHome } = await import('../config/load.js');
      return { ok: true, repo: await linkBrainRepo(config, b.folder, expandHome(b.path.trim(), ctx.env), ctx.env) };
    },
  };
}
