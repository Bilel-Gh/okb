import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { landscapeEdges, type Edge } from '../repo/generated.js';
import { correctedModel } from '../arch/system.js';
import { overridesStamp } from '../arch/overrides.js';
import { repoNotes } from '../repo/notes.js';
import { READING_ORDER, type RepoPlace } from '../repo/pack.js';
import { repoPlace } from '../brain/products.js';
import { drawerFolder, layoutOf } from '../brain/layout.js';
import { listRepos, type RepoEntry } from '../repo/registry.js';
import { loadMap, repoPaths } from '../repo/state.js';
import type { RepoMap } from '../repo/types.js';
import { statePaths } from '../state/paths.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import type { BundlePath } from '../util/paths.js';
import { loadConfig } from '../config/load.js';
import { workspaceRepos, type Scope } from './scope.js';
import type { Workspace } from './workspaces.js';
import { listTickets, syncTicket, ticketNoteIn, type JournalEntry, type RepoProgress, type TicketRecord } from './tickets.js';
import { noteRepo, tiedNotes } from './rank.js';
import { ticketDetail, type TicketState, type Attempt } from './ticket-state.js';
import { openRequests } from './ticket-requests.js';
import { openTeamRequests, teamOf } from './team.js';

/**
 * The brief: what Claude needs to work in a scope, small enough to read at
 * every session start — the repository's approved notes in reading order,
 * the shared notes tied to it, the repositories it talks to, the ticket in
 * progress with its journal. Paths, titles and short facts only: Claude reads
 * a note when the question needs it, instead of re-exploring the code.
 */
export type NoteRef = { readonly path: string; readonly title: string };

export type TicketBrief = {
  readonly ref: string;
  readonly title: string;
  readonly status: TicketRecord['status'];
  readonly auto: boolean;
  readonly repos: readonly RepoProgress[];
  readonly journal: readonly JournalEntry[];
  readonly textFile: string | null;
  readonly note: string | null;
  readonly resume?: { readonly goal: string; readonly lastAction: string; readonly next: string; readonly failed: readonly Attempt[] };
  readonly states?: readonly TicketState[];
  readonly missingCriteria?: readonly string[];
};

export type Brief = {
  readonly workspace: { readonly id: string; readonly name: string; readonly roots: readonly string[] } | null;
  readonly kb: { readonly id: string; readonly name: string; readonly root: string };
  /** For a repository with its own KB in a workspace: the workspace's KB, where the shared notes are. */
  readonly sharedKb: { readonly id: string; readonly name: string; readonly root: string } | null;
  readonly via: Scope['via'];
  readonly repo: { readonly id: string; readonly name: string; readonly path: string } | null;
  readonly notes: readonly (NoteRef & { readonly kind: string })[];
  readonly recentTickets: readonly NoteRef[];
  readonly shared: readonly NoteRef[];
  readonly talksTo: readonly { readonly repo: string; readonly label: string }[];
  readonly calledBy: readonly { readonly repo: string; readonly label: string }[];
  readonly ticket: TicketBrief | null;
  /** At the top of a workspace with no repository chosen: its repositories and tickets in progress. */
  readonly repos: readonly { readonly id: string; readonly name: string; readonly notes: number; readonly ownKb?: string }[];
  readonly activeTickets: readonly { readonly ref: string; readonly title: string; readonly repos: readonly string[] }[];
  readonly landscape: string | null;
  /** What the person asked the agent to find (F2.4-10): open requests of this repository, or of the KB. */
  readonly requests: readonly { readonly id: string; readonly ref: string; readonly fields: readonly string[]; readonly since: string }[];
  /** The team responsible for this repository (F2.4-19): its own, else its product's (`inherited` names the product). */
  readonly team?: { readonly value: string; readonly origin: string; readonly inherited: string | null } | null;
  /** Open requests to find a team (F2.4-20). */
  readonly teamRequests?: readonly { readonly id: string; readonly kind: string; readonly subject: string; readonly since: string }[];
};

/* --------------------------------------------------------- neighbours */

type EdgeCache = { key: string; edges: Edge[] };

