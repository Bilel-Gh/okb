import { readFile } from 'node:fs/promises';
import { layoutOf } from '../../brain/layout.js';
import type { OkbConfig } from '../../config/schema.js';
import { t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { noteEvent, scoreBundle } from '../../scores/scores.js';
import { hasConsent, idsFromQuestion, idsIn, isPlainYes, recordConsent } from '../../suggest/consent.js';
import { addSuggestion, buildCard, contextFor, dailyBudget, findSuggestion, renderCard, setStatus, SIGNALS, spentToday, stars, type Signal, type SuggestInput } from '../../suggest/suggest.js';
import { invokedBy } from '../../usage/events.js';
import { OkbError } from '../../util/errors.js';
import { asBundlePath } from '../../util/paths.js';
import { flagBool, flagNumber, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { actorOf, effective, type Ctx } from './common.js';
import { invoke } from '../../engine/registry.js';

function lang(config: OkbConfig): 'fr' | 'en' {
  const l = layoutOf(config)?.lang ?? config.writing.language ?? config.profile.answer.language;
  return l.startsWith('fr') ? 'fr' : 'en';
}

function inputOf(ctx: Ctx): SuggestInput {
  const a = ctx.args;
  const s = (k: string) => flagString(a, k);
  const type = s('type') ?? a.positionals[1];
  const title = s('title') ?? a.positionals.slice(2).join(' ');
  if (!type) throw new OkbError('E_INVALID', 'a suggestion needs --type', { key: 'brainWhichType', hint: 'okb brain types' });
  return {
    type, title: title ?? '', why: s('why') ?? '',
    ...(s('product') ? { product: s('product')! } : {}), ...(s('repo') ? { repo: s('repo')! } : {}),
    ...(s('theme') ? { theme: s('theme')! } : {}), ...(s('ref') ? { ref: s('ref')! } : {}),
    ...(s('date') ? { date: s('date')! } : {}), ...(s('level') ? { level: s('level') as SuggestInput['level'] } : {}),
    ...(s('signal') ? { signal: checkSignal(s('signal')!) } : {}), ...(s('source') ? { source: s('source')! } : {}),
    ...(s('scope') ? { scope: s('scope')! } : {}), ...(flagNumber(a, 'notes') ? { notes: flagNumber(a, 'notes')! } : {}),
  };
}

/** `okb suggest …` — the cards OKB shows before anything is written. */
export async function cmdSuggest(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const sub = ctx.args.positionals[0] ?? 'list';
  const l = lang(config);
  switch (sub) {
    case 'add':
    case 'card': {
      const input = inputOf(ctx);
      if (sub === 'card') {
        const card = buildCard(config, input, await contextFor(config, await loadBundleFor(config)));
        if (ctx.mode === 'json') ctx.out.json({ ok: true, card, text: renderCard(card, l) }); else ctx.out.line(renderCard(card, l));
        return 0;
      }
      const { suggestion, created } = await invoke('suggestions.add', input, { config, env: process.env, actor: actorOf() });
      const mode = await suggestMode(config);
      const now = suggestion.pertinence.total >= 80 && mode === 'live';
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, created, showNow: now, mode, suggestion, text: renderCard(suggestion, l) }); return 0; }
      ctx.out.line(renderCard(suggestion, l));
      return 0;
    }
    case 'list': {
      const listed = await invoke('suggestions.list', { all: flagBool(ctx.args, 'all') }, { config, env: process.env, actor: actorOf() });
      const { suggestions: queue, totalTokens: total, budget: { daily: budget, spent } } = listed;
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...listed }); return 0; }
      if (!queue.length) { ctx.out.info(t('suggest.none')); return 0; }
      ctx.out.grid(queue.map((s) => [s.id, `${s.pertinence.total}`, s.title, paint.dim(s.breadcrumb), `≈${s.cost.tokens}`]));
      ctx.out.line(paint.dim(t('suggest.budget', { spent, budget, total })));
      return 0;
    }
    case 'show': {
      const s = await findSuggestion(config, ctx.args.positionals[1] ?? '');
      if (ctx.mode === 'json') ctx.out.json({ ok: true, suggestion: s, text: renderCard(s, l) }); else ctx.out.line(renderCard(s, l));
      return 0;
    }
    case 'accept': return accept(ctx, config);
    case 'session': {
      // What the session may still offer, in one question (the end-of-session flow asks for it).
      const { currentSession, sessionOffer } = await import('../../suggest/session.js');
      const session = flagString(ctx.args, 'session') ?? (await currentSession(config));
      const offer = session ? await sessionOffer(config, session) : { session: '', cards: [], toName: [] };
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...offer }); return 0; }
      if (!offer.cards.length && !offer.toName.length) { ctx.out.info(t('suggest.none')); return 0; }
      for (const c of offer.cards) ctx.out.line(`${c.id}  ${c.title}  ${paint.dim(c.breadcrumb)}`);
      for (const m of offer.toName) ctx.out.line(`${m.kind}  ${paint.dim(m.hint)}`);
      return 0;
    }
    case 'decline':
    case 'later':
    case 'done': {
      if (sub === 'later' && flagString(ctx.args, 'session')) {
        const { notNow } = await import('../../suggest/session.js');
        const out = await notNow(config, flagString(ctx.args, 'session')!);
        if (ctx.mode === 'json') ctx.out.json({ ok: true, ...out }); else ctx.out.ok(t('suggest.notNow', { n: String(out.later.length) }));
        return 0;
      }
      const id = ctx.args.positionals[1] ?? '';
      const s = await setStatus(config, (await findSuggestion(config, id)).id, sub === 'decline' ? 'declined' : sub === 'later' ? 'later' : 'done', invokedBy() === 'person' ? 'terminal' : 'person', flagString(ctx.args, 'proposal'));
      if (ctx.mode === 'json') ctx.out.json({ ok: true, suggestion: s }); else ctx.out.ok(t(`suggest.${sub}`, { id: s.id }));
      return 0;
    }
    case 'consent': return consent(ctx, config);
    case 'moment': return moment(ctx, config);
    case 'concepts': {
      const { conceptGaps } = await import('../../suggest/gaps.js');
      const bundle = await loadBundleFor(config);
      const gaps = conceptGaps(layoutOf(config), bundle, config.conceptAssist.stoplist).slice(0, flagNumber(ctx.args, 'limit') ?? 8);
      const queued = [];
      if (flagBool(ctx.args, 'queue') && config.kb.brain) {
        const sctx = await contextFor(config, bundle);
        for (const g of gaps) queued.push((await addSuggestion(config, { type: g.term === g.term.toUpperCase() ? 'acronym' : 'concept', title: g.term, why: `used in ${g.notes} notes without a card`, signal: 'concept', source: 'concept' }, sctx)).suggestion);
      }
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, gaps, queued }); return 0; }
      if (!gaps.length) { ctx.out.info(t('suggest.noGaps')); return 0; }
      ctx.out.grid(gaps.map((g) => [g.term, String(g.notes), paint.dim(g.examples[0] ?? '')]));
      return 0;
    }
    default:
      throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, command: 'suggest' }, hint: 'okb help suggest' });
  }
}

