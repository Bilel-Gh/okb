import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadConfig } from '../../config/load.js';
import type { OkbConfig } from '../../config/schema.js';
import { t, tn } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { saveProposal } from '../../proposal/store.js';
import { missingConceptsFor } from '../../pipeline/ask.js';
import { proposeLandscape } from '../../repo/generated.js';
import { currentBranch, revParse } from '../../repo/git.js';
import { repoContext } from '../../repo/notes.js';
import { repoPlace } from '../../brain/products.js';
import { kindOf, setKbKind } from '../../work/kinds.js';
import { addRepo, findRepo, listRepos, type RepoEntry } from '../../repo/registry.js';
import { scanAndStore } from '../../repo/scan.js';
import { ticketContext } from '../../repo/ticket.js';
import { OkbError } from '../../util/errors.js';
import { buildBrief, headline, renderBrief, type Brief } from '../../work/brief.js';
import { tiedNotes } from '../../work/rank.js';
import { chooseScope, resolveScope, scopeFor, workspaceOfRepo, workspaceRepos, type Scope } from '../../work/scope.js';
import { addJournal, finishTicket, listTickets, loadTicket, NOTE_KINDS, syncTicket, ticketId, ticketText, titleFrom, type TicketRecord } from '../../work/tickets.js';
import { addWorkspace, findWorkspace, learnPrefixes, listWorkspaces, looksLikeNotes, removeWorkspace, reposIn, ticketRefs, updateWorkspace, workspaceForDir, type Workspace } from '../../work/workspaces.js';
import { flagBool, flagList, flagString, flagValues } from '../args.js';
import { choose, input, spin } from '../ui/prompt.js';
import { paint, sym, tilde } from '../ui/term.js';
import { actorOf, canAsk, effective, type Ctx } from './common.js';
import { invoke } from '../../engine/registry.js';
import { ticketDetail } from '../../work/ticket-state.js';
import { chooseKb } from './repo.js';

/**
 * `okb workspace`, `okb scope`, `okb ticket` — working across many
 * repositories with one KB. A workspace is the folder of a team's
 * repositories; the scope narrows OKB to the repository (and ticket) the
 * person works on; a ticket is followed from its branch and commits, with a
 * journal of what the work taught. All of it is local state: knowledge
 * reaches the KB only through proposals the person approves (/okb-dev:ticket).
 */

function cwdOf(ctx: Ctx): string {
  return resolve(flagString(ctx.args, 'cwd') ?? process.cwd());
}

function kbName(config: OkbConfig): string {
  return config.profile.displayName || config.profile.id;
}

/* ============================================================ workspace */

export async function cmdWorkspace(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0];
  switch (sub) {
    case undefined: case 'list': case 'ls': return workspaceList(ctx);
    case 'add': return workspaceAdd(ctx, ctx.args.positionals[1] ?? process.cwd());
    case 'set': case 'edit': return workspaceSet(ctx);
    case 'remove': case 'rm': case 'forget': return workspaceRemove(ctx);
    case 'attach': case 'detach': return workspaceAttach(ctx, sub === 'attach');
    default: {
      if (await findWorkspace(sub)) return workspaceList({ ...ctx, args: { ...ctx.args, positionals: ['list', sub] } });
      throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb workspace [add|set|attach|detach|remove]' } });
    }
  }
}

async function workspaceList(ctx: Ctx): Promise<number> {
  const only = ctx.args.positionals[1];
  const list = (await listWorkspaces()).filter((w) => !only || w.id === only || w.name === only);
  const repos = await listRepos();
  const here = await workspaceForDir(process.cwd());
  if (ctx.mode === 'json') {
    const { readCurrent } = await import('../../work/scope.js');
    ctx.out.json({ ok: true, here: here?.id ?? null, workspaces: await Promise.all(list.map(async (w) => ({ ...w, repos: repos.filter((r) => r.kb === w.kb).map((r) => r.id), current: await readCurrent(w.id) }))) });
    return 0;
  }
  if (!list.length) {
    ctx.out.info(t('ws.none'));
    ctx.out.tip(t('ws.noneTip'));
    ctx.out.next(['okb workspace add <dossier>']);
    return 0;
  }
  const { readCurrent } = await import('../../work/scope.js');
  ctx.out.line(paint.bold(t('ws.title')));
  for (const w of list) {
    const mine = repos.filter((r) => r.kb === w.kb);
    const current = await readCurrent(w.id);
    ctx.out.line();
    ctx.out.line(`  🗂️  ${paint.name(w.name)}${here?.id === w.id ? paint.dim(`  ${t('ws.here')}`) : ''}`);
    ctx.out.line(paint.dim(`     ${t('ws.line', { kb: w.kb, n: mine.length, roots: w.roots.map(tilde).join(', ') })}`));
    ctx.out.line(paint.dim(`     ${w.tickets.pattern ? t('ws.pattern', { pattern: w.tickets.pattern }) : w.tickets.prefixes.length ? t('ws.prefixes', { prefixes: w.tickets.prefixes.join(', ') }) : t('ws.noPrefixes')}`));
    if (current?.repo) ctx.out.line(`     🎯 ${t('ws.current', { repo: current.repo })}${current.ticket ? ` · 🎫 ${current.ticket}` : ''}`);
  }
  ctx.out.next(['okb scope', 'okb ticket list']);
  return 0;
}

/**
 * `okb workspace add <folder>`: every repository in the folder registered in
 * one KB and mapped without AI, the team's ticket prefixes learned from branch
 * names, and the map of how the repositories connect proposed for approval.
 */
