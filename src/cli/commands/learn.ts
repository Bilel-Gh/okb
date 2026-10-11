import { resolve } from 'node:path';
import { careerLeaks, careerPrep, careerStatus, exportCareer } from '../../career/career.js';
import { lang, t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { addObjective, dueCards, finishObjective, gradeCard, listObjectives, parseRating, quizMaterial, skillsMap } from '../../learn/learn.js';
import { findRepo } from '../../repo/registry.js';
import { OkbError } from '../../util/errors.js';
import { flagList, flagNumber, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

/**
 * `okb learn` — spaced review of the brain: what is due today, grading an
 * answer, the skills map, a quiz's material, learning objectives. The review
 * state lives in OKB's state folder; the KB is never written.
 */
export async function cmdLearn(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub = 'status', ...rest] = ctx.args.positionals;
  const bundle = await loadBundleFor(config);
  if (sub === 'grade') {
    const [id, raw] = rest;
    const rating = raw ? parseRating(raw) : null;
    if (!id || rating === null) throw new OkbError('E_INVALID', 'usage: okb learn grade <card-id> again|hard|good|easy', { key: 'learnGrade' });
    const r = await gradeCard(config, id, rating);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, ...r });
    else ctx.out.ok(t('learn.graded', { days: String(r.interval), level: t(`learn.level.${r.level}`) }));
    return 0;
  }
  if (sub === 'map') {
    const map = await skillsMap(config, bundle);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, subjects: map }); return 0; }
    if (!map.length) { ctx.out.info(t('learn.noCards')); return 0; }
    for (const m of map) ctx.out.line(`${bar(m.percent)} ${String(m.percent).padStart(3)}%  ${paint.bold(m.subject)}  ${paint.dim(`${m.cards} · ${m.levels.mastered}★ ${m.levels.known}✓ ${m.levels.learning}… ${m.levels.new}○`)}`);
    return 0;
  }
  if (sub === 'quiz') {
    const repoId = flagString(ctx.args, 'repo');
    const product = flagString(ctx.args, 'product');
    let folder = flagString(ctx.args, 'folder');
    if (repoId) {
      const repo = await findRepo(repoId);
      if (!repo) throw new OkbError('E_NOT_FOUND', `no repository "${repoId}"`, { key: 'devNoRepo' });
      const { repoPlace } = await import('../../brain/products.js');
      const { repoFolder } = await import('../../repo/pack.js');
      folder = repoFolder(repo.id, await repoPlace(config, repo)) || undefined;
    } else if (product) {
      const { layoutOf } = await import('../../brain/layout.js');
      const { productFolderIn } = await import('../../brain/address.js');
      const layout = layoutOf(config);
      if (layout) folder = productFolderIn(layout, product);
    }
    const note = flagString(ctx.args, 'note');
    const material = quizMaterial(config, bundle, { ...(folder ? { folder } : {}), ...(note ? { note } : {}) });
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, folder: folder ?? null, ...material }); return 0; }
    for (const n of material.notes) ctx.out.line(`📄 ${paint.bold(n.title)}  ${paint.dim(n.description)}`);
    ctx.out.line(paint.dim(t('learn.quizCards', { count: String(material.cards.length) })));
    return 0;
  }
  if (sub === 'goal' || sub === 'goals' || sub === 'objectif') {
    const [action = 'list', ...words] = rest;
    if (action === 'add') {
      const text = words.join(' ').trim();
      if (!text) throw new OkbError('E_INVALID', 'what do you want to learn?', { key: 'learnGoalText' });
      const subject = flagString(ctx.args, 'subject');
      const by = flagString(ctx.args, 'by');
      const o = await addObjective(config, { text, ...(subject ? { subject } : {}), ...(by ? { by } : {}) });
      if (ctx.mode === 'json') ctx.out.json({ ok: true, objective: o }); else ctx.out.ok(t('learn.goalAdded', { id: o.id }));
      return 0;
    }
    if (action === 'done') {
      const o = words[0] ? await finishObjective(config, words[0]) : null;
      if (!o) throw new OkbError('E_NOT_FOUND', `no objective "${words[0] ?? ''}"`, { key: 'learnGoalUnknown', params: { id: words[0] ?? '' } });
      if (ctx.mode === 'json') ctx.out.json({ ok: true, objective: o }); else ctx.out.ok(t('learn.goalDone', { text: o.text }));
      return 0;
    }
    const all = await listObjectives(config);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, objectives: all }); return 0; }
    for (const o of all) ctx.out.line(`${o.doneAt ? '✅' : '🎯'} ${o.text}${o.by ? paint.dim(` · ${o.by}`) : ''} ${paint.dim(o.id)}`);
    return 0;
  }
  // status / due: what to review now.
  const subject = flagString(ctx.args, 'subject');
  const note = flagString(ctx.args, 'note');
  const list = await dueCards(config, bundle, { limit: flagNumber(ctx.args, 'limit') ?? 20, ...(subject ? { subject } : {}), ...(note ? { note } : {}) });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...list, objectives: (await listObjectives(config)).filter((o) => !o.doneAt) }); return 0; }
  ctx.out.line(t('learn.status', { due: String(list.counts.due), fresh: String(list.fresh.length), cards: String(list.counts.cards) }));
  for (const c of [...list.due, ...list.fresh].slice(0, 10)) ctx.out.line(`   ${c.level === 'new' ? '○' : '↻'} ${c.front}  ${paint.dim(`${c.title} · ${c.id}`)}`);
  return 0;
}