export async function suggestMode(config: OkbConfig): Promise<'live' | 'session' | 'never'> {
  const v = (config as unknown as { suggest?: { mode?: string } }).suggest?.mode;
  const { readRootConfig } = await import('../../kb/registry.js');
  const root = (await readRootConfig().catch(() => ({}))) as { suggest?: { mode?: unknown } };
  const m = v ?? root.suggest?.mode;
  // Grouped at the end of the session unless the person chose otherwise (F2.0-09).
  return m === 'live' || m === 'never' ? m : 'session';
}

/**
 * Accepting a card. Typed in a terminal it is the person's own act; run by
 * Claude it needs the yes the hooks recorded (their click or their « oui »).
 * The daily budget is checked here, before anything is written.
 */
async function accept(ctx: Ctx, config: OkbConfig): Promise<number> {
  const s = await findSuggestion(config, ctx.args.positionals[1] ?? '');
  if (s.status === 'declined' || s.status === 'expired') throw new OkbError('E_CONFLICT', `${s.id} was ${s.status}`, { key: 'suggestClosed', params: { id: s.id, status: s.status } });
  const byClaude = invokedBy() === 'claude';
  if (byClaude && !(await hasConsent(config, s.id, s.shownAt))) {
    throw new OkbError('E_NOT_APPROVED', `the person has not said yes to ${s.id}`, { key: 'suggestNoConsent', params: { id: s.id }, hint: 'Show the card and ask with buttons (« Créer » · « Plus tard » · « Non »); their answer is recorded by OKB.' });
  }
  const budget = await dailyBudget();
  const spent = await spentToday(config);
  if (budget > 0 && spent + s.cost.tokens > budget && !flagBool(ctx.args, 'over-budget')) {
    throw new OkbError('E_NOT_APPROVED', `today's writing budget would be exceeded (${spent} + ${s.cost.tokens} > ${budget})`, { key: 'suggestOverBudget', params: { spent: String(spent), cost: String(s.cost.tokens), budget: String(budget) }, hint: 'Ask the person; with their yes: okb suggest accept <id> --over-budget' });
  }
  const done = await setStatus(config, s.id, 'accepted', byClaude ? 'consent' : 'terminal');
  const context = s.path ? `okb brain context "${s.recommendation === 'create' ? s.path.split('/').slice(0, -1).join('/') : s.target ?? s.path}"` : null;
  const result = {
    ok: true, suggestion: done, place: s.recommendation === 'create' ? s.path : s.target, mode: s.recommendation === 'create' ? 'create' : s.recommendation === 'complete' ? 'append' : s.recommendation,
    template: (await import('../../brain/types.js')).noteType(s.type)?.template ?? null, contextCommand: context,
    // The brief of this kind of note: its length and its style (F2.0-11).
    styleCommand: `okb style --type ${s.type} --json`, budget: { daily: budget, spent: spent + s.cost.tokens },
  };
  if (ctx.mode === 'json') { ctx.out.json(result); return 0; }
  ctx.out.ok(t('suggest.accepted', { id: s.id, place: result.place ?? '' }));
  return 0;
}

