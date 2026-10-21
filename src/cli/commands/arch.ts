import { checkDiagram, type Finding } from '../../arch/check.js';
import type { ArchLink, SystemModel } from '../../arch/model.js';
import { systemOf } from '../../arch/system.js';
import { containersView, contextView, entryPoints, flowView, type View } from '../../arch/views.js';
import { t } from '../../i18n/index.js';
import { OkbError } from '../../util/errors.js';
import { flagBool, flagString } from '../args.js';
import { invoke } from '../../engine/registry.js';
import { paint } from '../ui/term.js';
import { actorOf, effective, type Ctx } from './common.js';

const VIEWS = ['containers', 'context', 'flow'] as const;
const USAGE = 'okb arch [containers|context|flow] [<repo> "<call>"] [--mermaid] [--anyway] · okb arch link list|confirm|exclude|retarget|add|reset … · okb arch url <host> <role|forget> · okb arch conflict <key> mine|agent';
const LINK_USAGE = 'okb arch link list | confirm <key> [--reason …] | exclude <key> --reason … | retarget <key> <repo:name|ext:host> [--reason …] | add <repo:from> <repo:to|ext:host> --kind http|event|package|service|data|external [--what …] [--reason …] | reset <key>';

/**
 * `okb arch` — the architecture of the repositories of a KB, computed from their
 * scans: who calls whom, with the evidence on both sides; the gaps as questions.
 * The diagram checks itself first; below 80 the gaps are shown, not the diagram.
 */
export async function cmdArch(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [which = 'containers', fromArg, callArg] = ctx.args.positionals;
  if (which === 'link' || which === 'url' || which === 'conflict') return corrections(ctx, config);
  if (!(VIEWS as readonly string[]).includes(which)) throw new OkbError('E_INVALID', USAGE, { key: 'usage', params: { usage: USAGE } });
  const sys = await systemOf(config);
  if (!sys) {
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, system: null }); return 0; }
    ctx.out.info(t('arch.none'));
    ctx.out.next(['okb workspace add <folder>', 'okb repo scan']);
    return 0;
  }
  const { model, name, lang } = sys;
  let view: View & { steps?: unknown };
  if (which === 'context') view = contextView(model, name, { lang });
  else if (which === 'flow') {
    const start = fromArg ? (fromArg.startsWith('repo:') ? fromArg : `repo:${fromArg}`) : entryPoints(model)[0]?.repo;
    const call = callArg ?? (start ? model.links.filter((l) => l.from === start && l.kind === 'http').flatMap((l) => l.calls).sort((a, b) => a.line - b.line)[0]?.what : undefined);
    if (!start || !call) {
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, system: name, view: null, entryPoints: entryPoints(model) }); return 0; }
      ctx.out.info(t('arch.noEntry'));
      return 0;
    }
    view = flowView(model, start, call, { lang });
  } else view = containersView(model, { lang });
  const check = checkDiagram(model, view);

  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, system: name, view, check, questions: model.questions, entryPoints: entryPoints(model), counts: { repos: model.nodes.filter((n) => n.kind === 'repo').length, links: model.links.length } });
    return 0;
  }
  const label = labeller(model, view);
  if (flagBool(ctx.args, 'mermaid')) {
    if (check.score < 80 && !flagBool(ctx.args, 'anyway')) {
      ctx.out.warn(t('arch.lowScore', { score: check.score }));
      for (const f of check.findings) ctx.out.line(`  ${t(`arch.finding.${f.code}`, { target: label(f.target) })}`);
      return 1;
    }
    ctx.out.line(view.mermaid);
    return 0;
  }

  const repos = model.nodes.filter((n) => n.kind === 'repo').length;
  if (view.kind === 'flow') ctx.out.line(paint.bold(t('arch.flowTitle', { from: label(view.arrows[0]?.from ?? ''), call: view.arrows[0]?.calls[0]?.what ?? '' })));
  else if (view.kind === 'context') ctx.out.line(paint.bold(t('arch.contextTitle', { name })));
  else ctx.out.line(paint.bold(t('arch.title', { name, repos, links: model.links.length })));
  ctx.out.line();
  if (!view.arrows.length) ctx.out.line(paint.dim(`  ${t('arch.noLinks')}`));
  view.arrows.forEach((a, i) => {
    const head = view.kind === 'flow' ? `${i + 1}. ` : '';
    // The calls, unless the verb or the target already says them (« utilise @acme/money », an outside host).
    const said = a.calls.map((c) => c.what).filter((w) => !a.verb.includes(w) && w !== label(a.to));
    const what = said.length ? ` ${paint.dim(`(${said.slice(0, 3).join(', ')}${said.length > 3 ? ', …' : ''})`)}` : '';
    const sure = a.certainty ? t(`arch.cert.${a.certainty}`) : t(`arch.conf.${a.confidence}`);
    ctx.out.line(`  ${head}${paint.name(label(a.from))} ${paint.dim('→')} ${paint.name(label(a.to))}  ${a.verb}${what}  ${paint.dim(`· ${sure}`)}`);
    ctx.out.line(`     ${paint.dim(proof(a))}`);
  });
  if (model.questions.length && view.kind !== 'context') {
    ctx.out.line();
    ctx.out.line(paint.bold(t('arch.questions')));
    for (const q of model.questions) ctx.out.line(`  ? ${q.what}  ${paint.dim(`${q.repo} ${q.evidence.file}:${q.evidence.line} — ${q.named ? t('arch.q.noRoute', { repo: q.named }) : t('arch.q.nobody')}`)}`);
  }
  ctx.out.line();
  offMapSummary(ctx, model);
  ctx.out.line(t('arch.score', { score: check.score }));
  for (const f of check.findings.filter((x: Finding) => x.code !== 'to-confirm')) ctx.out.line(paint.dim(`  ${t(`arch.finding.${f.code}`, { target: label(f.target) })}`));
  ctx.out.next(['okb arch --mermaid', 'okb arch flow', 'okb arch context']);
  return 0;
}