const bar = (p: number) => { const n = Math.round(p / 10); return `${'█'.repeat(n)}${'░'.repeat(10 - n)}`; };

/**
 * `okb career` — where the career side stands, the material of a one-on-one or
 * an annual review, and the check before a portable copy leaves the company.
 */
export async function cmdCareer(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub = 'status', ...rest] = ctx.args.positionals;
  const bundle = await loadBundleFor(config);
  if (sub === 'prep') {
    const kind = rest[0] ?? 'one-on-one';
    const days = kind === 'annual' ? 365 : 30;
    const since = flagString(ctx.args, 'since') ?? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const prep = await careerPrep(config, bundle, since);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, kind, root: config.kb.root, ...prep }); return 0; }
    ctx.out.line(paint.bold(t('career.prep', { since })));
    for (const a of prep.achievements) ctx.out.line(`   🏆 ${a.date ?? ''} ${a.title}`);
    for (const tk of prep.tickets) ctx.out.line(`   🎫 ${tk.ref} — ${tk.title}`);
    for (const f of prep.feedback) ctx.out.line(`   💬 ${f.title}`);
    return 0;
  }
  if (sub === 'check' || sub === 'export') {
    const words = flagList(ctx.args, 'words');
    if (sub === 'export') {
      const to = rest[0] ?? flagString(ctx.args, 'to');
      if (!to) throw new OkbError('E_INVALID', 'where should the copy go?', { key: 'careerExportWhere' });
      const r = await exportCareer(config, bundle, resolve(to), words);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, to: resolve(to), ...r }); else ctx.out.ok(t('career.exported', { count: String(r.written.length), path: resolve(to) }));
      return 0;
    }
    const leaks = await careerLeaks(config, bundle, words);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, leaks }); return 0; }
    if (!leaks.length) { ctx.out.ok(t('career.clean')); return 0; }
    for (const l of leaks) ctx.out.line(`⚠️  ${l.path}:${l.line}  ${paint.bold(l.text)}  ${paint.dim(l.kind)}`);
    return 0;
  }
  const status = careerStatus(bundle);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, root: config.kb.root, ...status }); return 0; }
  ctx.out.line(t('career.status', { stories: String(status.achievements.length), feedback: String(status.feedback.count), open: String(status.goals.open), done: String(status.goals.done) }));
  for (const a of status.achievements.slice(0, 5)) ctx.out.line(`   🏆 ${a.date ?? ''} ${a.title} ${paint.dim(`${a.star.length}/4${a.hasProof ? ' · ✓' : ''}`)}`);
  for (const h of status.hints) ctx.out.line(paint.dim(`   → ${t(`career.hint.${h.key}`, { detail: h.detail })}`));
  return 0;
}

/**
 * `okb journal [--days N]` — what happened, day by day: notes created and
 * changed, tickets, commits, decisions, sessions, suggestions, reviews. The
 * daily stand-up and the weekly report are written from it; nothing is written.
 */
