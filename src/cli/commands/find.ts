import { relative, resolve } from 'node:path';
import { findNotes, knownErrors, knowledgeGaps, notesAboutFile, recordEmpty } from '../../find/find.js';
import { loadConfig } from '../../config/load.js';
import { t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { repoForDir } from '../../repo/registry.js';
import { loadProgress, repoPaths } from '../../repo/state.js';
import { noteEvent } from '../../scores/scores.js';
import { invokedBy } from '../../usage/events.js';
import { OkbError } from '../../util/errors.js';
import { flagBool, flagNumber, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

/**
 * `okb find "<words>"` — the same search as the web app's ⌘K, for the person
 * and for Claude. `--file <path>`: the notes about a file of a repository.
 * `--error "<message>"`: the known errors it matches. `--gaps`: what was
 * searched for and never found.
 */
export async function cmdFind(ctx: Ctx): Promise<number> {
  const file = flagString(ctx.args, 'file');
  if (file) return aboutFile(ctx, file);
  const { config } = await effective(ctx.args);
  if (flagBool(ctx.args, 'gaps')) {
    const gaps = await knowledgeGaps(config);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, gaps });
    else if (!gaps.length) ctx.out.info(t('find.noGaps'));
    else ctx.out.grid(gaps.map((g) => [g.query, `×${g.times}`, paint.dim(g.last.slice(0, 10))]));
    return 0;
  }
  const bundle = await loadBundleFor(config);
  const error = flagString(ctx.args, 'error') ?? (flagBool(ctx.args, 'error-stdin') || (flagBool(ctx.args, 'stdin') && !ctx.args.positionals.length) ? await readStdin() : undefined);
  if (error !== undefined) {
    const hits = knownErrors(config, bundle, error);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, hits }); return 0; }
    if (!hits.length) ctx.out.info(t('find.noError'));
    for (const h of hits) ctx.out.line(`🧯 ${paint.bold(h.title)}  ${paint.dim(h.path)}`);
    return 0;
  }
  const query = ctx.args.positionals.join(' ').trim();
  if (!query) throw new OkbError('E_INVALID', 'what should OKB look for?', { key: 'findWhat' });
  const s = (k: string) => flagString(ctx.args, k);
  const result = findNotes(config, bundle, query, {
    ...(s('drawer') ? { drawer: s('drawer')! } : {}), ...(s('product') ? { product: s('product')! } : {}),
    ...(s('repo') ? { repo: s('repo')! } : {}), ...(s('type') ? { type: s('type')! } : {}), ...(s('status') ? { status: s('status')! } : {}),
    limit: flagNumber(ctx.args, 'limit') ?? 10,
    // A 🔒 note is the person's alone: a search Claude runs does not show it.
    hideSecret: invokedBy() === 'claude',
  });
  if (!result.hits.length) await recordEmpty(config, query);
  for (const h of result.hits.slice(0, 3)) await noteEvent(config, h.path, 'search');
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, ...result, ...(result.hidden ? { hiddenNote: t('find.hidden', { count: String(result.hidden) }) } : {}) }); return 0; }
  if (result.hidden) ctx.out.info(t('find.hidden', { count: String(result.hidden) }));
  if (!result.hits.length) { ctx.out.info(t('find.none', { query })); return 0; }
  for (const h of result.hits) {
    ctx.out.line(`${h === result.best ? '⭐' : h.concept ? '💡' : '📄'} ${paint.bold(h.title)}  ${paint.dim(h.crumbs.join(' › '))}`);
    ctx.out.line(paint.dim(`   ${h.snippet}`));
  }
  if (result.related.length) ctx.out.line(paint.dim(`🔗 ${result.related.map((r) => r.title).join(' · ')}`));
  return 0;
}

async function aboutFile(ctx: Ctx, file: string): Promise<number> {
  const abs = resolve(flagString(ctx.args, 'cwd') ?? process.cwd(), file);
  const found = await repoForDir(abs).catch(() => null);
  if (!found) { if (ctx.mode === 'json') ctx.out.json({ ok: true, notes: [] }); return 0; }
  const { config } = await loadConfig({ profileId: found.repo.kb });
  const bundle = await loadBundleFor(config);
  const progress = await loadProgress(repoPaths(config, found.repo.id)).catch(() => ({ anchors: {} }));
  const rel = relative(found.repo.path, abs).split('\\').join('/');
  const notes = notesAboutFile(bundle, found.repo.name, rel, (progress as { anchors: Record<string, { files?: Record<string, unknown> }> }).anchors);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, file: rel, notes }); return 0; }
  for (const n of notes) ctx.out.line(`📝 ${paint.bold(n.title)}  ${paint.dim(`${n.path} — ${n.why}`)}`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