export async function workspaceAdd(ctx: Ctx, folderArg: string): Promise<number> {
  const { args, out } = ctx;
  const folder = resolve(folderArg);
  // A folder of notes under Git (a KB written before OKB) is not a code repository: it is connected, not onboarded.
  const found = await reposIn(folder);
  const notes: string[] = [];
  const roots: string[] = [];
  for (const r of found) (await looksLikeNotes(r) ? notes : roots).push(r);
  if (!roots.length) throw new OkbError('E_NOT_FOUND', `no Git repository in ${folder}`, { key: 'repoNoneInFolder', params: { folder }, hint: t('ws.layoutHint') });
  const into = flagString(args, 'to') ?? flagString(args, 'workspace');
  const target = into ? await findWorkspace(into) : await workspaceForDir(folder);
  if (into && !target) throw new OkbError('E_NOT_FOUND', `workspace "${into}" does not exist`, { key: 'workspaceUnknown', params: { id: into } });
  // One repository only: a KB for it alone is simpler — unless more are coming.
  const single = roots.length === 1 && !target;
  if (single && !flagString(args, 'kb') && !flagString(args, 'new-kb')) {
    if (canAsk(ctx)) {
      const choice = await choose(t('ws.single.q', { name: basename(roots[0]!) }), [
        { value: 'repo', label: t('ws.single.repo'), hint: t('ws.single.repoHint'), recommended: true },
        { value: 'workspace', label: t('ws.single.ws'), hint: t('ws.single.wsHint') },
      ]);
      if (choice === 'repo') {
        const { cmdRepo } = await import('./repo.js');
        return cmdRepo({ ...ctx, args: { ...args, positionals: ['add', roots[0]!] } });
      }
    }
  }
  const kb = target && !flagString(args, 'kb') && !flagString(args, 'new-kb') ? target.kb : await chooseKb(ctx, folder, 'workspace');
  let name = flagString(args, 'name') ?? target?.name;
  if (!name && canAsk(ctx)) name = await input(t('ws.nameQ'), { placeholder: basename(folder) });
  const { config } = await loadConfig({ profileId: kb });
  // The KB now holds a team's repositories: say so (its notes go to repos/<id>/).
  if (!config.kb.kind || config.kb.kind === 'topic') await setKbKind(kb, 'workspace');
  const scan = flagBool(args, 'scan', true);
  const registered = await listRepos();
  const rows: { name: string; id: string; stack: string; created: boolean; attached?: string; error?: string }[] = [];
  const s = canAsk(ctx) ? spin(t('repo.addAll.running', { n: String(roots.length) })) : null;
  const toScan: { repo: Awaited<ReturnType<typeof addRepo>>['repo']; row: number }[] = [];
  for (const root of roots) {
    try {
      // A repository that has its own KB keeps it: attached to the workspace, it gets the shared part from here.
      const prior = registered.find((r) => resolve(r.path) === resolve(root));
      if (prior && prior.kb !== kb && (await kindOf(prior.kb)) === 'repo') {
        rows.push({ name: prior.name, id: prior.id, created: false, stack: '', attached: prior.kb });
        continue;
      }
      const { repo, created } = await addRepo({ path: root, kb });
      toScan.push({ repo, row: rows.length });
      rows.push({ name: repo.name, id: repo.id, created, stack: '' });
    } catch (e) {
      rows.push({ name: basename(root), id: '', created: false, stack: '', error: (e as Error).message });
    }
  }
  // Registering writes one shared list, so it goes one by one; each scan writes only its own repository's state: four at a time.
  if (scan) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, toScan.length) }, async () => {
      while (next < toScan.length) {
        const item = toScan[next++]!;
        try {
          const result = await scanAndStore(config, item.repo);
          rows[item.row] = { ...rows[item.row]!, stack: result.map.stack.slice(0, 3).map((x) => x.label).join(', ') };
        } catch (e) {
          rows[item.row] = { ...rows[item.row]!, error: (e as Error).message };
        }
      }
    }));
  }
  const given = flagList(args, 'prefixes').map((p) => p.toUpperCase());
  const prefixes = given.length ? given : await learnPrefixes(roots).catch(() => [] as string[]);
  s?.done();
  const { workspace, created } = await addWorkspace({
    root: folder, kb, ...(name ? { name } : {}), ...(target && into ? { into: target.id } : {}),
    prefixes, ...(flagString(args, 'pattern') ? { pattern: flagString(args, 'pattern')! } : {}),
  });
  let landscape: string | null = null;
  if (rows.filter((r) => !r.error).length > 1 && flagBool(args, 'landscape', true)) {
    const proposal = await proposeLandscape(config).catch(() => null);
    if (proposal?.changes.length) { await saveProposal(config, proposal); landscape = proposal.id; }
  }
  if (ctx.mode === 'json') { out.json({ ok: true, created, workspace, kb, repos: rows, notesFolders: notes, prefixes: workspace.tickets.prefixes, landscapeProposal: landscape, ...(single ? { advice: 'single-repo' } : {}) }); return 0; }
  out.ok(t(created ? 'ws.added' : 'ws.updated', { name: paint.name(workspace.name), n: rows.filter((r) => !r.error).length, kb: paint.name(kbName(config)) }));
  out.grid(rows.map((r) => [r.error ? sym.err() : r.attached ? '🔗' : r.created ? sym.ok() : '·', paint.bold(r.name), r.error ? paint.err(r.error) : r.attached ? paint.dim(t('ws.attachedRow', { kb: r.attached })) : paint.dim(r.stack || '—')]));
  if (single && !canAsk(ctx)) out.tip(t('ws.single.tip'));
  for (const n of notes) out.tip(t('ws.notesFolder', { folder: tilde(n) }));
  out.line();
  out.line(`  ${workspace.tickets.prefixes.length ? t('ws.learned', { prefixes: paint.bold(workspace.tickets.prefixes.join(', ')) }) : paint.dim(t('ws.noPrefixesYet'))}`);
  if (landscape) out.line(`  ${t('ws.landscape', { id: paint.bold(landscape) })}`);
  out.line();
  // The example speaks the team's language: its ticket prefix and one of its repositories.
  const example = { ref: `${workspace.tickets.prefixes[0] ?? 'ABC'}-123`, repo: rows.find((r) => !r.error)?.id ?? 'repo' };
  out.box(t('ws.howTo', { folder: tilde(folder), ...example }).split('\n'), t('ws.howToTitle'), 'brand');
  out.next([...(landscape ? [`okb review ${landscape}`] : []), `cd ${tilde(folder)} && claude`, `okb ticket start ${example.ref} --repo ${example.repo}`]);
  return 0;
}

async function workspaceSet(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[1] ?? (await workspaceForDir(process.cwd()))?.id;
  if (!id) throw new OkbError('E_INVALID', 'which workspace?', { key: 'usage', params: { usage: 'okb workspace set <workspace> --prefixes ABC,XYZ | --pattern <regex> | --name <name>' } });
  const ws = await findWorkspace(id);
  if (!ws) throw new OkbError('E_NOT_FOUND', `workspace "${id}" does not exist`, { key: 'workspaceUnknown', params: { id } });
  const prefixes = flagString(ctx.args, 'prefixes') !== undefined ? flagList(ctx.args, 'prefixes') : undefined;
  const pattern = flagString(ctx.args, 'pattern');
  const updated = await updateWorkspace(ws.id, {
    ...(flagString(ctx.args, 'name') ? { name: flagString(ctx.args, 'name')! } : {}),
    ...(prefixes ? { prefixes } : {}),
    ...(pattern !== undefined ? { pattern: pattern === '' || pattern === 'none' ? null : pattern } : {}),
  });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, workspace: updated });
  else ctx.out.ok(t('ws.set', { name: paint.name(updated.name) }));
  return 0;
}

/**
 * `okb workspace attach <repo>`: a repository with its own KB, kept outside
 * the workspace's folders, joins it anyway — its notes stay in its KB, the
 * shared part comes from the workspace's. `detach` undoes it.
 */