/**
 * The end of one of Claude's answers (Stop hook). Without AI, OKB spots what
 * may be worth a note (src/suggest/moments.ts), keeps it for the end of the
 * session, and says what to offer under the rules of a session
 * (src/suggest/session.ts): three things at most, in one question, at the end;
 * `suggest.mode: live` also offers a strong card at once.
 */
async function moment(ctx: Ctx, config: OkbConfig): Promise<number> {
  const raw = flagBool(ctx.args, 'stdin') ? await readStdin() : '{}';
  let payload: { prompt?: unknown; answer?: unknown; session?: unknown; earlier?: unknown; toolErrors?: unknown } = {};
  try { payload = JSON.parse(raw || '{}'); } catch { /* nothing */ }
  const { spot } = await import('../../suggest/session.js');
  const out = await spot(config, {
    prompt: String(payload.prompt ?? ''), answer: String(payload.answer ?? ''),
    ...(typeof payload.session === 'string' ? { session: payload.session } : {}),
    earlier: Array.isArray(payload.earlier) ? payload.earlier.map(String).slice(-40) : [],
    toolErrors: Number.isInteger(payload.toolErrors) ? Number(payload.toolErrors) : 0,
  }, { mode: await suggestMode(config) });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, moments: out.moments.map((m) => m.kind), ...(out.context ? { context: out.context } : {}), ...(out.suggestion ? { suggestion: out.suggestion } : {}), ...(out.offer ? { offer: out.offer } : {}) });
  else if (out.context) ctx.out.line(out.context);
  return 0;
}

