import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { landscapeEdges, type Edge } from '../repo/generated.js';
import { repoNotes } from '../repo/notes.js';
import { isFlat, READING_ORDER } from '../repo/pack.js';
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
};

/* --------------------------------------------------------- neighbours */

type EdgeCache = { key: string; edges: Edge[] };

/** How the KB's repositories connect, from their maps; cached until a map changes. */
export async function kbEdges(config: OkbConfig, repos?: readonly RepoEntry[]): Promise<Edge[]> {
  const list = (repos ?? (await listRepos())).filter((r) => r.kb === config.profile.id);
  const stamps = await Promise.all(list.map(async (r) => `${r.id}:${await stat(repoPaths(config, r.id).map).then((s) => s.mtimeMs, () => 0)}`));
  const key = stamps.join('|');
  const cacheFile = resolve(statePaths(config).root, 'repos', 'edges.json');
  const cached = await readJsonIfExists<EdgeCache>(cacheFile).catch(() => null);
  if (cached && cached.key === key) return cached.edges;
  const maps: RepoMap[] = [];
  for (const r of list) {
    const map = await loadMap(repoPaths(config, r.id)).catch(() => null);
    if (map) maps.push(map);
  }
  const edges = maps.length > 1 ? landscapeEdges(maps).edges.map((e) => ({ ...e, evidence: e.evidence.slice(0, 2) })) : [];
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
  const key = stamps.join('|');
  const cacheFile = resolve(statePaths(home).root, 'repos', `edges-${ws.id}.json`);
  const cached = await readJsonIfExists<EdgeCache>(cacheFile).catch(() => null);
  if (cached && cached.key === key) return cached.edges;
  const maps: RepoMap[] = [];
  for (const { r, cfg } of located) {
    const map = await loadMap(repoPaths(cfg, r.id)).catch(() => null);
    if (map) maps.push(map);
  }
  const edges = maps.length > 1 ? landscapeEdges(maps).edges.map((e) => ({ ...e, evidence: e.evidence.slice(0, 2) })) : [];
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
  const landscapePath = ['repos/paysage.md', 'repos/landscape.md'].find((p) => mapBundle.byPath.has(p as BundlePath)) ?? null;
  const base = { workspace, kb, sharedKb, via: scope.via, landscape: landscapePath };

  let ticket: TicketBrief | null = null;
  if (scope.ticket) {
    const synced = options.sync ? await syncTicket(config, scope.ticket, allRepos).catch(() => null) : null;
    const record = synced?.record ?? scope.ticket;
    ticket = {
      ref: record.ref, title: record.title, status: record.status, auto: record.auto,
      repos: synced?.progress ?? record.repos.map((r) => ({ id: r.id, branch: r.branch, commits: record.journal.filter((j) => j.kind === 'commit' && j.repo === r.id).length, merged: false, gone: false })),
      journal: record.journal.filter((j) => ['note', 'decision', 'trap', 'question'].includes(j.kind)).slice(-6),
      textFile: record.textFile,
      note: ticketNoteIn(bundle, record, isFlat(config)),
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
  const notes = repoNotes(bundle, repo.id, isFlat(config));
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
    if (t.note) lines.push(`Its note: ${root}/${t.note}`);
    else if (t.status === 'done' || t.repos.some((p) => p.merged)) lines.push(`This ticket looks finished and has no note yet: offer /okb:ticket to write it (ask first).`);
  }
  if (brief.notes.length) lines.push('Read before exploring the code (approved notes, cite them):', ...list(root, brief.notes));
  else lines.push('This repository has no note yet: offer /okb:onboard if the user is discovering it (ask first).');
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
      ? 'While working, record each decision, trap or open question in one line: `okb ticket note "<text>" --kind decision|trap|question` (a local journal; nothing is written in the KB). When the ticket is done, offer /okb:ticket.'
      : options.mentionedRef
        ? startLine(options.mentionedRef, r.id)
        : `No ticket in progress. When the user starts one, run \`okb ticket start <ref> --repo ${r.id}\` (local follow-up of branch, commits and journal; nothing is written in the KB), then follow /okb:ticket's start mode.`,
  );
  return lines.join('\n');
}

/** What Claude does with a ticket the user names and OKB does not follow yet. */
export function startLine(ref: string, repoId: string): string {
  return `The user mentions ticket ${ref}, which OKB does not follow yet. If they are starting work on it, save the ticket text they gave to a file in your scratch folder and run \`okb ticket start ${ref} --repo ${repoId} --ticket-file <file>\` (local follow-up of branch, commits and journal; nothing is written in the KB), then follow /okb:ticket's start mode.`;
}