/** Ids as people read them: a box by its name, a link as « from → to ». */
function labeller(model: SystemModel, view: View): (id: string) => string {
  const nodes = new Map([...model.nodes, ...view.boxes].map((n) => [n.id, n.name]));
  const links = new Map<string, ArchLink>([...model.links, ...view.arrows].map((l) => [l.id, l]));
  return (id) => {
    const link = links.get(id);
    if (link) return `${nodes.get(link.from) ?? link.from} → ${nodes.get(link.to) ?? link.to}`;
    return nodes.get(id) ?? id;
  };
}

const proof = (a: ArchLink) => a.evidence.slice(0, 2).map((e) => `${e.repo} ${e.file}:${e.line}`).join('  ↔  ') + (a.evidence.length > 2 ? `  +${a.evidence.length - 2}` : '');

/** What the repositories write that is not on the map, counted by role (F2.4-15), and the person's corrections. */
function offMapSummary(ctx: Ctx, model: SystemModel): void {
  const counts = new Map<string, Set<string>>();
  for (const o of model.offMap ?? []) counts.set(o.role, new Set([...(counts.get(o.role) ?? []), o.host]));
  if (counts.size) ctx.out.line(paint.dim(t('arch.offMap', { list: [...counts].map(([role, hosts]) => `${hosts.size} ${t(`arch.role.${role}`)}`).join(' · ') })));
  if (model.excluded?.length) ctx.out.line(paint.dim(t('arch.excludedCount', { n: model.excluded.length })));
  if (model.stale?.length) ctx.out.line(paint.dim(t('arch.staleCount', { n: model.stale.length })));
  if (model.conflicts?.length) ctx.out.warn(t('arch.conflictCount', { n: model.conflicts.length }));
}