export async function cmdJournal(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  // `okb journal add "<line>" [--project P] [--kind decision]` and `okb journal --project P`: the lines of the day and of a project.
  const projectFlag = flagString(ctx.args, 'project');
  if (ctx.args.positionals[0] === 'add' || projectFlag) {
    const { invoke } = await import('../../engine/registry.js');
    const { actorOf } = await import('./common.js');
    const c = { config, env: process.env, actor: actorOf() };
    let project: string | undefined;
    if (projectFlag) {
      const { projects } = await invoke('projects.list', { status: 'all' }, c);
      const low = projectFlag.toLowerCase();
      project = (projects.find((p) => p.id.toLowerCase() === low) ?? projects.find((p) => p.ref?.toLowerCase() === low) ?? projects.find((p) => p.title.toLowerCase() === low))?.id;
      if (!project) throw new OkbError('E_NOT_FOUND', `no project "${projectFlag}"`, { key: 'projectUnknown', params: { id: projectFlag }, hint: 'okb project' });
    }
    if (ctx.args.positionals[0] === 'add') {
      const entry = await invoke('journal.add', { text: ctx.args.positionals.slice(1).join(' '), ...(flagString(ctx.args, 'kind') ? { kind: flagString(ctx.args, 'kind') } : {}), ...(project ? { project } : {}) }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true, entry }); else ctx.out.ok(entry.text);
      return 0;
    }
    const { entries } = await invoke('journal.list', { project: project! }, c);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, entries }); return 0; }
    for (const e of entries) ctx.out.line(`${paint.dim(`${e.day} · ${e.kind}`)}  ${e.text}`);
    return 0;
  }
  // `okb journal mardi`, `okb journal hier`, `okb journal 2027-03-02`: what happened that day.
  if (ctx.args.positionals.length) {
    const { invoke } = await import('../../engine/registry.js');
    const { actorOf } = await import('./common.js');
    const view = await invoke('day.view', { day: ctx.args.positionals.join(' ') }, { config, env: process.env, actor: actorOf() });
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...view }); return 0; }
    ctx.out.heading(new Date(`${view.day}T12:00:00`).toLocaleDateString(lang() === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    if (!view.entries.length) ctx.out.info(t('day.nothing'));
    for (const e of view.entries) ctx.out.line(`${paint.dim(`${e.at.slice(11, 16)} · ${e.kind}`)}  ${e.text}${e.project ? paint.dim(` · ${e.project.title}`) : ''}`);
    return 0;
  }
  const { journal } = await import('../../journal/journal.js');
  const j = await journal(config, await loadBundleFor(config), { days: flagNumber(ctx.args, 'days') ?? 7 });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...j }); return 0; }
  if (!j.days.length) { ctx.out.info(t('journal.empty', { from: j.from })); return 0; }
  for (const d of j.days) {
    ctx.out.line(paint.bold(d.date));
    for (const n of d.created) ctx.out.line(`   ＋ ${n.title}`);
    for (const n of d.updated) ctx.out.line(`   ✎ ${n.title}`);
    for (const tk of d.ticketsDone) ctx.out.line(`   ✅ ${tk.ref} — ${tk.title}`);
    for (const tk of d.ticketsStarted) ctx.out.line(`   ▶ ${tk.ref} — ${tk.title}`);
    if (d.commits.length) ctx.out.line(paint.dim(`   ${t('journal.commits', { count: String(d.commits.length) })}`));
    for (const s of d.sessions) ctx.out.line(`   🗒  ${s.summary}`);
    if (d.reviews) ctx.out.line(paint.dim(`   ${t('journal.reviews', { count: String(d.reviews) })}`));
  }
  return 0;
}

/**
 * `okb secret` — confidentiality. `list`: the 🔒 notes of the KB. `set <note>
 * secret|private|normal`: a proposal the person approves. `allow --prompt`:
 * called by the plugin's hook with the person's own message, it opens the 🔒
 * notes they named to Claude for 30 minutes (a tool call cannot: the guard
 * refuses it).
 */
export async function cmdSecret(ctx: Ctx): Promise<number> {
  const [sub = 'list', ...rest] = ctx.args.positionals;
  const conf = await import('../../security/confidential.js');
  if (sub === 'allow') {
    const prompt = flagString(ctx.args, 'prompt') ?? '';
    const { listKbs } = await import('../../kb/registry.js');
    const { loadConfig } = await import('../../config/load.js');
    const configs = [];
    for (const kb of await listKbs()) if (kb.exists) configs.push((await loadConfig({ profileId: kb.id }).catch(() => null))?.config);
    const opened = await conf.unlockFromPrompt(prompt, configs.filter((c): c is NonNullable<typeof c> => Boolean(c)));
    if (ctx.mode === 'json') ctx.out.json({ ok: true, opened }); else if (opened.length) ctx.out.ok(t('secret.opened', { count: String(opened.length) }));
    return 0;
  }
  const { config } = await effective(ctx.args);
  if (sub === 'set') {
    const [note, level] = rest;
    if (!note || !level) throw new OkbError('E_INVALID', 'usage: okb secret set <note> secret|private|normal', { key: 'secretLevel', params: { levels: conf.LEVELS.join(', ') } });
    const proposal = await conf.proposeConfidentiality(config, note, level as never);
    const { saveProposal } = await import('../../proposal/store.js');
    await saveProposal(config, proposal);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: proposal.id });
    else { ctx.out.ok(t('secret.proposed', { path: note, level })); ctx.out.next([`okb review ${proposal.id}`]); }
    return 0;
  }
  const notes = conf.secretNotes(await loadBundleFor(config));
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, notes }); return 0; }
  if (!notes.length) { ctx.out.info(t('secret.none')); return 0; }
  for (const n of notes) ctx.out.line(`🔒 ${n.title}  ${paint.dim(n.path)}`);
  return 0;
}