async function workspaceAttach(ctx: Ctx, attach: boolean): Promise<number> {
  const repoArg = ctx.args.positionals[1];
  if (!repoArg) throw new OkbError('E_INVALID', 'usage: okb workspace attach <repo> [--to <workspace>]', { key: 'usage', params: { usage: 'okb workspace attach <repo> [--to <espace>]' } });
  const repo = await findRepo(repoArg);
  if (!repo) throw new OkbError('E_NOT_FOUND', `repository "${repoArg}" is not registered`, { key: 'repoUnknown', params: { id: repoArg } });
  const wsArg = flagString(ctx.args, 'to') ?? flagString(ctx.args, 'workspace');
  const ws = wsArg ? await findWorkspace(wsArg) : (await workspaceForDir(process.cwd())) ?? ((await listWorkspaces()).length === 1 ? (await listWorkspaces())[0]! : null);
  if (!ws) throw new OkbError('E_NOT_FOUND', 'which workspace?', { key: 'workspaceUnknown', params: { id: wsArg ?? '' } });
  if (attach && repo.kb === ws.kb) {
    if (ctx.mode === 'json') ctx.out.json({ ok: true, workspace: ws.id, repo: repo.id, already: true });
    else ctx.out.info(t('ws.attach.already', { repo: repo.name, ws: ws.name }));
    return 0;
  }
  const updated = await updateWorkspace(ws.id, attach ? { attach: repo.id } : { detach: repo.id });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, workspace: updated.id, repo: repo.id, attached: updated.attached.includes(repo.id) });
  else ctx.out.ok(t(attach ? 'ws.attach.done' : 'ws.attach.undone', { repo: paint.name(repo.name), ws: paint.name(ws.name), kb: repo.kb }));
  return 0;
}

async function workspaceRemove(ctx: Ctx): Promise<number> {
  const id = ctx.args.positionals[1];
  if (!id) throw new OkbError('E_INVALID', 'usage: okb workspace remove <workspace>', { key: 'usage', params: { usage: 'okb workspace remove <workspace>' } });
  const ws = await findWorkspace(id);
  if (!ws) throw new OkbError('E_NOT_FOUND', `workspace "${id}" does not exist`, { key: 'workspaceUnknown', params: { id } });
  await removeWorkspace(ws.id);
  if (ctx.mode === 'json') ctx.out.json({ ok: true, removed: ws });
  else ctx.out.ok(t('ws.removed', { name: paint.name(ws.name) }));
  return 0;
}

/* ================================================================ scope */

export async function cmdScope(ctx: Ctx): Promise<number> {
  const cwd = cwdOf(ctx);
  // For the plugin's hooks: the brief, as text for Claude.
  if (flagBool(ctx.args, 'context')) return scopeContext(ctx, cwd);
  const scope = await resolveScope(cwd, { autoStart: flagBool(ctx.args, 'auto') });
  const target = ctx.args.positionals[0];
  if (target === undefined) return showScope(ctx, scope);
  if (['off', 'none', 'clear', 'aucun', 'tout'].includes(target.toLowerCase())) {
    if (scope.workspace) await chooseScope(scope, { repo: null, ticket: null });
    if (ctx.mode === 'json') ctx.out.json({ ok: true, cleared: Boolean(scope.workspace), via: scope.via });
    else if (scope.via === 'folder') ctx.out.info(t('scope.folderDecides', { repo: scope.repo!.name }));
    else ctx.out.ok(t('scope.cleared'));
    return 0;
  }
  return setScope(ctx, scope, target);
}

async function setScope(ctx: Ctx, scope: Scope, target: string): Promise<number> {
  const repos = await listRepos();
  let workspace = scope.workspace;
  let ticket: TicketRecord | null = null;
  let repo: RepoEntry | null = null;
  // A ticket reference first (ABC-123), then a repository.
  const asRef = /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,7}$/.test(target) ? ticketId(target) : null;
  const kbs = workspace ? [...new Set([workspace.kb, ...(await workspaceRepos(workspace)).map((r) => r.kb)])] : [...new Set(repos.map((r) => r.kb))];
  if (asRef) {
    for (const kb of kbs) {
      const config = await loadConfig({ profileId: kb }).then((r) => r.config, () => null);
      ticket = config ? await loadTicket(config, asRef) : null;
      if (ticket) { repo = repos.find((r) => r.id === ticket!.repos[0]?.id) ?? null; break; }
    }
    if (!ticket) throw new OkbError('E_NOT_FOUND', `no ticket ${asRef}`, { key: 'ticketUnknown', params: { ref: asRef } });
  } else {
    repo = await findRepo(target);
    if (!repo) throw new OkbError('E_NOT_FOUND', `repository "${target}" is not registered`, { key: 'repoUnknown', params: { id: target } });
  }
  if (!workspace && repo) workspace = (await workspaceForDir(repo.path)) ?? (await listWorkspaces()).find((w) => w.kb === repo!.kb) ?? null;
  if (!workspace) throw new OkbError('E_NOT_FOUND', 'no workspace holds this repository', { key: 'scopeNoWorkspace', hint: 'okb workspace add <folder>' });
  if (scope.via === 'folder' && scope.repo && repo && scope.repo.id !== repo.id) {
    if (ctx.mode !== 'json') ctx.out.info(t('scope.folderDecides', { repo: scope.repo.name }));
  }
  if (!ticket && scope.ticket && repo && scope.ticket.repos.some((r) => r.id === repo!.id)) ticket = scope.ticket;
  await chooseScope({ ...scope, workspace }, { repo, ticket });
  const fresh = scope.via === 'folder' ? { ...scope, ticket } : await scopeFor(workspace, repo, ticket, 'chosen');
  return showScope(ctx, fresh, true);
}

async function showScope(ctx: Ctx, scope: Scope, changed = false): Promise<number> {
  const brief = scope.config ? await buildBrief(scope, { sync: true }).catch(() => null) : null;
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, changed, via: scope.via, workspace: scope.workspace?.id ?? null, kb: scope.kb, repo: scope.repo?.id ?? null, ticket: scope.ticket?.ref ?? null, brief, headline: brief ? headline(brief) : null });
    return 0;
  }
  if (!scope.workspace && !scope.repo) {
    ctx.out.info(t('scope.none'));
    ctx.out.tip(t('ws.noneTip'));
    ctx.out.next(['okb workspace add <dossier>', 'okb workspace']);
    return 0;
  }
  if (changed) ctx.out.ok(t('scope.set'));
  printBrief(ctx, scope, brief);
  return 0;
}

