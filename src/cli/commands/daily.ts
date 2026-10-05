import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { okbHome } from '../../config/load.js';
import { focusPaths, initFocus, readFocus, recordSession, renderFocusContext, setFocus } from '../../focus/focus.js';
import { formatDate, relativeTime, t, tn } from '../../i18n/index.js';
import { capture, findInboxItem, listInbox, settleInboxItem } from '../../inbox/inbox.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { obsidianInstalled, obsidianUrl, openExternal } from '../../integrations/system.js';
import { draftSkill, writeSkillDraft } from '../../skillify/skillify.js';
import { OkbError } from '../../util/errors.js';
import { readTextIfExists } from '../../util/fsx.js';
import { weeklyReport } from '../../weekly/weekly.js';
import { flagBool, flagList, flagNumber, flagString, flagValues } from '../args.js';
import { choose, confirm, input, search } from '../ui/prompt.js';
import { fileLink, link, paint, sym } from '../ui/term.js';
import { canAsk, effective, kbFlag, type Ctx } from './common.js';

const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

export async function cmdCapture(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const file = flagString(args, 'from-file');
  let text = file ? await readFile(resolve(file), 'utf8') : args.positionals.join(' ');
  if (!text.trim() && canAsk(ctx)) text = await input(t('capture.q'), { placeholder: t('capture.placeholder') });
  const item = await capture(config, { text, title: flagString(args, 'title'), source: flagString(args, 'source'), tags: flagList(args, 'tag') });
  if (ctx.mode === 'json') out.json({ ok: true, item });
  else {
    out.ok(t('capture.done', { title: item.title }));
    out.line(paint.dim(`  ${t('capture.where')}`));
  }
  return 0;
}

export async function cmdInbox(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const sub = args.positionals[0] ?? (canAsk(ctx) ? 'triage' : 'list');
  if (sub === 'list' || sub === 'triage') {
    const items = await listInbox(config, { statuses: flagBool(args, 'all') ? ['open', 'done', 'dropped'] : ['open'] });
    if (ctx.mode === 'json') { out.json({ ok: true, items }); return 0; }
    if (!items.length) { out.ok(t('inbox.empty')); return 0; }
    if (sub === 'list') {
      out.grid(items.map((i) => [i.status === 'open' ? '📥' : i.status === 'done' ? '✔' : '✖', i.title, relativeTime(i.capturedAt), i.source ?? '', paint.dim(i.id)]), ['', t('inbox.col.item'), t('inbox.col.age'), t('inbox.col.source'), '']);
      out.next([`okb inbox${kbFlag(args)}`]);
      return 0;
    }
    // Triage, one item at a time, oldest first.
    let handled = 0;
    for (const item of items) {
      const text = (await readTextIfExists(item.path)) ?? '';
      const body = text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
      out.box([...body.split('\n').slice(0, 12), ...(body.split('\n').length > 12 ? [paint.dim('…')] : [])], `📥 ${item.title.slice(0, 60)} · ${relativeTime(item.capturedAt)}`, 'brand');
      const choice = await choose(t('inbox.triage.q'), [
        { value: 'claude', label: t('inbox.triage.claude'), hint: t('inbox.triage.claudeHint'), recommended: true },
        { value: 'done', label: t('inbox.triage.done') },
        { value: 'drop', label: t('inbox.triage.drop') },
        { value: 'skip', label: t('inbox.triage.skip') },
        { value: 'stop', label: t('inbox.triage.stop') },
      ]);
      if (choice === 'stop') break;
      if (choice === 'skip') continue;
      if (choice === 'claude') {
        out.line(`  ${sym.arrow()} ${t('inbox.triage.claudeCmd')} ${paint.code(`/okb:ingest ${item.path}`)}`);
        continue;
      }
      if (choice === 'drop') {
        const reason = await input(t('inbox.triage.why'), { placeholder: t('inbox.triage.whyPlaceholder') });
        await settleInboxItem(config, item.id, 'dropped', { reason: reason || 'dropped during triage' });
      } else {
        await settleInboxItem(config, item.id, 'done');
      }
      handled++;
    }
    out.ok(tn('inbox.triage.recap', handled, { left: (await listInbox(config)).length }));
    return 0;
  }
  const id = args.positionals[1];
  if (!id) throw new OkbError('E_INVALID', `usage: okb inbox ${sub} <id>`, { key: 'usage', params: { usage: `okb inbox ${sub} <id>` } });
  if (sub === 'show') {
    const item = await findInboxItem(config, id);
    const text = await readFile(item.path, 'utf8');
    if (ctx.mode === 'json') out.json({ ok: true, item, text });
    else out.line(`${paint.dim(item.path)}\n\n${text}`);
    return 0;
  }
  if (sub === 'done' || sub === 'drop') {
    const item = await settleInboxItem(config, id, sub === 'done' ? 'done' : 'dropped', { proposal: flagString(args, 'proposal'), reason: flagString(args, 'reason') });
    if (ctx.mode === 'json') out.json({ ok: true, item });
    else out.ok(t(sub === 'done' ? 'inbox.settledDone' : 'inbox.settledDrop', { title: item.title }));
    return 0;
  }
  throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb inbox [list|show|done|drop]' } });
}