/** How the KB's repositories connect, from their maps; cached until a map changes. */
export async function kbEdges(config: OkbConfig, repos?: readonly RepoEntry[]): Promise<Edge[]> {
  const list = (repos ?? (await listRepos())).filter((r) => r.kb === config.profile.id);
  const stamps = await Promise.all(list.map(async (r) => `${r.id}:${await stat(repoPaths(config, r.id).map).then((s) => s.mtimeMs, () => 0)}`));
  // The person's corrections change the edges too (F2.4-17).
  const key = `${stamps.join('|')}#${overridesStamp(config)}`;
  const cacheFile = resolve(statePaths(config).root, 'repos', 'edges.json');
  const cached = await readJsonIfExists<EdgeCache>(cacheFile).catch(() => null);
  if (cached && cached.key === key) return cached.edges;
  const maps: RepoMap[] = [];
  for (const r of list) {
    const map = await loadMap(repoPaths(config, r.id)).catch(() => null);
    if (map) maps.push(map);
  }
  const edges = maps.length > 1 ? landscapeEdges(maps, correctedModel(config, maps)).edges.map((e) => ({ ...e, evidence: e.evidence.slice(0, 2) })) : [];
  await writeJsonAtomic(cacheFile, { key, edges }).catch(() => {});
  return edges;
}

/**
 * How a workspace's repositories connect, attached ones included (their maps
 * live in their own KB's state); cached in the workspace KB until a map changes.
 */
export async function workspaceEdges(ws: Workspace): Promise<Edge[]> {
  const repos = await workspaceRepos(ws);
  const configs = new Map<string, OkbConfig | null>();
  const configOf = async (kb: string) => {
    if (!configs.has(kb)) configs.set(kb, await loadConfig({ profileId: kb }).then((r) => r.config, () => null));
    return configs.get(kb) ?? null;
  };
  const home = await configOf(ws.kb);
  if (!home) return [];
  const located = (await Promise.all(repos.map(async (r) => ({ r, cfg: await configOf(r.kb) })))).filter((x): x is { r: RepoEntry; cfg: OkbConfig } => x.cfg !== null);
  const stamps = await Promise.all(located.map(async ({ r, cfg }) => `${r.kb}/${r.id}:${await stat(repoPaths(cfg, r.id).map).then((s) => s.mtimeMs, () => 0)}`));
  const key = `${stamps.join('|')}#${overridesStamp(home)}`;
  const cacheFile = resolve(statePaths(home).root, 'repos', `edges-${ws.id}.json`);
  const cached = await readJsonIfExists<EdgeCache>(cacheFile).catch(() => null);
  if (cached && cached.key === key) return cached.edges;
  const maps: RepoMap[] = [];
  for (const { r, cfg } of located) {
    const map = await loadMap(repoPaths(cfg, r.id)).catch(() => null);
    if (map) maps.push(map);
  }
  const edges = maps.length > 1 ? landscapeEdges(maps, correctedModel(home, maps)).edges.map((e) => ({ ...e, evidence: e.evidence.slice(0, 2) })) : [];
  await writeJsonAtomic(cacheFile, { key, edges }).catch(() => {});
  return edges;
}

/** The repositories a repository talks to: across its workspace when it has one, else its KB. */
export async function neighboursOf(config: OkbConfig, repoId: string, ws?: Workspace | null): Promise<string[]> {
  const edges = await (ws ? workspaceEdges(ws) : kbEdges(config)).catch(() => [] as Edge[]);
  return [...new Set(edges.flatMap((e) => (e.from === repoId ? [e.to] : e.to === repoId ? [e.from] : [])))];
}

/* -------------------------------------------------------------- brief */

const KIND_ORDER = new Map<string, number>(READING_ORDER.map((k, i) => [k, i]));

function title(bundle: Bundle, path: BundlePath): string {
  return bundle.byPath.get(path)?.title ?? path;
}

