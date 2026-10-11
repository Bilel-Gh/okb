import { invoke } from '../../engine/registry.js';
import { t } from '../../i18n/index.js';
import type { Project } from '../../projects/projects.js';
import { OkbError } from '../../util/errors.js';
import { flagBool, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { actorOf, effective, type Ctx } from './common.js';

/**
 * The person's day in a terminal, through the same engine as the app:
 * `okb today`, `okb project`, `okb action`. Nothing here writes a note.
 */
async function context(ctx: Ctx) {
  const { config } = await effective(ctx.args);
  return { config, env: process.env, actor: actorOf() };
}

const opt = (ctx: Ctx, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => flagString(ctx.args, k) !== undefined).map((k) => [k, flagString(ctx.args, k)!]));

/** A project by its id, its reference (a ticket, a repository) or its exact title. */
async function resolve(c: Awaited<ReturnType<typeof context>>, wanted: string | undefined): Promise<Project> {
  if (!wanted) throw new OkbError('E_INVALID', 'which project?', { key: 'projectWhich', hint: 'okb project' });
  const { projects } = await invoke('projects.list', { status: 'all' }, c);
  const low = wanted.toLowerCase();
  const found = projects.find((p) => p.id.toLowerCase() === low) ?? projects.find((p) => p.ref?.toLowerCase() === low) ?? projects.find((p) => p.title.toLowerCase() === low);
  if (!found) throw new OkbError('E_NOT_FOUND', `no project "${wanted}"`, { key: 'projectUnknown', params: { id: wanted }, hint: 'okb project' });
  return found;
}

function showProject(ctx: Ctx, p: Project): void {
  ctx.out.line(`${paint.bold(p.title)}  ${paint.dim(`${p.id} · ${p.kind}${p.ref ? ` · ${p.ref}` : ''} · ${p.status}`)}`);
  if (p.where) ctx.out.line(`   ${t('project.where')} ${p.where}`);
  if (p.next) ctx.out.line(`   ${t('project.next')} ${p.next}`);
  if (p.leftOff) {
    for (const f of ['done', 'tried', 'waiting', 'resume'] as const) if (p.leftOff[f]) ctx.out.line(paint.dim(`   ${t(`project.left.${f}`)} ${p.leftOff[f]}`));
  }
}

export async function cmdProject(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const [sub = 'list', ...rest] = ctx.args.positionals;
  switch (sub) {
    case 'list': case 'ls': {
      const { projects } = await invoke('projects.list', { status: flagBool(ctx.args, 'all') ? 'all' : flagString(ctx.args, 'status') ?? 'open' }, c);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, projects }); return 0; }
      if (!projects.length) { ctx.out.info(t('project.none')); ctx.out.next(['okb project new "<titre>"']); return 0; }
      for (const p of projects) showProject(ctx, p);
      return 0;
    }
    case 'new': case 'add': {
      const made = await invoke('projects.create', { title: rest.join(' '), ...opt(ctx, ['where', 'next', 'folder']) }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, project: made }); else { ctx.out.ok(t('project.created', { title: made.title })); showProject(ctx, made); }
      return 0;
    }
    case 'show': {
      const p = await resolve(c, rest.join(' '));
      const [{ actions }, { entries }] = await Promise.all([invoke('actions.list', { project: p.id }, c), invoke('journal.list', { project: p.id, limit: 15 }, c)]);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, project: p, actions, entries }); return 0; }
      showProject(ctx, p);
      for (const a of actions) ctx.out.line(`   ${a.kind === 'waiting' ? '⏳' : a.kind === 'question' ? '?' : '☐'} ${a.text}${a.who ? ` (${a.who})` : ''}${a.due ? paint.dim(` · ${a.due}`) : ''}  ${paint.dim(a.id)}`);
      for (const e of entries) ctx.out.line(paint.dim(`   ${e.day} · ${e.kind} · ${e.text}`));
      return 0;
    }
    case 'set': {
      const p = await resolve(c, rest.join(' '));
      const next = await invoke('projects.update', { id: p.id, ...opt(ctx, ['title', 'where', 'next', 'status']) }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, project: next }); else showProject(ctx, next);
      return 0;
    }
    case 'leave': {
      const p = await resolve(c, rest.join(' '));
      const left = await invoke('projects.leave', { id: p.id, ...opt(ctx, ['done', 'tried', 'waiting', 'resume']) }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, project: left }); else { ctx.out.ok(t('project.left')); showProject(ctx, left); }
      return 0;
    }
    default: {
      // `okb project <name>` shows it.
      const p = await resolve(c, [sub, ...rest].join(' '));
      if (ctx.mode === 'json') ctx.out.json({ ok: true, project: p }); else showProject(ctx, p);
      return 0;
    }
  }
}

