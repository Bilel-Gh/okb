import { invoke } from '../../engine/registry.js';
import type { Team } from '../../work/team.js';
import { t } from '../../i18n/index.js';
import { OkbError } from '../../util/errors.js';
import { flagList, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { actorOf, effective, type Ctx } from './common.js';

const USAGE = 'okb team <repo|product> <name> | set <repo|product> <name> --value "…" [--origin …] [--url …] | clear|ask|na <repo|product> <name> [--reason …] | conflict <repo|product> <name> mine|<origin> | requests [list|prompt <id>|close <id> --found … --missing … --read … --unavailable …|cancel <id>]';
const usage = () => new OkbError('E_INVALID', USAGE, { key: 'usage', params: { usage: USAGE } });

/**
 * `okb team` — the team responsible for a repository or a product (F2.4-19,
 * F2.4-20, D73): read it, write it with its origin, ask the agent to find it.
 */
export async function cmdTeam(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const c = { config, env: process.env, actor: actorOf() };
  const [first, a1, a2, a3] = ctx.args.positionals;
  const target = (kind?: string, name?: string) => {
    if ((kind !== 'repo' && kind !== 'product') || !name) throw usage();
    return { kind: kind as 'repo' | 'product', subject: name };
  };
  const show = (team: Team) => {
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, team }); return 0; }
    const v = team.value;
    if (v) ctx.out.line(`${paint.bold(v.value)}  ${paint.dim(`· ${v.origin} · ${v.at.slice(0, 10)}${v.url ? ` · ${v.url}` : ''}`)}`);
    else if (team.notApplicable) ctx.out.line(paint.dim(t('team.na', { reason: team.notApplicable })));
    else if (team.inherited) ctx.out.line(`${team.inherited.value.value}  ${paint.dim(`· ${t('team.inherited', { product: team.inherited.product })}`)}`);
    else ctx.out.info(t('team.none'));
    for (const x of team.conflicts) ctx.out.warn(t('team.conflict', { value: x.value, origin: x.origin }));
    if (team.suggestion) ctx.out.tip(t('team.suggestion', { value: team.suggestion.value }));
    if (team.request) ctx.out.tip(t('team.asked', { id: team.request.id }));
    return 0;
  };
  switch (first) {
    case 'repo': case 'product': return show(await invoke('team.get', target(first, a1), c));
    case 'set': return show((await invoke('team.set', { ...target(a1, a2), value: flagString(ctx.args, 'value') ?? '', ...(flagString(ctx.args, 'origin') ? { origin: flagString(ctx.args, 'origin') as never } : {}), ...(flagString(ctx.args, 'url') ? { url: flagString(ctx.args, 'url') } : {}) }, c)).team);
    case 'clear': return show(await invoke('team.clear', target(a1, a2), c));
    case 'na': return show(await invoke('team.na', { ...target(a1, a2), reason: flagString(ctx.args, 'reason') ?? '' }, c));
    case 'conflict': if (!a3) throw usage(); return show(await invoke('team.conflict.resolve', { ...target(a1, a2), keep: a3 as never }, c));
    case 'ask': {
      const req = await invoke('team.requests.create', target(a1, a2), c);
      const { prompt } = await invoke('team.requests.prompt', { id: req.id, lang: (config.profile.answer.language ?? 'fr').startsWith('fr') ? 'fr' : 'en' }, c);
      if (ctx.mode === 'json') { ctx.out.json({ ok: true, request: req, prompt }); return 0; }
      ctx.out.ok(t('team.asked', { id: req.id }));
      ctx.out.line(paint.dim(prompt));
      return 0;
    }
    case 'requests': {
      const list = (flag: string) => flagList(ctx.args, flag);
      if (!a1 || a1 === 'list') {
        const { requests } = await invoke('team.requests.list', {}, c);
        if (ctx.mode === 'json') { ctx.out.json({ ok: true, requests }); return 0; }
        if (!requests.length) ctx.out.info(t('team.noRequests'));
        for (const r of requests) ctx.out.line(`  ${r.id}  ${r.kind} ${r.subject}  ${paint.dim(r.createdAt.slice(0, 10))}`);
        return 0;
      }
      if (!a2) throw usage();
      if (a1 === 'prompt') { const r = await invoke('team.requests.prompt', { id: a2, lang: (config.profile.answer.language ?? 'fr').startsWith('fr') ? 'fr' : 'en' }, c); if (ctx.mode === 'json') ctx.out.json({ ok: true, ...r }); else ctx.out.line(r.prompt); return 0; }
      if (a1 === 'cancel') { await invoke('team.requests.cancel', { id: a2 }, c); if (ctx.mode === 'json') ctx.out.json({ ok: true }); else ctx.out.ok(t('team.cancelled')); return 0; }
      if (a1 === 'close') {
        const r = await invoke('team.requests.close', { id: a2, found: list('found'), missing: list('missing'), read: list('read'), unavailable: list('unavailable'), note: flagString(ctx.args, 'note') ?? '' }, c);
        if (ctx.mode === 'json') ctx.out.json({ ok: true, request: r }); else ctx.out.ok(t('team.closed', { state: r.state }));
        return 0;
      }
      throw usage();
    }
    default: throw usage();
  }
}