function printBrief(ctx: Ctx, scope: Scope, brief: Brief | null): void {
  const { out } = ctx;
  const where = scope.workspace ? t('scope.where', { ws: scope.workspace.name, kb: brief?.kb.name ?? scope.kb ?? '' }) : t('scope.whereKb', { kb: brief?.kb.name ?? scope.kb ?? '' });
  if (!scope.repo) {
    out.line(`🎯 ${paint.bold(t('scope.wholeWs'))}  ${paint.dim(where)}`);
    if (brief) {
      out.line(paint.dim(`   ${tn('scope.repos', brief.repos.length)}`));
      for (const r of brief.repos.slice(0, 30)) out.line(`   📦 ${paint.bold(r.name)} ${paint.dim(r.notes ? tn('scope.notes', r.notes) : t('scope.notOnboarded'))}`);
      for (const tk of brief.activeTickets) out.line(`   🎫 ${paint.bold(tk.ref)} ${tk.title} ${paint.dim(`(${tk.repos.join(', ')})`)}`);
    }
    out.tip(t('scope.chooseTip'));
    out.next(['okb scope <repo>', 'okb ticket start <ABC-123> --repo <repo>']);
    return;
  }
  out.line(`🎯 📦 ${paint.name(scope.repo.name)}  ${paint.dim(where)}`);
  out.line(paint.dim(`   ${scope.via === 'folder' ? t('scope.viaFolder') : t('scope.viaChosen')} · ${tilde(scope.repo.path)}`));
  const tk = brief?.ticket;
  if (tk) {
    const progress = tk.repos.map((p) => `${p.branch ?? t('scope.noBranch')} · ${tn('scope.commits', p.commits)}${p.merged ? ` · ${t('scope.merged')}` : p.gone ? ` · ${t('scope.gone')}` : ''}`).join(' | ');
    out.line(`   🎫 ${paint.bold(tk.ref)} ${tk.title}  ${paint.dim(progress)}`);
    for (const j of tk.journal.slice(-3)) out.line(paint.dim(`      ${t(`ticket.kind.${j.kind}`)} : ${j.text.slice(0, 120)}`));
  }
  if (brief) {
    out.line(paint.dim(`   ${t('scope.counts', { notes: brief.notes.length, shared: brief.shared.length, tickets: brief.recentTickets.length })}`));
    if (brief.talksTo.length || brief.calledBy.length) {
      out.line(paint.dim(`   ${[...brief.talksTo.map((e) => `→ ${e.repo}`), ...brief.calledBy.map((e) => `← ${e.repo}`)].join('  ')}`));
    }
  }
  out.next([tk ? 'okb ticket note "…" --kind decision' : `okb ticket start <ABC-123>`, 'okb ask "…"', ...(scope.via === 'chosen' ? ['okb scope off'] : [])]);
}

/** `okb scope --context --cwd <dir>`: the brief for Claude (the session hook). Silent when there is no scope. */
async function scopeContext(ctx: Ctx, cwd: string): Promise<number> {
  let reason = 'no-context';
  const scope = await resolveScope(cwd, { autoStart: true }).catch(() => { reason = 'profile-resolution-error'; return null; });
  let text = '';
  if (scope?.config) {
    const brief = await buildBrief(scope, { sync: true }).catch(() => { reason = 'brief-error'; return null; });
    const { presenceOf } = await import('../../settings/presence.js');
    if (brief) text = renderBrief(brief, { presence: await presenceOf() });
    // In a workspace, outside its repositories: a folder of notes or a new repository says what it is.
    if (!scope.repo) {
      const { repoContextText } = await import('./repo.js');
      const here = await repoContextText(cwd).catch(() => '');
      if (here) text = [text, here].filter(Boolean).join('\n');
    }
  } else {
    // An undocumented Git repository: the onboarding offer, as before.
    const { repoContextText } = await import('./repo.js');
    text = await repoContextText(cwd);
  }
  // In a team's meta-repository (chantier 3): one line on where this folder sits, its dependencies and skills.
  const { metaForDir, metaHeadline, readMetaRepo } = await import('../../work/meta-repos.js');
  const meta = await metaForDir(cwd).catch(() => null);
  if (meta) text = [text, metaHeadline(await readMetaRepo(meta.meta, { light: true }), meta.repo)].filter(Boolean).join('\n');
  if (ctx.mode === 'json') ctx.out.json({ ok: true, context: text, reason: text ? 'context-sent' : reason === 'no-context' && !scope?.config ? 'outside-scope' : reason });
  else if (text) ctx.out.line(text);
  return 0;
}

/* =============================================================== ticket */

export async function cmdTicket(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0];
  switch (sub) {
    case undefined: case 'status': case 'st': return ticketShow(ctx);
    case 'start': case 'new': case 'begin': case 'resume': return ticketStart(ctx);
    case 'note': case 'log': return ticketNote(ctx);
    case 'done': case 'finish': case 'end': return ticketDone(ctx);
    case 'list': case 'ls': return ticketList(ctx);
    case 'commit': return ticketCommit(ctx);
    case 'brief': case 'state': case 'criterion': case 'attempt': case 'reuse': case 'close': case 'github': case 'jira': return ticketOperational(ctx, sub);
    case 'sheet': case 'set': case 'na': case 'rename': case 'pin': case 'unpin': case 'unfollow': case 'restore': case 'links': case 'requests': case 'source': return ticketSheetCmd(ctx, sub);
    default: {
      if (/^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,7}$/.test(sub)) return ticketShow({ ...ctx, args: { ...ctx.args, positionals: ['status', sub] } });
      throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb ticket [start|note|done|list]' } });
    }
  }
}

/** The ticket a command is about: named (`ABC-123` or `--ticket`), else the scope's. */
async function pickTicket(ctx: Ctx, named?: string): Promise<{ scope: Scope; config: OkbConfig; record: TicketRecord }> {
  const explicit = flagString(ctx.args, 'kb') ?? flagString(ctx.args, 'profile');
  const scope = await resolveScope(cwdOf(ctx), { autoStart: !explicit });
  const ref = flagString(ctx.args, 'ticket') ?? named;
  if (explicit) {
    const { config } = await loadConfig({ profileId: explicit });
    const record = ref ? await loadTicket(config, ref) : scope.ticket && scope.kb === explicit ? await loadTicket(config, scope.ticket.ref) : null;
    if (!record) throw new OkbError('E_NOT_FOUND', 'no matching ticket in the named profile', { key: 'ticketUnknown', params: { ref: ref ?? '' } });
    return { scope, config, record };
  }
  if (ref) {
    const configs: OkbConfig[] = [];
    if (scope.config) configs.push(scope.config);
    for (const kb of new Set((await listRepos()).map((r) => r.kb))) {
      if (kb !== scope.kb) { const c = await loadConfig({ profileId: kb }).then((r) => r.config, () => null); if (c) configs.push(c); }
    }
    const matches = [];
    for (const config of configs) {
      const record = await loadTicket(config, ref);
      if (record) matches.push({ scope, config, record });
    }
    const scoped = matches.filter((m) => scope.repo && m.config.profile.id === scope.repo.kb && m.record.repos.some((r) => r.id === scope.repo!.id));
    if (scoped.length === 1) return scoped[0]!;
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new OkbError('E_CONFLICT', 'this reference exists in several profiles', { detail: { ref: ticketId(ref), profiles: matches.map((m) => m.config.profile.id) }, hint: 'Name the intended profile with --kb <profile>.' });
    throw new OkbError('E_NOT_FOUND', `no ticket ${ticketId(ref)}`, { key: 'ticketUnknown', params: { ref: ticketId(ref) } });
  }
  if (!scope.ticket || !scope.config) throw new OkbError('E_NOT_FOUND', 'no ticket in progress here', { key: 'ticketNone', hint: 'okb ticket start <ABC-123>' });
  return { scope, config: scope.config, record: scope.ticket };
}