export async function buildBrief(scope: Scope, options: { sync?: boolean; bundle?: Bundle } = {}): Promise<Brief | null> {
  const config = scope.config;
  if (!config) return null;
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const allRepos = scope.workspace ? await workspaceRepos(scope.workspace) : (await listRepos()).filter((r) => r.kb === config.profile.id);
  const kb = { id: config.profile.id, name: config.profile.displayName || config.profile.id, root: config.kb.root };
  const workspace = scope.workspace ? { id: scope.workspace.id, name: scope.workspace.name, roots: scope.workspace.roots } : null;
  // An attached repository: the shared part (and the map of the repositories) lives in the workspace's KB.
  const sharedBundle = scope.shared ? await loadBundleFor(scope.shared).catch(() => null) : null;
  const sharedKb = scope.shared && sharedBundle ? { id: scope.shared.profile.id, name: scope.shared.profile.displayName || scope.shared.profile.id, root: scope.shared.kb.root } : null;
  const mapBundle = sharedBundle ?? bundle;
  const mapLayout = layoutOf(scope.shared ?? config);
  const landscapeCandidates = mapLayout ? [`${drawerFolder(mapLayout, 'world')}/Paysage des repos.md`, `${drawerFolder(mapLayout, 'world')}/Repository landscape.md`] : ['repos/paysage.md', 'repos/landscape.md'];
  const landscapePath = landscapeCandidates.find((p) => mapBundle.byPath.has(p as BundlePath)) ?? null;
  const places = new Map<string, RepoPlace>();
  for (const r of allRepos) places.set(r.id, await repoPlace(config, r));
  const requests = openRequests(config, scope.repo ? { repo: scope.repo.id } : {}).map((q) => ({ id: q.id, ref: q.ref, fields: q.fields, since: q.createdAt }));
  const teamRequests = openTeamRequests(config).map((q) => ({ id: q.id, kind: q.kind, subject: q.subject, since: q.createdAt }));
  const owner = scope.repo ? await teamOf(config, 'repo', scope.repo.id).catch(() => null) : null;
  const team = owner?.value ? { value: owner.value.value, origin: owner.value.origin, inherited: null } : owner?.inherited ? { value: owner.inherited.value.value, origin: owner.inherited.value.origin, inherited: owner.inherited.product } : null;
  const base = { requests, teamRequests, team, workspace, kb, sharedKb, via: scope.via, landscape: landscapePath };

  let ticket: TicketBrief | null = null;
  if (scope.ticket) {
    const synced = options.sync ? await syncTicket(config, scope.ticket, allRepos).catch(() => null) : null;
    const record = synced?.record ?? scope.ticket;
    const detail = await ticketDetail(config, record.ref);
    ticket = {
      ref: record.ref, title: record.title, status: record.status, auto: record.auto,
      repos: synced?.progress ?? record.repos.map((r) => ({ id: r.id, branch: r.branch, commits: record.journal.filter((j) => j.kind === 'commit' && j.repo === r.id).length, merged: false, gone: false })),
      journal: record.journal.filter((j) => ['note', 'decision', 'trap', 'question'].includes(j.kind)).slice(-6),
      textFile: record.textFile,
      note: ticketNoteIn(bundle, record, (id) => places.get(id) ?? false),
      resume: detail.brief,
      states: detail.detail.states,
      missingCriteria: detail.detail.close.missing,
    };
  }

  if (!scope.repo) {
    const tickets = (await listTickets(config)).filter((t) => t.status === 'active').slice(0, 6);
    const counts = new Map<string, number>();
    for (const path of bundle.docs.keys()) {
      const owner = noteRepo(bundle, path);
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return {
      ...base, repo: null, notes: [], recentTickets: [], shared: [], talksTo: [], calledBy: [], ticket,
      repos: allRepos.map((r) => ({ id: r.id, name: r.name, notes: counts.get(r.id) ?? 0, ...(r.kb !== config.profile.id ? { ownKb: r.kb } : {}) })),
      activeTickets: tickets.map((t) => ({ ref: t.ref, title: t.title, repos: t.repos.map((r) => r.id) })),
    };
  }

  const repo = scope.repo;
  const notes = repoNotes(bundle, repo.id, places.get(repo.id) ?? await repoPlace(config, repo));
  const pack = notes.filter((n) => n.kind !== 'ticket')
    .sort((a, b) => (KIND_ORDER.get(a.kind) ?? 50) - (KIND_ORDER.get(b.kind) ?? 50) || a.path.localeCompare(b.path))
    .slice(0, 10)
    .map((n) => ({ path: n.path as string, title: n.title, kind: n.kind }));
  const recentTickets = notes.filter((n) => n.kind === 'ticket').sort((a, b) => b.path.localeCompare(a.path)).slice(0, 3).map((n) => ({ path: n.path as string, title: n.title }));
  const tied = [...tiedNotes(mapBundle, repo).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shared = tied.filter(([p]) => p !== landscapePath).slice(0, 6).map(([p]) => ({ path: p as string, title: title(mapBundle, p) }));
  const edges = await (scope.workspace ? workspaceEdges(scope.workspace) : kbEdges(config, allRepos)).catch(() => [] as Edge[]);
  const nameOf = (id: string) => allRepos.find((r) => r.id === id)?.name ?? id;
  const talksTo = edges.filter((e) => e.from === repo.id).slice(0, 6).map((e) => ({ repo: nameOf(e.to), label: e.label }));
  const calledBy = edges.filter((e) => e.to === repo.id).slice(0, 6).map((e) => ({ repo: nameOf(e.from), label: e.label }));
  return {
    ...base, repo: { id: repo.id, name: repo.name, path: repo.path },
    notes: pack, recentTickets, shared, talksTo, calledBy, ticket, repos: [], activeTickets: [],
  };
}

/* ------------------------------------------------------ for Claude */

function list(root: string, refs: readonly NoteRef[]): string[] {
  return refs.map((r) => `- ${root}/${r.path} — ${r.title}`);
}

function journalLine(j: JournalEntry): string {
  return `${j.kind}: ${j.text.replace(/\s+/g, ' ').slice(0, 160)}`;
}

/**
 * The brief as Claude reads it at the start of a session or when the scope
 * changes. The notes are the user's approved data; the last lines say how to
 * use OKB in this scope.
 */
/** Open requests to find a team responsible (F2.4-20), with how to answer them. */
function teamLines(brief: Brief, lines: string[]): void {
  if (!brief.teamRequests?.length) return;
  lines.push(`Open team requests: ${brief.teamRequests.map((q) => `${q.kind} ${q.subject} [${q.id}]`).join('; ')}. Find the team responsible with your own tools (ServiceNow assignment group, Jira team or component, wiki team page), write it with \`okb team set <repo|product> <name> --value … --origin … --url …\`, then report with \`okb team requests close <id>\`; never claim a source you could not read.`);
}

export function renderBrief(brief: Brief, options: { mentionedRef?: string | null } = {}): string {
  const root = brief.kb.root;
  const where = brief.workspace ? `workspace "${brief.workspace.name}", KB "${brief.kb.name}"` : `KB "${brief.kb.name}"`;
  const lines: string[] = [];
  if (!brief.repo) {
    const roots = brief.workspace?.roots.join(', ') ?? '';
    lines.push(`OKB scope — ${where}: ${brief.repos.length} repositories${roots ? ` in ${roots}` : ''}. No repository chosen: when the user names a repository or a ticket, OKB narrows to it by itself and you get its notes; or run \`okb scope <repo>\`.`);
    if (brief.repos.length) lines.push(`Repositories (notes in the KB): ${brief.repos.slice(0, 40).map((r) => `${r.name} (${r.ownKb ? `own KB "${r.ownKb}"` : r.notes || 'not onboarded'})`).join(', ')}${brief.repos.length > 40 ? ', …' : ''}.`);
    if (brief.activeTickets.length) lines.push(`Tickets in progress: ${brief.activeTickets.map((t) => `${t.ref} "${t.title}" (${t.repos.join(', ')})`).join('; ')}.`);
    if (brief.landscape) lines.push(`How the repositories connect: ${root}/${brief.landscape}`);
    if (brief.requests?.length) lines.push(`Open OKB requests: ${brief.requests.map((q) => `${q.ref} (${q.fields.join(', ')}) [${q.id}]`).join('; ')}. Fill them with /okb-dev:ticket once the user picks the repository; never claim a source you could not read.`);
    teamLines(brief, lines);
    lines.push(
      'For a question across repositories, `okb ask "<question>" --json` searches the whole KB.',
      'If the user starts working without naming a repository or a ticket, ask in one short line which one; for work on one repository, opening Claude Code in its folder is the simplest (the scope follows by itself).',
    );
    return lines.join('\n');
  }
  const r = brief.repo;
  lines.push(`OKB scope — repository "${r.name}" (${where}; ${brief.via === 'folder' ? 'the session runs in its folder' : 'chosen in the workspace'}). Code: ${r.path}`);
  const t = brief.ticket;
  if (t) {
    const progress = t.repos.map((p) => `${p.id}${p.branch ? ` on ${p.branch}` : ''}: ${p.commits} commit(s)${p.merged ? ', merged' : p.gone ? ', branch gone' : ''}`).join('; ');
    lines.push(`Ticket ${t.ref} "${t.title}"${t.status === 'done' ? ' (finished)' : ''} — ${progress}.${t.textFile ? ` Its text: ${t.textFile}` : ''}`);
    if (t.journal.length) lines.push(`Ticket journal: ${t.journal.map(journalLine).join(' | ')}`);
    if (t.resume) {
      lines.push(`Resume: goal=${t.resume.goal}; last action=${t.resume.lastAction || 'unknown'}; next=${t.resume.next || 'unknown'}.`);
      for (const a of t.resume.failed) lines.push(`Failed approach: ${a.approach}; conditions: ${a.conditions}; result: ${a.result}${a.next ? `; next: ${a.next}` : ''}.`);
    }
    if (t.states?.length) lines.push(`Independent observations: ${t.states.map((s) => `${s.dimension}${s.environment ? `/${s.environment}` : ''}=${s.status}${s.at ? ` (${s.source}, ${s.at.slice(0, 10)})` : ''}`).join('; ')}. Work finished or merged never means delivered.`);
    if (t.missingCriteria?.length) lines.push(`Before closing the work: ${t.missingCriteria.join('; ')}.`);
    // D74: the agent's todos go straight in, a few at a time, and never come back once removed.
    lines.push(`Todos: when you read the ticket and at the end of the session, add at most 3 with \`okb action add "<text>" --ticket ${t.ref} --why "<a few words: from the Jira criteria, failing test…>" [--importance high]\`, and announce each in one line (« ✦ OKB 1 todo ajoutée à ${t.ref} : … »); more only when the person asks. You may tick any todo (\`okb action done <id>\`) and set its importance, never rewrite or remove the person's todos. A todo the person removed is refused if you add it again: do not insist.`);
    if (t.note) lines.push(`Its note: ${root}/${t.note}`);
    else if (t.status === 'done' || t.repos.some((p) => p.merged)) lines.push(`This ticket looks finished and has no note yet: offer /okb-dev:ticket to write it (ask first).`);
  }
  if (brief.requests?.length) lines.push(`Open OKB requests: ${brief.requests.map((q) => `${q.ref} (${q.fields.join(', ')}) [${q.id}]`).join('; ')}. The person asked you to fill these with /okb-dev:ticket: read only what your tools allow (Jira, ServiceNow, wiki), record each value with \`okb ticket set\`, then report with \`okb ticket requests close <id>\`; never claim a source you could not read.`);
  if (brief.team) lines.push(`Team responsible: ${brief.team.value} (${brief.team.inherited ? `from product ${brief.team.inherited}, ` : ''}${brief.team.origin}).`);
  teamLines(brief, lines);
  if (brief.notes.length) lines.push('Read before exploring the code (approved notes, cite them):', ...list(root, brief.notes));
  else lines.push('This repository has no note yet: offer /okb-dev:onboard if the user is discovering it (ask first).');
  if (brief.recentTickets.length) lines.push('Recent tickets here:', ...list(root, brief.recentTickets));
  if (brief.shared.length) lines.push(`Shared notes tied to it (business, features, other repositories)${brief.sharedKb ? `, in the workspace's KB "${brief.sharedKb.name}"` : ''}:`, ...list(brief.sharedKb?.root ?? root, brief.shared));
  const edges = [
    ...(brief.talksTo.length ? [`calls ${brief.talksTo.map((e) => `${e.repo} (${e.label})`).join(', ')}`] : []),
    ...(brief.calledBy.length ? [`is called by ${brief.calledBy.map((e) => `${e.repo} (${e.label})`).join(', ')}`] : []),
  ];
  if (edges.length) lines.push(`Connections: ${edges.join('; ')}.${brief.landscape ? ` Map: ${brief.sharedKb?.root ?? root}/${brief.landscape}` : ''}`);
  lines.push(
    brief.sharedKb
      ? `In this scope: \`okb ask "<question>" --json\` searches this repository's KB first, then the shared notes of "${brief.sharedKb.name}" (--everywhere for the whole of both).`
      : 'In this scope: `okb ask "<question>" --json` ranks this repository and the shared notes tied to it first (--everywhere for the whole KB).',
    t
      ? 'While working, record each decision, trap or open question in one line: `okb ticket note "<text>" --kind decision|trap|question` (a local journal; nothing is written in the KB). When the ticket is done, offer /okb-dev:ticket.'
      : options.mentionedRef
        ? startLine(options.mentionedRef, r.id)
        : `No ticket in progress. When the user starts one, run \`okb ticket resume <ref> --repo ${r.id}\` (reconciles authorized notes with local follow-up; any note update remains a proposal), then follow /okb-dev:ticket's find/create/resume gesture.`,
  );
  return lines.join('\n');
}

/** What Claude does with a ticket the user names and OKB does not follow yet. */
export function startLine(ref: string, repoId: string): string {
  return `The user mentions ticket ${ref}, which OKB does not follow yet. If they are starting work on it, save the ticket text they gave to a file in your scratch folder and run \`okb ticket resume ${ref} --repo ${repoId} --ticket-file <file>\` (reconciles authorized notes with local follow-up; any note update remains a proposal), then follow /okb-dev:ticket's find/create/resume gesture.`;
}