/** Recorded by the hooks only (the approval guard refuses this command from a tool call). */
async function consent(ctx: Ctx, config: OkbConfig): Promise<number> {
  const raw = flagBool(ctx.args, 'stdin') ? await readStdin() : flagString(ctx.args, 'prompt') !== undefined ? JSON.stringify({ prompt: flagString(ctx.args, 'prompt') }) : '';
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { return 0; }
  const at = new Date().toISOString();
  if (typeof payload.prompt === 'string') {
    const ids = idsIn(payload.prompt);
    if (ids.length) await recordConsent(config, { at, ids, via: 'prompt' });
    else if (isPlainYes(payload.prompt)) await recordConsent(config, { at, ids: [], via: 'prompt', any: true });
  } else if (payload.tool_input || payload.tool_response) {
    const { ids, any } = idsFromQuestion(payload.tool_input, payload.tool_response);
    if (ids.length || any) await recordConsent(config, { at, ids, via: 'question', ...(any ? { any: true } : {}) });
  }
  if (ctx.mode === 'json') ctx.out.json({ ok: true });
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/* ---------------------------------------------------------------- scores */

/** `okb scores [note] [--below 50]` — quality, value and stars, without AI. */
export async function cmdScores(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const bundle = await loadBundleFor(config);
  const all = await scoreBundle(config, bundle);
  const target = ctx.args.positionals[0];
  const below = flagNumber(ctx.args, 'below');
  const list = target ? all.filter((s) => s.path === target || s.title === target) : below !== undefined ? all.filter((s) => s.global < below) : all;
  if (ctx.mode === 'json') {
    const avg = all.length ? Math.round(all.reduce((n, s) => n + s.global, 0) / all.length) : 0;
    ctx.out.json({ ok: true, average: avg, notes: all.length, scores: list.slice(0, flagNumber(ctx.args, 'limit') ?? 200) });
    return 0;
  }
  if (!list.length) { ctx.out.info(t('scores.none')); return 0; }
  for (const s of list.slice(0, flagNumber(ctx.args, 'limit') ?? 30)) {
    ctx.out.line(`${stars(s.stars)} ${String(s.global).padStart(3)} %  ${s.title} ${paint.dim(`Q${s.quality} · V${s.value}${s.young ? ' · new' : ''}`)}`);
    if (target) {
      const q = s.parts.quality; const v = s.parts.value;
      ctx.out.line(paint.dim(`   ${t('scores.quality')}: structure ${q.structure}/20 · sources ${q.sources}/25 · clarity ${q.clarity}/20 · links ${q.links}/15 · justness ${q.justness}/20`));
      ctx.out.line(paint.dim(`   ${t('scores.value')}: used ${v.used}/40 · fresh ${v.fresh}/25 · unique ${v.unique}/15 · opinion ${v.opinion}/20`));
      for (const n of s.notes) ctx.out.line(paint.dim(`   • ${n}`));
    }
  }
  return 0;
}

/** `okb rate <note> up|down` — the person's opinion of a note, one click. */
export async function cmdRate(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [note, verdict] = ctx.args.positionals;
  if (!note || !['up', 'down', '+', '-', '👍', '👎'].includes(verdict ?? '')) throw new OkbError('E_INVALID', 'okb rate <note> up|down', { key: 'usage', params: { usage: 'okb rate <note> up|down' } });
  const path = asBundlePath(note);
  await noteEvent(config, path, verdict === 'up' || verdict === '+' || verdict === '👍' ? 'up' : 'down');
  if (ctx.mode === 'json') ctx.out.json({ ok: true }); else ctx.out.ok(t('scores.rated'));
  return 0;
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** A signal OKB knows, or a clear refusal (an unknown one would score nothing). */
function checkSignal(raw: string): Signal {
  if ((SIGNALS as string[]).includes(raw)) return raw as Signal;
  throw new OkbError('E_INVALID', `unknown signal "${raw}"`, { hint: `Signals: ${SIGNALS.join(', ')}` });
}