export async function cmdAction(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const [sub = 'list', ...rest] = ctx.args.positionals;
  const project = flagString(ctx.args, 'project') ? (await resolve(c, flagString(ctx.args, 'project'))).id : undefined;
  switch (sub) {
    case 'list': case 'ls': {
      const { actions } = await invoke('actions.list', { ...(project ? { project } : {}), status: flagBool(ctx.args, 'all') ? 'all' : 'open' }, c);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, actions }); return 0; }
      if (!actions.length) { ctx.out.info(t('action.none')); return 0; }
      ctx.out.grid(actions.map((a) => [a.id, a.kind, a.text, a.who ?? '', a.due ?? '', a.status === 'open' ? '' : a.status]));
      return 0;
    }
    case 'add': {
      const text = rest.join(' ');
      // The line is read first: « réserver le car avant le 15 mai » gets its date; flags win.
      const spotted = (await invoke('actions.detect', { text }, c)).action;
      const added = await invoke('actions.add', {
        text: spotted?.text ?? text, kind: flagString(ctx.args, 'kind') ?? spotted?.kind ?? 'todo',
        ...(flagString(ctx.args, 'due') ?? spotted?.due ? { due: flagString(ctx.args, 'due') ?? spotted!.due } : {}),
        ...(flagString(ctx.args, 'who') ?? spotted?.who ? { who: flagString(ctx.args, 'who') ?? spotted!.who } : {}),
        ...(project ? { project } : {}),
      }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, action: added }); else ctx.out.ok(`${added.text}${added.due ? ` · ${added.due}` : ''}  ${paint.dim(added.id)}`);
      return 0;
    }
    case 'done': case 'drop': case 'reopen': {
      const status = sub === 'done' ? 'done' : sub === 'drop' ? 'dropped' : 'open';
      const changed = await invoke('actions.update', { id: rest[0] ?? '', status }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, action: changed }); else ctx.out.ok(`${changed.text} · ${changed.status}`);
      return 0;
    }
    default:
      throw new OkbError('E_INVALID', `unknown action command "${sub}"`, { hint: 'okb action [list|add "<texte>"|done <id>|drop <id>]' });
  }
}

export async function cmdToday(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const day = await invoke('today.view', {}, c);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...day }); return 0; }
  ctx.out.heading(t('today.resume'));
  if (!day.resume.length) ctx.out.line(paint.dim(`   ${t('project.none')}`));
  for (const p of day.resume) showProject(ctx, p);
  ctx.out.heading(t('today.todo'));
  if (!day.todo.length) ctx.out.line(paint.dim(`   ${t('action.none')}`));
  for (const a of day.todo) ctx.out.line(`   ☐ ${a.text}${a.project ? paint.dim(` · ${a.project.title}`) : ''}${a.due ? (a.late ? paint.err(` · ${a.due}`) : paint.dim(` · ${a.due}`)) : ''}`);
  if (day.waiting.length) {
    ctx.out.heading(t('today.waiting'));
    for (const a of day.waiting) ctx.out.line(`   ⏳ ${a.text}${a.who ? ` (${a.who})` : ''}${a.project ? paint.dim(` · ${a.project.title}`) : ''}`);
  }
  if (day.done.length) {
    ctx.out.heading(t('today.done'));
    for (const e of day.done.slice(0, 8)) ctx.out.line(paint.dim(`   ${e.day} · ${e.text}${e.project ? ` · ${e.project.title}` : ''}`));
  }
  if (day.toValidate) ctx.out.line(`\n${t('today.toValidate', { n: String(day.toValidate) })}`);
  if (day.review.due) ctx.out.line(`\n${t('today.review', { n: String(day.review.due) })}`);
  if (day.understand) ctx.out.line(t('today.understand', { title: day.understand.title }));
  if (day.notesToRecheck.length) {
    ctx.out.heading(t('today.recheck'));
    for (const n of day.notesToRecheck) ctx.out.line(`   ${n.title} · ${n.scope} · ${n.next}`);
  }
  if (day.recheckUnavailable.length) ctx.out.warn(t('today.recheckUnavailable'));
  return 0;
}