async function ticketShow(ctx: Ctx): Promise<number> {
  const { config, record } = await pickTicket(ctx, ctx.args.positionals[1]);
  const { record: synced, progress } = await syncTicket(config, record, await listRepos());
  const bundle = await loadBundleFor(config);
  const { ticketNoteIn } = await import('../../work/tickets.js');
  const all = await listRepos();
  const places = new Map(await Promise.all(synced.repos.map(async (r) => [r.id, await repoPlace(config, all.find((x) => x.id === r.id) ?? { id: r.id, name: r.id })] as const)));
  const note = ticketNoteIn(bundle, synced, (id) => places.get(id) ?? false);
  const detail = await invoke('tickets.get', { ref: synced.ref }, { config, env: process.env, actor: actorOf() });
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...detail, progress, note }); return 0; }
  printTicket(ctx, synced, progress, note);
  printTicketDetail(ctx, detail);
  return 0;
}

function printTicketDetail(ctx: Ctx, r: Awaited<ReturnType<typeof ticketDetail>>): void {
  ctx.out.line();
  for (const [field, value] of [['goal', r.brief.goal], ['lastAction', r.brief.lastAction], ['next', r.brief.next]]) if (value) ctx.out.line(`${t(`ticket.resume.${field}`)} : ${value}`);
  for (const a of r.brief.failed) ctx.out.line(`${t('ticket.resume.failed')} : ${a.approach} · ${a.conditions} → ${a.result}`);
  for (const s of r.detail.states) ctx.out.line(`  ${t(`ticket.dimension.${s.dimension}`)}${s.environment ? ` (${s.environment})` : ''} : ${t(`ticket.observation.${s.status}`)}${s.at ? ` · ${s.at.slice(0, 10)}` : ''}`);
  if (r.detail.close.missing.length) ctx.out.warn(t('ticket.criteriaMissing', { text: r.detail.close.missing.join(' · ') }));
  for (const c of r.detail.criteria) ctx.out.line(`  ${c.id} · ${t(`ticket.criterion.${c.kind}`)} : ${c.text === c.kind ? t(`ticket.criterion.${c.kind}`) : c.text} · ${t(`ticket.criterionStatus.${c.status}`)}${c.required ? ` · ${t('ticket.required')}` : ''}`);
}

/** The new local follow-up uses the same operations as the app and MCP. */
async function ticketOperational(ctx: Ctx, sub: string): Promise<number> {
  if (sub === 'github' && ctx.args.positionals[1] === 'setup') {
    const { config } = await effective(ctx.args);
    const result = await invoke('tickets.github.configure', { enabled: !flagBool(ctx.args, 'off'), host: flagString(ctx.args, 'host') ?? 'github.com', repositories: flagList(ctx.args, 'repository'), allowed: flagBool(ctx.args, 'allowed') }, { config, env: process.env, actor: actorOf() });
    if (ctx.mode === 'json') ctx.out.json({ ok: true, ...result }); else ctx.out.ok(t('ticket.githubConfigured'));
    return 0;
  }
  const { config, record } = await pickTicket(ctx, ['brief', 'resume', 'close'].includes(sub) ? ctx.args.positionals[1] : undefined);
  const c = { config, env: process.env, actor: actorOf() };
  const ref = record.ref;
  const strings = (names: readonly string[]) => Object.fromEntries(names.filter((k) => flagString(ctx.args, k) !== undefined).map((k) => [k, flagString(ctx.args, k)]));
  let result: Awaited<ReturnType<typeof ticketDetail>>;
  switch (sub) {
    case 'brief': case 'resume': {
      const patch = { ...strings(['goal', 'next']), ...(flagString(ctx.args, 'last-action') ? { lastAction: flagString(ctx.args, 'last-action') } : {}) };
      result = Object.keys(patch).length ? await invoke('tickets.brief', { ref, ...patch }, c) : await invoke('tickets.get', { ref }, c); break;
    }
    case 'state': result = await invoke('tickets.state', { ref, state: { dimension: ctx.args.positionals[1], status: ctx.args.positionals[2], ...strings(['environment', 'detail', 'url']) } }, c); break;
    case 'criterion': {
      const action = ctx.args.positionals[1];
      if (!['add', 'set'].includes(action ?? '')) throw new OkbError('E_INVALID', 'okb ticket criterion add <text> --kind tests | set <id> --status met');
      result = await invoke('tickets.criterion', { ref, ...(action === 'set' ? { id: ctx.args.positionals[2], ...strings(['text', 'status']) } : { text: ctx.args.positionals.slice(2).join(' '), kind: flagString(ctx.args, 'kind') ?? 'other' }), ...(ctx.args.flags.required === undefined ? {} : { required: flagBool(ctx.args, 'required') }) }, c); break;
    }
    case 'attempt': result = await invoke('tickets.attempt', { ref, approach: ctx.args.positionals.slice(1).join(' '), ...strings(['conditions', 'result', 'next']) }, c); break;
    case 'reuse': result = await invoke('tickets.reuse', { ref, path: ctx.args.positionals.slice(1).join(' '), ...strings(['why']) }, c); break;
    case 'close': result = await invoke('tickets.close', { ref }, c); break;
    case 'github': result = await invoke('tickets.github', { ref, repository: flagString(ctx.args, 'repository'), number: Number(ctx.args.positionals[1]) }, c); break;
    case 'jira': result = await invoke('tickets.jira', { ref, issue: flagString(ctx.args, 'issue') ?? ref, status: flagString(ctx.args, 'status'), url: flagString(ctx.args, 'url'), observedAt: flagString(ctx.args, 'observed-at') }, c); break;
    default: throw new OkbError('E_INVALID', 'unknown ticket action');
  }
  if (ctx.mode === 'json') ctx.out.json({ ok: true, ...result }); else printTicketDetail(ctx, result);
  return 0;
}