/** `okb arch link …`, `okb arch url …`, `okb arch conflict …`: the person's corrections of the map (F2.4-17, D72). */
async function corrections(ctx: Ctx, config: Awaited<ReturnType<typeof effective>>['config']): Promise<number> {
  const [which, verb, a1, a2] = ctx.args.positionals;
  const c = { config, env: process.env, actor: actorOf() };
  const reason = flagString(ctx.args, 'reason') ?? '';
  const say = (r: { changed?: boolean; conflict?: boolean }) => {
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...r }); return 0; }
    if (r.conflict) ctx.out.warn(t('arch.link.conflict'));
    else ctx.out.ok(r.changed === false ? t('arch.link.same') : t('arch.link.kept'));
    return 0;
  };
  if (which === 'url') {
    if (!verb || !a1) throw new OkbError('E_INVALID', USAGE, { key: 'usage', params: { usage: USAGE } });
    await invoke('arch.url.classify', { host: verb, role: a1 === 'forget' ? null : a1 }, c);
    if (ctx.mode === 'json') ctx.out.json({ ok: true }); else ctx.out.ok(a1 === 'forget' ? t('arch.url.forgot', { host: verb }) : t('arch.url.kept', { host: verb, role: t(`arch.role.${a1}`) }));
    return 0;
  }
  if (which === 'conflict') {
    if (!verb || (a1 !== 'mine' && a1 !== 'agent')) throw new OkbError('E_INVALID', USAGE, { key: 'usage', params: { usage: USAGE } });
    await invoke('arch.conflict.resolve', { key: verb, keep: a1 }, c);
    if (ctx.mode === 'json') ctx.out.json({ ok: true }); else ctx.out.ok(t('arch.conflict.settled'));
    return 0;
  }
  switch (verb) {
    case 'list': case undefined: {
      const map = await invoke('arch.map', {}, c);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...map }); return 0; }
      if (!map.system) { ctx.out.info(t('arch.none')); return 0; }
      ctx.out.line(paint.bold(t('arch.links.title', { name: map.system })));
      for (const l of map.links) ctx.out.line(`  ${l.key}  ${paint.dim(`· ${l.certainty ? t(`arch.cert.${l.certainty}`) : ''}${l.basis ? ` — ${l.basis}` : ''}`)}`);
      if (map.excluded.length) { ctx.out.line(); ctx.out.line(paint.bold(t('arch.links.excluded'))); for (const x of map.excluded) ctx.out.line(`  ${x.key}  ${paint.dim(x.reason)}`); }
      if (map.stale.length) { ctx.out.line(); ctx.out.line(paint.bold(t('arch.links.stale'))); for (const x of map.stale) ctx.out.line(`  ${x.key}  ${paint.dim(`${x.action} · ${x.at.slice(0, 10)}`)}`); }
      return 0;
    }
    case 'confirm': return say(await invoke('arch.link.confirm', { key: a1 ?? '', reason }, c));
    case 'exclude': return say(await invoke('arch.link.exclude', { key: a1 ?? '', reason }, c));
    case 'retarget': return say(await invoke('arch.link.retarget', { key: a1 ?? '', target: a2 ?? '', reason }, c));
    case 'add': {
      const kind = flagString(ctx.args, 'kind') ?? 'http';
      const what = flagString(ctx.args, 'what');
      return say(await invoke('arch.link.add', { from: a1 ?? '', to: a2 ?? '', kind: kind as never, ...(what ? { what } : {}), reason }, c));
    }
    case 'reset': {
      await invoke('arch.link.reset', { key: a1 ?? '' }, c);
      if (ctx.mode === 'json') ctx.out.json({ ok: true }); else ctx.out.ok(t('arch.link.reset'));
      return 0;
    }
    default: throw new OkbError('E_INVALID', LINK_USAGE, { key: 'usage', params: { usage: LINK_USAGE } });
  }
}

