import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brainGraph } from '../brain/graph.js';
import { checkIntegrity } from '../brain/integrity.js';
import { layoutOf } from '../brain/layout.js';
import { listBackups, runBackup, verifyBackup } from '../brain/backup.js';
import { noteHistory, readVersion, trash } from '../brain/history.js';
import { addWaiting, nowView, renderNow, resolveWaiting, setObjective } from '../brain/now.js';
import { listProducts } from '../brain/products.js';
import { hubOf, positionOf } from '../brain/tree.js';
import { brainShape, glossary, subjectIndex } from '../brain/views.js';
import type { OkbConfig } from '../config/schema.js';
import { findNotes, knowledgeGaps, recordEmpty } from '../find/find.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { noteEvent, scoreBundle, type NoteScore } from '../scores/scores.js';
import { dailyBudget, loadQueue, setStatus, spentToday } from '../suggest/suggest.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { renderMarkdown } from './render.js';
import { dueCards, gradeCard, listObjectives, parseRating, skillsMap } from '../learn/learn.js';
import { careerLeaks, careerStatus } from '../career/career.js';

/**
 * The web app's view of a brain: its drawers and subjects, « Maintenant », the
 * search, the suggestion cards, the scores, the storage (history, trash,
 * backups). Reading only, except the person's own acts (a card accepted or
 * declined, an objective, a backup they start).
 */
type Q = URLSearchParams;
type B = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { env: NodeJS.ProcessEnv } & Record<string, any>;
type KbConfig = (ctx: any, kb: unknown) => Promise<OkbConfig>;

const scoreCache = new Map<string, { key: string; scores: Map<string, NoteScore> }>();

/**
 * Scores of every note, computed once per version of what they depend on
 * (F2.0-35): every note's content, what the person did with the notes (read,
 * cited, rated: the events file) and the day (a note ages, a new one grows).
 */
export async function scoresFor(config: OkbConfig, bundle: Bundle): Promise<Map<string, NoteScore>> {
  const events = await stat(resolve(statePaths(config).root, 'usage', 'notes.jsonl')).catch(() => null);
  const key = sha256([
    ...bundle.entries.map((e) => `${e.path}\u0000${e.sha256}`),
    `events\u0000${events ? `${events.size}:${events.mtimeMs}` : 'none'}`,
    `day\u0000${new Date().toISOString().slice(0, 10)}`,
  ].join('\n'));
  const hit = scoreCache.get(config.kb.root);
  if (hit && hit.key === key) return hit.scores;
  const scores = new Map((await scoreBundle(config, bundle)).map((s) => [s.path as string, s]));
  scoreCache.set(config.kb.root, { key, scores });
  return scores;
}

/** The breadcrumb of a note, each step with the subject's page when it exists. */
export function crumbsOf(config: OkbConfig, bundle: Bundle, path: BundlePath): { title: string; path: string | null }[] {
  const layout = layoutOf(config);
  if (!layout) return [];
  const pos = positionOf(layout, path);
  if (!pos.drawer) return [];
  const parts = path.split('/');
  const out: { title: string; path: string | null }[] = [];
  for (let i = 1; i < parts.length; i++) {
    const hub = hubOf(parts.slice(0, i).join('/'));
    out.push({ title: pos.crumbs[i - 1] ?? parts[i - 1]!, path: hub && bundle.byPath.has(hub) && hub !== path ? hub : null });
  }
  return out;
}