/** The ticket sheet from the terminal (F2.4-08..14): the same operations as the app and MCP. */
async function ticketSheetCmd(ctx: Ctx, sub: string): Promise<number> {
  const a = ctx.args;
  const show = (result: unknown) => { if (ctx.mode === 'json') ctx.out.json({ ok: true, ...(result as object) }); else printSheet(ctx, result as Record<string, unknown>); return 0; };
  if (sub === 'requests' || sub === 'links' && a.positionals[1] === 'scan') {
    const action = a.positionals[1] ?? 'list';
    const needsTicket = action === 'add' || (action === 'list' && a.positionals[2]);
    const { config } = needsTicket ? await pickTicket(ctx, a.positionals[2]) : await effective(a);
    const c = { config, env: process.env, actor: actorOf() };
    if (sub === 'links') return show(await invoke('tickets.links.scan', {}, c));
    switch (action) {
      case 'list': return show(await invoke('tickets.requests.list', a.positionals[2] ? { ref: a.positionals[2] } : {}, c));
      case 'add': return show(await invoke('tickets.requests.create', { ref: ticketId(a.positionals[2] ?? ''), fields: flagList(a, 'fields') }, c));
      case 'close': return show(await invoke('tickets.requests.close', { id: a.positionals[2] ?? '', found: flagList(a, 'found'), missing: flagList(a, 'missing'), read: flagList(a, 'read'), unavailable: flagList(a, 'unavailable'), note: flagString(a, 'note') ?? '' }, c));
      case 'cancel': return show(await invoke('tickets.requests.cancel', { id: a.positionals[2] ?? '' }, c));
      case 'prompt': { const r = await invoke('tickets.requests.prompt', { id: a.positionals[2] ?? '', lang: flagString(a, 'lang') === 'en' ? 'en' : 'fr' }, c); if (ctx.mode === 'json') ctx.out.json({ ok: true, ...r }); else ctx.out.line(r.prompt); return 0; }
      default: throw new OkbError('E_INVALID', 'okb ticket requests [list|add <ref> --fields a,b|close <id> --found … --missing … --read … --unavailable …|cancel <id>|prompt <id>]');
    }
  }
  if (sub === 'restore') {
    const { config } = await effective(a);
    return show(await invoke('tickets.restore', { ref: a.positionals[1] ?? '' }, { config, env: process.env, actor: actorOf() }));
  }
  const { config, record } = await pickTicket(ctx, a.positionals[1]);
  const c = { config, env: process.env, actor: actorOf() };
  const ref = record.ref;
  switch (sub) {
    case 'sheet': return show(await invoke('tickets.sheet', { ref }, c));
    case 'set': return show((await invoke('tickets.field.set', { ref, field: flagString(a, 'field') as never, value: flagString(a, 'value') ?? '', ...(flagString(a, 'origin') ? { origin: flagString(a, 'origin') as never } : {}), ...(flagString(a, 'url') ? { url: flagString(a, 'url') } : {}) }, c)).sheet);
    case 'na': return show(await invoke('tickets.field.na', { ref, field: flagString(a, 'field') as never, reason: flagString(a, 'reason') ?? '' }, c));
    case 'rename': return show(await invoke('tickets.rename', { ref, title: a.positionals.slice(2).join(' ') }, c));
    case 'pin': case 'unpin': return show(await invoke('tickets.pin', { ref, pinned: sub === 'pin' }, c));
    case 'unfollow': return show(await invoke('tickets.unfollow', { ref }, c));
    case 'links': {
      const action = a.positionals[2];
      if (action === 'add' || action === 'dismiss') return show(await invoke('tickets.links.set', { ref, path: a.positionals.slice(3).join(' '), state: action === 'add' ? 'confirmed' : 'dismissed' }, c));
      return show(await invoke('tickets.links.list', { ref }, c));
    }
    case 'source': return show(await invoke('tickets.source', { ref, provider: (flagString(a, 'provider') ?? 'jira') as never, url: a.positionals[2] ?? flagString(a, 'url') ?? '' }, c));
    default: throw new OkbError('E_INVALID', 'unknown ticket action');
  }
}

function printSheet(ctx: Ctx, r: Record<string, unknown>): void {
  const sheet = r as { ref?: string; title?: { value: string } | null; fields?: Record<string, { value: string; origin: string }>; next?: { text: string } | null; completeness?: { percent: number; missing: string[] }; links?: { path: string; state: string }[]; requests?: { id: string; ref: string; fields: string[] }[] };
  if (sheet.requests && !sheet.fields) { for (const q of sheet.requests) ctx.out.line(`${q.id} · ${q.ref} · ${q.fields.join(', ')}`); return; }
  if (sheet.links && !sheet.fields) { for (const l of sheet.links) ctx.out.line(`${l.state} · ${l.path}`); return; }
  if (!sheet.fields) { ctx.out.ok(JSON.stringify(r)); return; }
  ctx.out.line(`🎫 ${paint.bold(sheet.ref ?? '')} ${sheet.title?.value ?? paint.dim(t('ticket.sheet.noTitle'))}`);
  for (const [field, v] of Object.entries(sheet.fields)) if (field !== 'title') ctx.out.line(`   ${field} : ${v.value} ${paint.dim(`(${v.origin})`)}`);
  ctx.out.line(`   ${t('ticket.resume.next')} : ${sheet.next?.text ?? paint.dim('—')}`);
  if (sheet.completeness) ctx.out.line(`   ${t('ticket.sheet.completeness', { n: String(sheet.completeness.percent) })}${sheet.completeness.missing.length ? paint.dim(` · ${sheet.completeness.missing.join(', ')}`) : ''}`);
}

function printTicket(ctx: Ctx, record: TicketRecord, progress: readonly { id: string; branch: string | null; commits: number; merged: boolean; gone: boolean }[], note: string | null): void {
  const { out } = ctx;
  out.line(`🎫 ${paint.bold(record.ref)} ${record.title}  ${paint.dim(t(`ticket.status.${record.status}`))}`);
  for (const p of progress) out.line(`   📦 ${paint.bold(p.id)} ${paint.dim(`${p.branch ?? t('scope.noBranch')} · ${tn('scope.commits', p.commits)}${p.merged ? ` · ${t('scope.merged')}` : p.gone ? ` · ${t('scope.gone')}` : ''}`)}`);
  const learned = record.journal.filter((j) => (NOTE_KINDS as readonly string[]).includes(j.kind));
  if (learned.length) {
    out.line();
    out.line(paint.bold(t('ticket.journal', { n: learned.length })));
    for (const j of learned.slice(-8)) out.line(`   ${paint.dim(j.at.slice(0, 10))} ${t(`ticket.kind.${j.kind}`)} : ${j.text}`);
  }
  if (note) out.line(`\n   ${sym.ok()} ${t('ticket.noteWritten', { path: note })}`);
  out.next(record.status === 'done' || progress.some((p) => p.merged)
    ? [note ? 'okb ticket list' : '/okb-dev:ticket']
    : ['okb ticket note "…" --kind decision|trap|question', 'okb ticket done']);
}