/** `okb doc` — the files kept as they are: `add <file>`, the list, `find <words>`. */
export async function cmdDoc(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const [sub = 'list', ...rest] = ctx.args.positionals;
  const project = flagString(ctx.args, 'project') ? (await resolve(c, flagString(ctx.args, 'project'))).id : undefined;
  switch (sub) {
    case 'add': case 'keep': {
      const { resolve: abs } = await import('node:path');
      const kept = await invoke('documents.add', { file: abs(rest.join(' ')), ...opt(ctx, ['title']), ...(project ? { project } : {}) }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, ...kept });
      else ctx.out.ok(t(kept.created ? 'doc.kept' : 'doc.already', { title: kept.document.title, path: kept.document.path }));
      if (ctx.mode !== 'json' && !kept.document.textRead) ctx.out.info(t('doc.noText'));
      return 0;
    }
    case 'list': case 'ls': case 'find': {
      const { documents } = await invoke('documents.list', { ...(project ? { project } : {}), ...(sub === 'find' && rest.length ? { query: rest.join(' ') } : {}) }, c);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, documents }); return 0; }
      if (!documents.length) { ctx.out.info(t('doc.none')); return 0; }
      for (const d of documents) {
        ctx.out.line(`📎 ${paint.bold(d.title)}  ${paint.dim(`${d.id} · ${d.path}`)}`);
        if (d.snippet) ctx.out.line(paint.dim(`   ${d.snippet}`));
      }
      return 0;
    }
    default:
      throw new OkbError('E_INVALID', `unknown doc command "${sub}"`, { hint: 'okb doc [list | add <fichier> | find <mots>]' });
  }
}

/** `okb baggage` — « Garder dans mon bagage »: a work note without anything of the workplace, proposed to the person's baggage. */
export async function cmdBaggage(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const [sub = '', ...rest] = ctx.args.positionals;
  const path = rest.join(' ');
  switch (sub) {
    case 'draft': {
      const draft = await invoke('baggage.draft', { path }, c);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...draft }); return 0; }
      ctx.out.line(draft.text.trimEnd());
      ctx.out.info(draft.removed.length ? t('baggage.removed', { list: [...new Set(draft.removed.map((d) => d.text))].join(', ') }) : t('baggage.nothingRemoved'));
      return 0;
    }
    case 'keep': {
      const file = flagString(ctx.args, 'file');
      const text = file ? await (await import('node:fs/promises')).readFile(file, 'utf8') : undefined;
      const kept = await invoke('baggage.keep', { path, ...(text !== undefined ? { text } : {}), ...opt(ctx, ['title']) }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, ...kept }); else ctx.out.ok(t('baggage.kept', { title: kept.title, target: kept.target, kb: kept.kb, n: String(kept.removed) }));
      return 0;
    }
    default:
      throw new OkbError('E_INVALID', `unknown baggage command "${sub}"`, { hint: 'okb baggage draft <note> | okb baggage keep <note> [--file <version relue.md>] [--title "<titre>"]' });
  }
}

/** `okb indicators` — coverage, freshness, quality and understanding, apart, each with what to do about its gaps. */
export async function cmdIndicators(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const { indicators } = await invoke('indicators.view', {}, c);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, indicators }); return 0; }
  for (const i of indicators) {
    ctx.out.line(`${paint.bold(t(`indicator.${i.id}`))}  ${i.value === null ? paint.dim(t('indicator.none')) : i.id === 'quality' ? `${i.value}/100` : `${i.value} %`}  ${paint.dim(t(`indicator.${i.id}.of`, { have: String(i.of.have), total: String(i.of.total) }))}`);
    for (const g of i.gaps) {
      ctx.out.line(`   • ${t(`indicator.gap.${g.id}`, { n: String(g.count) })}${g.examples.length ? paint.dim(` : ${g.examples.slice(0, 3).map((e) => e.title).join(', ')}`) : ''}`);
      ctx.out.line(paint.dim(`     → ${g.action.kind === 'command' ? g.action.to : g.action.kind === 'route' ? t(`indicator.route.${g.action.to}`) : `okb read "${g.action.to}"`}`));
    }
  }
  return 0;
}

/**
 * `okb share` — sharing with colleagues through drawers: a shared folder, one
 * drawer per person, and OKB writes only in the person's own. What leaves is
 * shown first; pushing is always asked for.
 */
