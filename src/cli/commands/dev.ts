import { resolve } from 'node:path';
import { loadConfig } from '../../config/load.js';
import { changedFiles, reviewContext, shipFacts } from '../../dev/dev.js';
import { t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { repoPlace } from '../../brain/products.js';
import { findRepo, listRepos, type RepoEntry } from '../../repo/registry.js';
import { loadProgress, repoPaths } from '../../repo/state.js';
import { OkbError } from '../../util/errors.js';
import { resolveScope } from '../../work/scope.js';
import { ticketNoteIn } from '../../work/tickets.js';
import { flagList, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import type { Ctx } from './common.js';

/**
 * `okb dev review` — what a review checks first: the team's rules and review
 * lessons, the repository's conventions, the notes about each changed file and
 * the known traps. `okb dev ship` — the facts a commit message or a pull
 * request is written from: commits, files, the ticket and its journal, the
 * team's commit style and PR template. Both read; neither writes.
 */
export async function cmdDev(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0];
  if (sub === 'review' || sub === 'rules') return devReview(ctx);
  if (sub === 'ship' || sub === 'pr' || sub === 'commit') return devShip(ctx);
  throw new OkbError('E_INVALID', `unknown subcommand "${sub ?? ''}"`, { hint: 'okb dev review | ship' });
}

async function target(ctx: Ctx) {
  const cwd = resolve(flagString(ctx.args, 'cwd') ?? process.cwd());
  const scope = await resolveScope(cwd).catch(() => null);
  const named = flagString(ctx.args, 'repo');
  const repo: RepoEntry | null = named ? await findRepo(named) : scope?.repo ?? null;
  if (!repo) throw new OkbError('E_NOT_FOUND', 'no repository OKB documents here', { key: 'devNoRepo' });
  const config = scope?.repo?.id === repo.id && scope.config ? scope.config : (await loadConfig({ profileId: repo.kb })).config;
  return { repo, config, ticket: scope?.repo?.id === repo.id ? scope.ticket : null };
}

async function devReview(ctx: Ctx): Promise<number> {
  const { repo, config } = await target(ctx);
  const listed = flagList(ctx.args, 'files');
  const changed = listed.length ? { base: null, files: [] } : await changedFiles(repo.path, flagString(ctx.args, 'base'));
  const files = listed.length ? listed : changed.files.filter((f) => f.status !== 'D').map((f) => f.path);
  const bundle = await loadBundleFor(config);
  const progress = await loadProgress(repoPaths(config, repo.id)).catch(() => ({ anchors: {} }));
  const review = await reviewContext(config, bundle, { repo, files, base: changed.base, anchors: (progress as { anchors: Record<string, { files?: Record<string, unknown> }> }).anchors });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, ...review }); return 0; }
  ctx.out.line(paint.bold(t('dev.review.title', { repo: repo.name, files: String(files.length) })));
  if (!review.rules.length) ctx.out.info(t('dev.review.noRules'));
  for (const r of review.rules) ctx.out.line(`📏 ${r.title}  ${paint.dim(`${r.level} · ${r.path}`)}`);
  for (const f of review.aboutFiles) ctx.out.line(`📝 ${f.file} → ${f.notes.map((n) => n.title).join(' · ')}`);
  for (const r of review.traps) ctx.out.line(`🧯 ${r.title}  ${paint.dim(r.path)}`);
  return 0;
}

async function devShip(ctx: Ctx): Promise<number> {
  const { repo, config, ticket } = await target(ctx);
  let note: string | null = null;
  if (ticket) {
    const bundle = await loadBundleFor(config);
    const all = await listRepos();
    const places = new Map(await Promise.all(ticket.repos.map(async (r) => [r.id, await repoPlace(config, all.find((x) => x.id === r.id) ?? { id: r.id, name: r.id })] as const)));
    note = ticketNoteIn(bundle, ticket, (id) => places.get(id) ?? false);
  }
  const base = flagString(ctx.args, 'base');
  const facts = await shipFacts(repo, { ...(base ? { base } : {}), ticket, ticketNote: note });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, ...facts }); return 0; }
  ctx.out.line(paint.bold(`${repo.name} · ${facts.branch ?? '?'} ← ${facts.base ?? '?'}`));
  if (facts.ticket) ctx.out.line(`🎫 ${facts.ticket.ref} — ${facts.ticket.title}${facts.ticket.note ? paint.dim(`  ${facts.ticket.note}`) : ''}`);
  ctx.out.line(t('dev.ship.counts', { commits: String(facts.commits.length), files: String(facts.files.length) }));
  for (const c of facts.commits.slice(0, 10)) ctx.out.line(paint.dim(`   ${c.sha.slice(0, 7)} ${c.subject}`));
  ctx.out.line(t('dev.ship.style', { conventional: `${Math.round(facts.style.conventional * 100)}%`, prefix: `${Math.round(facts.style.ticketPrefix * 100)}%`, language: facts.style.language ?? '?' }));
  if (facts.prTemplate) ctx.out.line(`📋 ${facts.prTemplate.path}`);
  return 0;
}