export function brainRoutes(kbConfig: KbConfig): Record<string, (ctx: Ctx, q: Q, b: B) => Promise<unknown>> {
  return {
    'GET /api/brain': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const layout = layoutOf(config);
      const bundle = await loadBundleFor(config);
      const queue = await loadQueue(config);
      const now = await nowView(config, bundle, {});
      const lang = layout?.lang ?? ((config.writing.language ?? config.profile.answer.language).startsWith('fr') ? 'fr' : 'en');
      return {
        brain: layout ? { preset: layout.preset, names: layout.lang } : null,
        name: config.profile.displayName || config.profile.id,
        shape: layout ? brainShape(layout, bundle) : null,
        products: await listProducts(config, ctx.env),
        now, nowText: renderNow(now, lang),
        suggestions: queue.filter((s) => s.status === 'pending' || s.status === 'later').length,
        backups: (await listBackups(config, ctx.env).catch(() => [])).slice(0, 1),
      };
    },
    'GET /api/brain/index': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const bundle = await loadBundleFor(config);
      const folder = (q.get('folder') ?? '').replace(/\/+$/, '');
      const index = subjectIndex(bundle, folder);
      const scores = await scoresFor(config, bundle);
      return {
        ...index,
        crumbs: folder ? crumbsOf(config, bundle, asBundlePath(`${folder}/__.md`)) : [],
        hubHtml: index.hub ? await renderMarkdown(bundle.docs.get(index.hub)!.raw, index.hub) : null,
        stars: Object.fromEntries(index.items.map((i) => [i.path, scores.get(i.path)?.stars ?? null])),
      };
    },
    'GET /api/brain/graph': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const layout = layoutOf(config);
      if (!layout) return { nodes: [], edges: [], focus: '', crumbs: [] };
      return brainGraph(layout, await loadBundleFor(config), q.get('focus') ?? '');
    },
    'GET /api/find': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const query = (q.get('q') ?? '').trim();
      if (query.length > 300) throw new OkbError('E_INVALID', 'Enter 1–300 characters.');
      const bundle = await loadBundleFor(config);
      const scores = await scoresFor(config, bundle);
      const result = findNotes(config, bundle, query, {
        limit: Number(q.get('limit') ?? 30),
        ...(q.get('drawer') ? { drawer: q.get('drawer')! } : {}), ...(q.get('product') ? { product: q.get('product')! } : {}),
        ...(q.get('repo') ? { repo: q.get('repo')! } : {}), ...(q.get('type') ? { type: q.get('type')! } : {}),
        scores: new Map([...scores].map(([p, s]) => [p, s.global])),
      });
      if (q.get('final') === '1') {
        if (!result.hits.length) await recordEmpty(config, query);
        for (const h of result.hits.slice(0, 3)) await noteEvent(config, h.path, 'search');
      }
      return { ...result, hits: result.hits.map((h) => ({ ...h, stars: scores.get(h.path)?.stars ?? null })) };
    },
    'GET /api/glossary': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      return { entries: glossary(layoutOf(config), await loadBundleFor(config)) };
    },
    'GET /api/suggestions': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const queue = await loadQueue(config);
      const { noteType } = await import('../brain/types.js');
      // Each card with its note category: its line colour in the web app.
      const suggestions = queue.filter((s) => q.get('all') === '1' || s.status === 'pending' || s.status === 'later').map((s) => ({ ...s, category: noteType(s.type)?.category ?? 'other' }));
      return { suggestions, budget: { daily: await dailyBudget(ctx.env), spent: await spentToday(config) }, gaps: await knowledgeGaps(config) };
    },
    // Deciding on a card in the web app is the person's own act.
    'POST /api/suggestions/decide': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const decision = String(b.decision ?? '');
      if (!['accept', 'decline', 'later'].includes(decision)) throw new OkbError('E_INVALID', 'decision must be accept, decline or later');
      const s = await setStatus(config, String(b.id ?? ''), decision === 'accept' ? 'accepted' : decision === 'decline' ? 'declined' : 'later', 'person', undefined, ctx.env);
      return { ok: true, suggestion: s };
    },
    'GET /api/scores': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const all = [...(await scoresFor(config, await loadBundleFor(config))).values()];
      const below = q.get('below') ? Number(q.get('below')) : null;
      return { average: all.length ? Math.round(all.reduce((n, s) => n + s.global, 0) / all.length) : 0, notes: all.length, scores: (below !== null ? all.filter((s) => s.global < below) : all).slice(0, 200) };
    },
    'POST /api/rate': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      await noteEvent(config, asBundlePath(String(b.path ?? '')), b.verdict === 'down' ? 'down' : 'up');
      scoreCache.delete(config.kb.root);
      return { ok: true };
    },
    'GET /api/history': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const path = asBundlePath(q.get('path') ?? '');
      const versions = await noteHistory(config, path);
      const n = q.get('n');
      if (n !== null) {
        const v = versions.find((x) => x.n === Number(n));
        if (!v) throw new OkbError('E_NOT_FOUND', 'no such version');
        const text = await readVersion(v);
        return { version: v, html: text ? await renderMarkdown(text, path) : null, raw: text };
      }
      return { path, versions };
    },
    'GET /api/trash': async (ctx, q) => ({ items: await trash(await kbConfig(ctx, q.get('kb'))) }),
    // Restoring a version or a deleted note prepares a proposal; the person approves it as usual.
    'POST /api/history/restore': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const path = asBundlePath(String(b.path ?? ''));
      const v = (await noteHistory(config, path)).find((x) => x.n === Number(b.n));
      const text = v ? await readVersion(v) : null;
      if (!text) throw new OkbError('E_NOT_FOUND', 'this version is no longer kept');
      const { proposeFiles } = await import('../proposal/files.js');
      const { saveProposal } = await import('../proposal/store.js');
      const proposal = proposeFiles(config, await loadBundleFor(config), new Map([[path, text]]), `restore ${path} (version ${v!.n})`);
      if (!proposal.changes.length) return { ok: true, proposalId: null };
      await saveProposal(config, proposal);
      return { ok: true, proposalId: proposal.id };
    },
    'GET /api/storage': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const bundle = await loadBundleFor(config);
      return { findings: await checkIntegrity(config, bundle, { env: ctx.env }), backups: await listBackups(config, ctx.env).catch(() => []) };
    },
    'POST /api/backup/run': async (ctx, _q, b) => ({ ...(await runBackup(await kbConfig(ctx, b.kb), { force: b.force === true, env: ctx.env })), ok: true }),
    'POST /api/backup/verify': async (ctx, _q, b) => ({ ...(await verifyBackup(await kbConfig(ctx, b.kb), typeof b.date === 'string' ? b.date : undefined, ctx.env)), ok: true }),
    'POST /api/now/objective': async (ctx, _q, b) => ({ ok: true, objective: await setObjective(await kbConfig(ctx, b.kb), typeof b.text === 'string' ? b.text : null) }),
    'POST /api/now/wait': async (ctx, _q, b) => ({ ok: true, waiting: await addWaiting(await kbConfig(ctx, b.kb), String(b.text ?? ''), String(b.who ?? '')) }),
    // Spaced review: the person grades their own answer; the state is OKB's, never the KB.
    'GET /api/learn': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const bundle = await loadBundleFor(config);
      return { ...(await dueCards(config, bundle, { limit: 20 })), map: await skillsMap(config, bundle), objectives: (await listObjectives(config)).filter((o) => !o.doneAt) };
    },
    'POST /api/learn/grade': async (ctx, _q, b) => {
      const rating = parseRating(String(b.rating ?? ''));
      if (rating === null) throw new OkbError('E_INVALID', 'rating must be again, hard, good or easy');
      return { ok: true, ...(await gradeCard(await kbConfig(ctx, b.kb), String(b.id ?? ''), rating)) };
    },
    'GET /api/career': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const bundle = await loadBundleFor(config);
      return { ...careerStatus(bundle), leaks: (await careerLeaks(config, bundle)).length };
    },
    'POST /api/now/answered': async (ctx, _q, b) => ({ ok: true, resolved: await resolveWaiting(await kbConfig(ctx, b.kb), String(b.id ?? '')) }),
  };
}