export async function cmdShare(ctx: Ctx): Promise<number> {
  const c = await context(ctx);
  const [sub = 'status', ...rest] = ctx.args.positionals;
  const out = (value: Record<string, unknown>, text: () => void) => { if (ctx.mode === 'json') ctx.out.json({ ok: true, ...value }); else text(); return 0; };
  switch (sub) {
    case 'status': {
      const st = await invoke('share.status', {}, c);
      return out(st, () => {
        if (!st.ready) { ctx.out.info(t('share.notSetUp')); ctx.out.next(['okb share setup --folder <dossier commun> --drawer <ton nom> --allowed']); return; }
        ctx.out.line(`${paint.bold(st.drawer)}  ${paint.dim(st.folder)}${st.remote ? paint.dim(` → ${st.remote}`) : ''}`);
        ctx.out.line(t('share.summary', { leaving: String(st.leaving), held: String(st.held.length), marked: String(st.marked.length) }));
        for (const d of st.drawers) ctx.out.line(`   ${d.mine ? '•' : '◦'} ${d.name} ${paint.dim(`(${d.drawer}, ${d.notes} notes)`)}`);
      });
    }
    case 'setup': {
      const done = await invoke('share.setup', { folder: flagString(ctx.args, 'folder') ?? '', drawer: flagString(ctx.args, 'drawer') ?? '', allowed: flagBool(ctx.args, 'allowed') }, c);
      return out(done, () => { ctx.out.ok(t('share.setUp', { drawer: done.drawer, folder: done.folder })); if (done.remote) ctx.out.info(t('share.goesTo', { remote: done.remote })); ctx.out.next(['okb share add "<note ou dossier>"', 'okb share preview']); });
    }
    case 'add': case 'remove': {
      const { marked } = await invoke(sub === 'add' ? 'share.mark' : 'share.unmark', { paths: rest.length ? [rest.join(' ')] : [] }, c);
      return out({ marked }, () => { ctx.out.ok(t(sub === 'add' ? 'share.marked' : 'share.unmarked', { n: String(marked.length) })); ctx.out.next(['okb share preview', 'okb share send']); });
    }
    case 'preview': {
      const p = await invoke('share.preview', {}, c);
      return out(p, () => {
        ctx.out.heading(t('share.leaving', { n: String(p.leaving.length) }));
        for (const n of p.leaving.slice(0, 40)) ctx.out.line(`   ${n.title}  ${paint.dim(n.path)}`);
        if (p.held.length) { ctx.out.heading(t('share.heldBack', { n: String(p.held.length) })); for (const n of p.held.slice(0, 40)) ctx.out.line(`   ${n.title}  ${paint.dim(t(`share.reason.${n.reason}`))}`); }
      });
    }
    case 'send': {
      const sent = await invoke('share.send', { push: flagBool(ctx.args, 'push'), ...(flagString(ctx.args, 'preview-hash') ? { previewHash: flagString(ctx.args, 'preview-hash') } : {}) }, c);
      return out(sent, () => { ctx.out.ok(t(sent.pushed ? 'share.sentPushed' : 'share.sent', { written: String(sent.written), removed: String(sent.removed), held: String(sent.held) })); if (!sent.pushed) ctx.out.info(t('share.pushHint')); });
    }
    case 'receive': {
      const got = await invoke('share.receive', {}, c);
      return out(got, () => ctx.out.ok(t(got.changed ? 'share.received' : 'share.nothingNew')));
    }
    case 'find': {
      const { hits } = await invoke('shared.find', { query: rest.join(' ') }, c);
      return out({ hits }, () => { if (!hits.length) ctx.out.info(t('share.noHit')); for (const h of hits) { ctx.out.line(`${paint.bold(h.title)}  ${paint.dim(t('share.by', { name: h.by }))}`); ctx.out.line(paint.dim(`   ${h.snippet}`)); ctx.out.line(paint.dim(`   okb share read ${h.drawer} "${h.path}"`)); } });
    }
    case 'read': {
      const note = await invoke('shared.read', { drawer: rest[0] ?? '', path: rest.slice(1).join(' ') }, c);
      return out(note, () => { ctx.out.line(paint.dim(t('share.by', { name: note.by }))); ctx.out.line(note.markdown.trimEnd()); });
    }
    case 'keep': {
      const kept = await invoke('shared.keep', { drawer: rest[0] ?? '', path: rest.slice(1).join(' ') }, c);
      return out(kept, () => { ctx.out.ok(t('share.kept', { title: kept.title, by: kept.by })); ctx.out.next([`okb review ${kept.proposal}`]); });
    }
    case 'map': {
      const { maps } = await invoke('shared.map', {}, c);
      return out({ maps }, () => { if (!maps.length) ctx.out.info(t('share.nobody')); for (const m of maps) { ctx.out.heading(m.by); ctx.out.line(t('share.mapLine', { both: String(m.both.length), mine: String(m.mine.length), theirs: String(m.theirs.length), holes: String(m.holes.length), fromThem: String(m.fromThem.length) })); for (const n of m.theirs.slice(0, 10)) ctx.out.line(paint.dim(`   + ${n.title}`)); } });
    }
    case 'glossary': {
      const { terms } = await invoke('shared.glossary', {}, c);
      return out({ terms }, () => { for (const g of terms) ctx.out.line(`${paint.bold(g.term)}  ${paint.dim(g.definitions.map((d) => d.by ?? t('share.me')).join(' · '))}`); });
    }
    default:
      throw new OkbError('E_INVALID', `unknown share command "${sub}"`, { hint: 'okb share [status | setup | add <note|dossier> | remove | preview | send [--push] | receive | find <mots> | read <tiroir> <note> | keep <tiroir> <note> | map | glossary]' });
  }
}