async function ticketStart(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const scope = await resolveScope(cwdOf(ctx));
  const given = args.positionals.slice(1).join(' ').trim() || flagString(args, 'ticket') || scope.ticket?.ref || '';
  const repoArg = flagString(args, 'repo');
  let repo = repoArg ? await findRepo(repoArg) : scope.repo;
  if (repoArg && !repo) throw new OkbError('E_NOT_FOUND', `repository "${repoArg}" is not registered`, { key: 'repoUnknown', params: { id: repoArg } });
  const textFile = flagString(args, 'ticket-file') ?? flagString(args, 'text-file');
  const text = textFile ? await readFile(resolve(textFile), 'utf8') : flagValues(args, 'text').join('\n');
  // The reference: given, else found in the text or the title.
  const branch = repo ? await currentBranch(repo.path) : null;
  const refs = ticketRefs(`${given}\n${text}`, scope.workspace?.tickets ?? null, 'message');
  const branchRefs = branch ? ticketRefs(branch, scope.workspace?.tickets ?? null, 'branch') : [];
  if (refs.length > 1 && !/^[A-Za-z][A-Za-z0-9]{0,15}[-_]\d{1,7}$/.test(given)) throw new OkbError('E_CONFLICT', 'several ticket references are available', { detail: { refs }, hint: 'Name the one ticket to resume.' });
  if (!refs.length && !given && branchRefs.length > 1) throw new OkbError('E_CONFLICT', 'several ticket references are on the branch', { detail: { refs: branchRefs }, hint: 'Name the one ticket to resume.' });
  const isRef = /^[A-Za-z][A-Za-z0-9]{0,15}[-_]\d{1,7}$/.test(given);
  const ref = isRef ? given : refs[0] ?? branchRefs[0];
  const title = flagString(args, 'title') ?? (isRef ? undefined : given || undefined);
  if (!ref && !title) throw new OkbError('E_INVALID', 'usage: okb ticket start <ABC-123> [--repo <repo>] [--title "…"] [--ticket-file f]', { key: 'usage', params: { usage: 'okb ticket start <ABC-123> [--repo <repo>] [--title "…"] [--ticket-file f]' } });
  if (!repo && ref) {
    const explicitKb = flagString(args, 'kb') ?? flagString(args, 'profile');
    const profile = explicitKb ?? scope.kb;
    if (profile) {
      const { config } = await loadConfig({ profileId: profile });
      const known = await loadTicket(config, ref);
      const registered = await listRepos();
      const candidates = known ? registered.filter((r) => r.kb === profile && known.repos.some((tr) => tr.id === r.id)) : [];
      if (candidates.length === 1) repo = candidates[0]!;
    }
  }
  if (!repo && scope.workspace) {
    // At the top of a workspace: the repository named in the ticket's text.
    const { reposNamed } = await import('../../work/scope.js');
    const named = reposNamed(`${given}\n${title ?? ''}\n${text}`, await workspaceRepos(scope.workspace));
    if (named.length === 1) repo = named[0]!;
  }
  if (!repo) throw new OkbError('E_INVALID', 'which repository is this ticket about?', { key: 'ticketWhichRepo', hint: 'okb ticket start <ABC-123> --repo <repo>' });
  const explicitKb = flagString(args, 'kb') ?? flagString(args, 'profile');
  if (explicitKb && explicitKb !== repo.kb) throw new OkbError('E_CONFLICT', 'repository belongs to another profile', { detail: { repo: repo.id, kb: repo.kb, requested: explicitKb } });
  const { config } = await loadConfig({ profileId: repo.kb });
  const reconciled = await invoke('tickets.resume', { ref: ref ?? ticketId(title!), repo: repo.id, ...(title ? { title } : {}), ...(text.trim() ? { text } : {}), ...Object.fromEntries(['goal', 'next', 'note', 'base', 'suggestion'].filter((k) => flagString(args, k) !== undefined).map((k) => [k, flagString(args, k)])), ...(flagString(args, 'last-action') ? { lastAction: flagString(args, 'last-action') } : {}) }, { config, env: process.env, actor: actorOf() });
  const { ticket: record, created, attached } = reconciled;
  // The team's prefix, learned from the first ticket that uses it.
  const ws = scope.workspace ?? (await workspaceForDir(repo.path));
  const prefix = /^[A-Z][A-Z0-9]*-\d+$/.test(record.ref) ? record.ref.split('-')[0]! : null;
  if (ws && prefix && !ws.tickets.pattern && !ws.tickets.prefixes.includes(prefix)) await updateWorkspace(ws.id, { addPrefixes: [prefix] }).catch(() => {});
  if (ws) await chooseScope({ ...scope, workspace: ws }, { repo, ticket: record });
  const fresh = scope.via === 'folder' ? { ...scope, ticket: record } : await scopeFor(ws, repo, record, 'chosen');
  const brief = await buildBrief(fresh).catch(() => null);
  if (ctx.mode === 'json') {
    out.json({ ok: true, ...reconciled, created, attached, ticket: record, repo: repo.id, kb: repo.kb, brief, ask: `okb ask ${JSON.stringify([record.title, text.slice(0, 300)].filter(Boolean).join(' '))} --repo ${repo.id} --json` });
    return 0;
  }
  out.ok(t(created ? 'ticket.started' : attached ? 'ticket.attached' : 'ticket.resumed', { ref: paint.bold(record.ref), repo: paint.name(repo.name) }));
  out.line(paint.dim(`   ${t('ticket.followHow')}`));
  for (const conflict of reconciled.conflicts) out.warn(t('ticket.reconcile.conflict', { field: conflict.field, source: conflict.source }));
  if (reconciled.proposal && !reconciled.proposal.reused) out.line(t('ticket.reconcile.proposal', { id: reconciled.proposal.id }));
  if (reconciled.proposalDeferred) out.tip(t('ticket.reconcile.deferred', { path: reconciled.proposalDeferred.path }));
  out.next(['okb ticket note "…" --kind decision', 'okb ticket', '/okb-dev:ticket']);
  return 0;
}

async function ticketNote(ctx: Ctx): Promise<number> {
  const text = ctx.args.positionals.slice(1).join(' ').trim() || flagValues(ctx.args, 'text').join('\n');
  const kind = (flagString(ctx.args, 'kind') ?? 'note') as (typeof NOTE_KINDS)[number];
  if (!(NOTE_KINDS as readonly string[]).includes(kind)) throw new OkbError('E_INVALID', `kind must be one of ${NOTE_KINDS.join(', ')}`, { key: 'ticketKind', params: { kinds: NOTE_KINDS.join(', ') } });
  const { config, record, scope } = await pickTicket(ctx);
  const updated = await addJournal(config, record.ref, { kind, text, ...(scope.repo ? { repo: scope.repo.id } : {}) });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, ticket: updated.ref, entries: updated.journal.length });
  else ctx.out.ok(t('ticket.noted', { kind: t(`ticket.kind.${kind}`), ref: paint.bold(updated.ref) }));
  return 0;
}

/**
 * `okb ticket done`: the facts of a finished ticket for /okb-dev:ticket — per
 * repository, a dated context (ticket text, commits, journal, changed files)
 * and the notes that cite changed files; for the shared part of the KB, the
 * notes tied to these repositories, business terms without a card, other
 * repositories the work mentions, and whether interfaces changed.
 */