export async function cmdFocus(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const sub = args.positionals[0] ?? 'show';
  if (sub === 'init') {
    const path = await initFocus(config);
    if (ctx.mode === 'json') out.json({ ok: true, path });
    else { out.ok(t('focus.created', { path: tilde(path) })); out.tip(t('focus.createdTip')); }
    return 0;
  }
  if (sub === 'set' || sub === 'edit') {
    const file = flagString(args, 'from-file');
    let text = file ? await readFile(resolve(file), 'utf8') : args.positionals.slice(1).join(' ');
    if (!text.trim() && canAsk(ctx)) {
      const current = await readFocus(config);
      text = await input(t('focus.q'), { initial: current.text.replace(/^# .*\n+/, ''), placeholder: t('focus.placeholder') });
    }
    const result = await setFocus(config, text);
    if (ctx.mode === 'json') out.json({ ok: true, ...result });
    else { out.ok(t('focus.updated', { path: tilde(result.path) })); if (result.previous) out.line(paint.dim(`  ${t('focus.previousKept')}`)); }
    return 0;
  }
  if (sub !== 'show') throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb focus [show|init|set "<text>"]' } });
  const state = await readFocus(config);
  if (flagBool(args, 'context')) {
    const text = config.focus.sessionStart ? renderFocusContext(config, state) : '';
    if (ctx.mode === 'json') out.json({ ok: true, context: text });
    else if (text) process.stdout.write(`${text}\n`);
    return 0;
  }
  if (ctx.mode === 'json') { out.json({ ok: true, ...state, journal: focusPaths(config).journal }); return 0; }
  if (!state.exists) {
    out.info(t('focus.none'));
    out.line(paint.dim(`  ${t('focus.why')}`));
    out.next([`okb focus init${kbFlag(args)}`]);
  } else {
    out.line(`🎯 ${paint.bold(t('focus.title'))} ${paint.dim(`· ${t('focus.updatedAgo', { when: relativeTime(new Date(Date.now() - (state.ageDays ?? 0) * 86_400_000)) })}`)}  ${fileLink(paint.dim(tilde(state.path)), state.path)}`);
    if (state.stale) out.warn(t('focus.stale', { days: state.ageDays ?? 0 }));
    out.line();
    out.line(state.text.split('\n').map((l) => `  ${l}`).join('\n'));
  }
  if (state.lastSession) {
    const s = state.lastSession;
    out.line();
    out.line(`📓 ${paint.bold(t('focus.lastSession'))} ${paint.dim(`· ${formatDate(s.at)} · ${s.profile}`)}`);
    out.line(`  ${s.summary}`);
    if (s.next) out.line(`  ${sym.arrow()} ${t('focus.nextTime')} ${paint.bold(s.next)}`);
  }
  return 0;
}

export async function cmdDone(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const file = flagString(args, 'from-file');
  const fromFile = file ? (JSON.parse(await readFile(resolve(file), 'utf8')) as Record<string, unknown>) : {};
  const list = (key: string) => [...(Array.isArray(fromFile[key]) ? (fromFile[key] as unknown[]).map(String) : []), ...flagValues(args, key)];
  let summary = flagString(args, 'summary') ?? (typeof fromFile.summary === 'string' ? fromFile.summary : '');
  let next = flagString(args, 'next') ?? (typeof fromFile.next === 'string' ? fromFile.next : undefined);
  const keep = list('keep');
  if (!summary.trim() && canAsk(ctx)) {
    summary = await input(t('done.summary.q'), { placeholder: t('done.summary.placeholder') });
    if (!next) next = (await input(t('done.next.q'), { placeholder: t('done.next.placeholder') })) || undefined;
    for (;;) {
      const k = await input(t('done.keep.q'), { placeholder: t('done.keep.placeholder') });
      if (!k) break;
      keep.push(k);
    }
  }
  const record = await recordSession(config, { summary, did: list('did'), decided: list('decided'), keep, ...(next ? { next } : {}) });
  if (ctx.mode === 'json') { out.json({ ok: true, ...record }); return 0; }
  out.ok(t('done.saved', { path: tilde(record.journal) }));
  for (const item of record.captured) out.line(`  📥 ${item.title}`);
  if (record.captured.length) out.line(paint.dim(`  ${t('done.captured')}`));
  if (record.next) out.line(`  ${sym.arrow()} ${t('focus.nextTime')} ${paint.bold(record.next)}`);
  return 0;
}

export async function cmdWeekly(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const r = await weeklyReport(config, { days: flagNumber(args, 'days') });
  if (ctx.mode === 'json') { out.json({ ok: true, ...r }); return 0; }
  out.box([t('weekly.period', { from: formatDate(r.period.from), to: formatDate(r.period.to) })], `🗓️ ${t('weekly.title')} · ${config.profile.displayName || config.profile.id}`, 'brand');
  out.heading(`📥 ${t('weekly.inbox')}`);
  out.line(r.inbox.open ? `  ${tn('weekly.inboxOpen', r.inbox.open, { days: r.inbox.oldestDays ?? 0 })}` : `  ${sym.ok()} ${t('weekly.inboxEmpty')}`);
  for (const i of r.inbox.stale) out.line(`  ${sym.warn()} ${i.title.slice(0, 70)} ${paint.dim(`(${tn('weekly.days', i.ageDays)})`)}`);
  out.heading(`⏳ ${t('weekly.proposals')}`);
  if (!r.proposals.prepared.length) out.line(`  ${sym.ok()} ${t('weekly.noProposals')}`);
  for (const p of r.proposals.prepared) out.line(`  ${p.ageDays >= r.proposals.staleDays ? sym.warn() : sym.bullet()} ${p.label.slice(0, 70)} ${paint.dim(`(${tn('weekly.days', p.ageDays)})`)}`);
  out.heading(`✅ ${t('weekly.applied')}`);
  out.line(`  ${t('weekly.appliedLine', { receipts: r.applied.receipts, created: r.applied.created.length, updated: r.applied.updated.length })}`);
  out.heading(`🔁 ${t('weekly.reread')}`);
  if (!r.toReview.length) out.line(`  ${paint.dim(t('weekly.rereadNone'))}`);
  for (const n of r.toReview) out.line(`  ${paint.dim(`J+${n.milestone}`)} ${n.title} ${paint.dim(n.path)}`);
  out.heading(`🎯 ${t('weekly.focus')}`);
  out.line(`  ${r.focus.exists ? (r.focus.stale ? paint.warn(t('weekly.focusStale', { days: r.focus.ageDays ?? 0 })) : t('weekly.focusOk', { days: r.focus.ageDays ?? 0 })) : t('weekly.focusNone')}`);
  out.line(`  ${tn('weekly.sessions', r.sessions.count)}`);
  for (const s of r.sessions.next) out.line(`  ${sym.arrow()} ${paint.dim(formatDate(s.at))} ${s.next.slice(0, 90)}`);
  out.heading(`🩺 ${t('weekly.maintenance')}`);
  out.line(`  ${r.maintenance.errors ? paint.err(tn('status.errors', r.maintenance.errors)) : sym.ok()} ${tn('status.warnings', r.maintenance.warnings)}`);
  out.line();
  out.tip(t('weekly.tip'));
  return 0;
}

export async function cmdAsk(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  let query = args.positionals.join(' ').trim();
  if (!query && canAsk(ctx)) query = await input(t('ask.q'), { placeholder: t('ask.placeholder') });
  if (!query) throw new OkbError('E_INVALID', 'usage: okb ask "<question>"', { key: 'usage', params: { usage: 'okb ask "<question>"' } });
  // Inside a repository's scope (its folder, or the one chosen in a workspace), its notes come first;
  // a repository with its own KB in a workspace also gets the workspace's shared notes.
  const { scopedAsk } = await import('../../work/cli-scope.js');
  const { result, scope } = await scopedAsk(config, query, {
    ...(flagNumber(args, 'limit') !== undefined ? { limit: flagNumber(args, 'limit')! } : {}),
    ...(flagString(args, 'cursor') ? { cursor: flagString(args, 'cursor')! } : {}),
    ...(flagString(args, 'repo') ? { repo: flagString(args, 'repo')! } : {}),
    everywhere: flagBool(args, 'everywhere'),
  });
  if (ctx.mode === 'json') { out.json({ ok: true, ...result, scope }); return 0; }
  if (scope) out.line(paint.dim(t(scope.sharedKb ? 'ask.scopeShared' : 'ask.scope', { repo: scope.name, kb: scope.sharedKb ?? '' })));
  if (!result.hits.length) {
    out.info(t('ask.none'));
    out.tip(t('ask.noneTip'));
    return 0;
  }
  const useObsidian = await obsidianInstalled();
  out.line(paint.dim(t('ask.found', { n: result.hits.length, query })));
  for (const [i, h] of result.hits.entries()) {
    const absPath = resolve(h.root, h.path);
    const target = useObsidian ? link(paint.bold(h.title), obsidianUrl(absPath)) : fileLink(paint.bold(h.title), absPath);
    out.line(`\n${paint.dim(`${i + 1}.`)} ${target}  ${paint.dim(h.kb !== config.profile.id ? `${h.kb} · ${h.path}` : h.path)}`);
    for (const e of result.evidence.filter((x) => x.path === h.path && (!('kb' in x) || x.kb === h.kb)).slice(0, 2)) out.line(`   ${paint.dim('│')} ${e.quote.replace(/\s+/g, ' ').slice(0, 200)} ${paint.dim(`(l.${e.line})`)}`);
  }
  if (result.prerequisites.length) out.line(`\n${sym.tip()} ${t('ask.prereq')} ${result.prerequisites.map((p) => p.path).join(', ')}`);
  out.truncation(result.truncation, `okb ask "${query}"`);
  out.next([`okb open ${result.hits[0]!.path}${kbFlag(args)}`]);
  return 0;
}

/** `okb open [note|search words]` — in Obsidian when it is there, else the default app. */
export async function cmdOpen(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const bundle = await loadBundleFor(config);
  const query = args.positionals.join(' ').trim();
  let path: string | undefined;
  if (!query) path = bundle.byPath.has('accueil.md' as never) ? 'accueil.md' : bundle.byPath.has('index.md' as never) ? 'index.md' : undefined;
  else if (bundle.byPath.has(query as never)) path = query;
  else {
    const hits = bundle.entries.filter((e) => `${e.title} ${e.path}`.toLowerCase().includes(query.toLowerCase()));
    if (hits.length === 1) path = hits[0]!.path;
    else if (hits.length > 1 && canAsk(ctx)) path = await search(t('open.pick'), hits.map((h) => ({ value: h.path as string, label: h.title, hint: h.path })));
    else if (hits.length > 1) path = hits[0]!.path;
  }
  const absPath = path ? resolve(config.kb.root, path) : config.kb.root;
  const url = (await obsidianInstalled()) ? obsidianUrl(absPath) : absPath;
  const opened = flagBool(args, 'print') ? false : await openExternal(url);
  if (ctx.mode === 'json') { out.json({ ok: true, path: path ?? null, url, opened }); return 0; }
  if (!path && query) out.warn(t('open.notFound', { query }));
  out.ok(opened ? t('open.opened', { what: path ?? tilde(config.kb.root) }) : `${url}`);
  return 0;
}

export async function cmdSkillify(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  let note = args.positionals[0];
  if (!note && canAsk(ctx)) {
    const bundle = await loadBundleFor(config);
    const candidates = bundle.entries.filter((e) => ['Runbook', 'Process', 'Automation'].includes(e.type));
    if (!candidates.length) throw new OkbError('E_NOT_FOUND', 'no procedure, process or automation note in this KB', { key: 'skillifyNoNotes' });
    note = await search(t('skillify.pick'), candidates.map((c) => ({ value: c.path as string, label: c.title, hint: c.type })));
  }
  if (!note) throw new OkbError('E_INVALID', 'usage: okb skillify <note.md> [--name n] [--out <dir>]', { key: 'usage', params: { usage: 'okb skillify <note.md> [--out <dir>]' } });
  const draft = await draftSkill(config, note, { ...(flagString(args, 'name') ? { name: flagString(args, 'name')! } : {}) });
  let dir = flagString(args, 'out');
  if (!dir && canAsk(ctx)) {
    out.box(draft.content.split('\n').slice(0, 30), `🛠️ ${draft.name}`, 'brand');
    if (await confirm(t('skillify.write.q'), true)) dir = await input(t('skillify.where'), { initial: resolve(process.cwd(), '.claude', 'skills') });
  }
  const path = dir ? await writeSkillDraft(config, draft, resolve(dir), { force: flagBool(args, 'force') }) : null;
  if (ctx.mode === 'json') { out.json({ ok: true, ...draft, path }); return 0; }
  if (path) { out.ok(t('skillify.written', { path: tilde(path), steps: draft.counts.steps })); out.tip(t('skillify.reviewTip')); }
  else if (!canAsk(ctx)) { out.line(draft.content); out.next([`okb skillify ${draft.note} --out <project>/.claude/skills`]); }
  return 0;
}

export async function cmdProfile(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const raw = await readTextIfExists(resolve(okbHome(), 'config.yaml'));
  const root = raw ? ((YAML.parse(raw) as { profiles?: unknown; activeProfile?: unknown }) ?? {}) : {};
  const agentModel = config.agents.model === 'inherit' ? null : config.agents.model;
  const installed = Array.isArray(root.profiles) ? root.profiles.map(String) : [];
  const active = typeof root.activeProfile === 'string' ? root.activeProfile : null;
  const focus = await readFocus(config);
  const info = {
    profile: config.profile.id, name: config.profile.displayName || config.profile.id, kbRoot: config.kb.root, active, installed,
    explicit: config.profile.id !== active, writingLanguage: config.profile.answer.language,
    focus: { path: focus.path, exists: focus.exists, ageDays: focus.ageDays, stale: focus.stale },
    // Model for evidence-gathering subagents (Agent tool `model`); null: the session's.
    agentModel,
  };
  if (ctx.mode === 'json') { out.json({ ok: true, ...info }); return 0; }
  out.line(`📚 ${config.profile.id} → ${config.kb.root}${info.explicit ? `  ${paint.dim(t('profile.explicit'))}` : ''}`);
  out.line(`${t('profile.installed')} ${installed.map((p) => (p === active ? `${p} (${t('profile.active')})` : p)).join(', ') || '—'}`);
  out.line(focus.exists ? `focus: ${tilde(focus.path)}` : `focus: ${t('focus.noneShort')}`);
  out.line(paint.dim(`${t('profile.switch')} okb kb switch <kb>`));
  return 0;
}