async function ticketDone(ctx: Ctx): Promise<number> {
  const { config, record } = await pickTicket(ctx, ctx.args.positionals[1]);
  const repos = await listRepos();
  const { record: synced } = await syncTicket(config, record, repos);
  const text = (await ticketText(synced)) ?? '';
  const perRepo: unknown[] = [];
  const problems: string[] = [];
  let interfacesChanged = false;
  const bundle = await loadBundleFor(config);
  // A repository with its own KB: the shared part is in its workspace's KB.
  const home = repos.find((r) => r.id === synced.repos[0]?.id);
  const ws = home ? await workspaceOfRepo(home) : null;
  const sharedConfig = ws && home && ws.kb !== home.kb ? await loadConfig({ profileId: ws.kb }).then((r) => r.config, () => null) : null;
  const sharedBundle = sharedConfig ? await loadBundleFor(sharedConfig) : bundle;
  // "ORD-42 — allow 100 lines": the reference and what it is about (else the first commit's subject).
  const firstCommit = synced.journal.find((j) => j.kind === 'commit')?.text;
  const about = synced.title !== synced.ref ? synced.title : (firstCommit ? titleFrom(firstCommit, synced.ref) : null);
  const noteTitle = synced.ref.startsWith('T-') ? synced.title : `${synced.ref}${about ? ` — ${about}` : ''}`;
  for (const tr of synced.repos) {
    const repo = repos.find((r) => r.id === tr.id);
    if (!repo || !tr.base) continue;
    let tip: string | null = 'HEAD';
    if (tr.branch) tip = (await currentBranch(repo.path)) === tr.branch ? 'HEAD' : await revParse(repo.path, tr.branch);
    try {
      const rctx = await repoContext(config, repo);
      const result = await ticketContext(rctx, {
        title: noteTitle,
        ...(text ? { ticket: text } : {}),
        follow: { from: { ref: tr.baseRef ?? 'start', sha: tr.base }, to: tip, journal: synced.journal },
      });
      if (result.changes.some((c) => c.kind === 'api' || c.kind === 'schema')) interfacesChanged = true;
      perRepo.push({ repo: repo.id, name: repo.name, ...result, shared: [...tiedNotes(sharedBundle, repo).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => ({ path: p, title: sharedBundle.byPath.get(p)?.title ?? p })) });
    } catch (e) {
      problems.push(`${repo.name}: ${(e as Error).message}`);
    }
  }
  if (!perRepo.length) throw new OkbError('E_NOT_FOUND', 'nothing to write for this ticket yet', { key: 'ticketNothing', params: { ref: synced.ref }, ...(problems.length ? { hint: problems.join(' · ') } : {}) });
  const learnedText = [synced.title, text, ...synced.journal.filter((j) => j.kind !== 'commit').map((j) => j.text)].join('\n');
  const missingTerms = (await missingConceptsFor(sharedConfig ?? config, learnedText.slice(0, 20_000), sharedBundle).catch(() => [] as string[])).slice(0, 10);
  const others = ws ? (await workspaceRepos(ws)).filter((r) => !synced.repos.some((x) => x.id === r.id)) : [];
  const { reposNamed } = await import('../../work/scope.js');
  const otherRepos = reposNamed(learnedText, others).map((r) => r.id);
  const finished = flagBool(ctx.args, 'keep-open') ? synced : await finishTicket(config, synced.ref);
  const result = { ok: true, ticket: finished, repos: perRepo, missingTerms, otherRepos, interfacesChanged, problems, sharedKb: sharedConfig ? { id: sharedConfig.profile.id, root: sharedConfig.kb.root } : null };
  if (ctx.mode === 'json') { ctx.out.json(result); return 0; }
  ctx.out.ok(t('ticket.doneFacts', { ref: paint.bold(finished.ref), n: perRepo.length }));
  for (const r of perRepo as { name: string; file: string; commits: unknown[]; changes: unknown[] }[]) ctx.out.line(`   📦 ${paint.bold(r.name)} ${paint.dim(`${tn('scope.commits', r.commits.length)} · ${tn('ticket.files', r.changes.length)} · ${tilde(r.file)}`)}`);
  if (missingTerms.length) ctx.out.line(paint.dim(`   ${t('ticket.missingTerms', { terms: missingTerms.join(', ') })}`));
  if (interfacesChanged) ctx.out.line(paint.dim(`   ${t('ticket.interfaces')}`));
  ctx.out.next(['/okb-dev:ticket']);
  return 0;
}

async function ticketList(ctx: Ctx): Promise<number> {
  const scope = await resolveScope(cwdOf(ctx));
  const kbs = scope.kb ? [scope.kb] : [...new Set((await listRepos()).map((r) => r.kb))];
  const repoFilter = flagString(ctx.args, 'repo');
  const all: (TicketRecord & { kb: string })[] = [];
  for (const kb of kbs) {
    const config = await loadConfig({ profileId: kb }).then((r) => r.config, () => null);
    if (config) for (const tk of await listTickets(config)) all.push({ ...tk, kb });
  }
  const shown = all.filter((tk) => (flagBool(ctx.args, 'all') || tk.status === 'active' || Date.now() - Date.parse(tk.updatedAt) < 30 * 86_400_000) && (!repoFilter || tk.repos.some((r) => r.id === repoFilter)));
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, tickets: shown }); return 0; }
  if (!shown.length) { ctx.out.info(t('ticket.noneYet')); ctx.out.next(['okb ticket start <ABC-123> --repo <repo>']); return 0; }
  ctx.out.line(paint.bold(t('ticket.listTitle')));
  for (const tk of shown) {
    const commits = tk.journal.filter((j) => j.kind === 'commit').length;
    ctx.out.line(`  ${tk.status === 'active' ? '🎫' : paint.dim('✓')} ${paint.bold(tk.ref)} ${tk.title !== tk.ref ? tk.title : ''} ${paint.dim(`· ${tk.repos.map((r) => r.id).join(', ')} · ${tn('scope.commits', commits)} · ${t(`ticket.status.${tk.status}`)}`)}`);
  }
  ctx.out.next(['okb ticket <ABC-123>', 'okb scope <ABC-123>']);
  return 0;
}

/**
 * `okb ticket commit --cwd <dir>` (the plugin's hook after a `git commit`):
 * the new commits join the ticket's journal; one line for Claude when there
 * is something to say, nothing otherwise.
 */
async function ticketCommit(ctx: Ctx): Promise<number> {
  const scope = await resolveScope(cwdOf(ctx), { autoStart: true }).catch(() => null);
  let text = '';
  if (scope?.config && scope.ticket && scope.repo) {
    const { record, added } = await syncTicket(scope.config, scope.ticket, await listRepos());
    const mine = added.filter((a) => a.repo === scope.repo!.id);
    if (mine.length) {
      const total = record.journal.filter((j) => j.kind === 'commit').length;
      const last = mine.at(-1)!;
      text = `OKB: commit ${last.sha?.slice(0, 7)} "${last.text.slice(0, 80)}" joined ticket ${record.ref} (${total} commit(s) followed). If it settled a decision or revealed a trap, record it in one line: okb ticket note "<what and why>" --kind decision|trap.`;
    }
  }
  if (ctx.mode === 'json') ctx.out.json({ ok: true, context: text });
  else if (text) ctx.out.line(text);
  return 0;
}

export type { Workspace };
