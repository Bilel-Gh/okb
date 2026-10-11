import { resolve } from 'node:path';
import YAML from 'yaml';
import { layoutOf } from '../brain/layout.js';
import { glossary } from '../brain/views.js';
import type { OkbConfig } from '../config/schema.js';
import { findNotes } from '../find/find.js';
import { passagesFor, type Passage } from '../find/answer.js';
import { loadBundle, loadBundleFor, type Bundle } from '../kb/bundle.js';
import { snapshotFromEntries } from '../links/check.js';
import { isInside } from '../kb/registry.js';
import { normalizeSurface } from '../kb/search.js';
import { proposeFiles } from '../proposal/files.js';
import { computeProposalHash } from '../proposal/model.js';
import { saveProposal } from '../proposal/store.js';
import { assertNoSecrets } from '../security/guard.js';
import { isSecret } from '../security/confidential.js';
import { conceptGaps } from '../suggest/gaps.js';
import { OkbError } from '../util/errors.js';
import { asBundlePath, assertInsideRoot } from '../util/paths.js';
import { sha256 } from '../util/hash.js';
import { assertMayShare, heldReason, listDrawers, sharedFolder, sharingOf, type DrawerInfo } from './drawers.js';
import { readManifest } from './manifest.js';

/**
 * The notes of the others (2.1). A colleague's drawer is read as a small
 * brain of its own: searched, read, compared with the person's — and never
 * written. What is in a drawer is someone else's text: it is shown, it can be
 * kept through a proposal the person reviews, and it is never taken as an
 * instruction.
 */
type Other = { readonly info: DrawerInfo; readonly root: string; readonly bundle: Bundle; readonly config: OkbConfig };
const views = new Map<string, { source: Bundle; hash: string; bundle: Bundle }>();

/** Only manifest-listed, unchanged notes may cross this boundary; loose files are never shared implicitly. */
async function sharedBundle(root: string, folder: string, drawer: string): Promise<Bundle | null> {
  const manifest = await readManifest(folder, drawer);
  if (!manifest) return null;
  const safe = new Map<string, string>();
  for (const n of manifest.notes) {
    try { await assertInsideRoot(root, n.path); safe.set(n.path, n.sha256); } catch { /* a symlink is never read */ }
  }
  const source = await loadBundle(root);
  const hash = sha256(JSON.stringify([...safe]));
  const cached = views.get(root);
  if (cached?.source === source && cached.hash === hash) return cached.bundle;
  const entries = source.entries.filter((e) => !e.reserved && safe.get(e.path) === e.sha256 && !heldReason(e, source.snapshot.files.get(e.path) ?? ''));
  const live = new Set(entries.map((e) => e.path));
  const bundle: Bundle = { ...source, entries, byPath: new Map(entries.map((e) => [e.path, e])), docs: new Map([...source.docs].filter(([path]) => live.has(path))), snapshot: snapshotFromEntries([...source.snapshot.files].filter(([path]) => live.has(path))), unreadable: source.unreadable.filter((e) => safe.has(e.path)) };
  if (views.size >= 8 && !views.has(root)) views.delete(views.keys().next().value!);
  views.set(root, { source, hash, bundle });
  return bundle;
}

/** The agent's map and glossary obey the same 🔒 boundary as notes.find. */
export function visibleOwnBundle(bundle: Bundle, actor: 'person' | 'agent'): Bundle {
  if (actor === 'person') return bundle;
  const entries = bundle.entries.filter((e) => !isSecret(e.ext));
  const live = new Set(entries.map((e) => e.path));
  return { ...bundle, entries, byPath: new Map(entries.map((e) => [e.path, e])), docs: new Map([...bundle.docs].filter(([path]) => live.has(path))), snapshot: snapshotFromEntries([...bundle.snapshot.files].filter(([path]) => live.has(path))) };
}

async function others(config: OkbConfig, env: NodeJS.ProcessEnv): Promise<Other[]> {
  if (!sharingOf(config)) return [];
  assertMayShare(config);
  const sharing = await sharedFolder(config);
  const out: Other[] = [];
  for (const info of await listDrawers(config, env)) {
    if (info.mine) continue;
    const root = resolve(sharing.folder, info.drawer);
    const bundle = await sharedBundle(root, sharing.folder, info.drawer);
    if (bundle) out.push({ info, root, bundle, config: { ...config, kb: { ...config.kb, root } } });
  }
  return out;
}

async function drawerOf(config: OkbConfig, env: NodeJS.ProcessEnv, drawer: string): Promise<Other> {
  assertMayShare(config);
  const sharing = await sharedFolder(config);
  const info = (await listDrawers(config, env)).find((d) => !d.mine && d.drawer === drawer);
  const root = info ? resolve(sharing.folder, info.drawer) : '';
  const bundle = info ? await sharedBundle(root, sharing.folder, info.drawer) : null;
  if (!info || !bundle) throw new OkbError('E_NOT_FOUND', `no drawer "${drawer}"`, { key: 'drawerUnknown', params: { drawer: drawer.slice(0, 60) } });
  return { info, root, bundle, config: { ...config, kb: { ...config.kb, root } } };
}

export type SharedHit = { readonly drawer: string; readonly by: string; readonly path: string; readonly title: string; readonly snippet: string; readonly score: number };

/** The colleagues' notes that hold every word of the search, the best first. The person's own drawer is not searched: those are their notes. */
export async function findShared(config: OkbConfig, env: NodeJS.ProcessEnv, query: string, limit = 5): Promise<SharedHit[]> {
  const hits: SharedHit[] = [];
  for (const o of await others(config, env)) {
    for (const h of findNotes(o.config, o.bundle, query, { limit, allWords: true }).hits) hits.push({ drawer: o.info.drawer, by: o.info.name, path: h.path, title: h.title, snippet: h.snippet, score: h.score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type AttributedPassage = Passage & { readonly shared?: { readonly drawer: string; readonly by: string } };
export type SharingIssue = { readonly code: string; readonly key?: string; readonly message: string };
export function sharingIssue(error: unknown): SharingIssue {
  return { code: error instanceof OkbError ? error.code : 'E_IO', ...(error instanceof OkbError && error.key ? { key: error.key } : {}), message: 'Shared notes are unavailable; personal results are still shown.' };
}

/** Shared excerpts carry a separate address: identical paths in two brains cannot collide. */
export async function sharedPassages(config: OkbConfig, env: NodeJS.ProcessEnv, question: string): Promise<AttributedPassage[]> {
  const out: AttributedPassage[] = [];
  for (const o of await others(config, env)) {
    for (const p of passagesFor(o.config, o.bundle, question, { notes: 3, perNote: 1 }).passages) {
      out.push({ ...p, shared: { drawer: o.info.drawer, by: o.info.name } });
    }
  }
  return out.slice(0, 8);
}

/** The same retrieval is rebuilt server-side for both the preview and the composed answer. */
export async function passagesWithShared(config: OkbConfig, env: NodeJS.ProcessEnv, question: string): Promise<{ passages: AttributedPassage[]; notes: { path: string; title: string; shared?: { drawer: string; by: string } }[]; sharedIssue?: SharingIssue }> {
  const own = passagesFor(config, await loadBundleFor(config), question);
  let shared: AttributedPassage[] = [];
  let issue: SharingIssue | undefined;
  try { shared = await sharedPassages(config, env, question); } catch (error) { issue = sharingIssue(error); }
  const selected: AttributedPassage[] = [...own.passages.slice(0, shared.length ? 6 : 8), ...shared.slice(0, 2)];
  const passages = selected.map((p, i) => ({ ...p, n: i + 1 }));
  const sharedNotes = passages.filter((p) => p.shared).map((p) => ({ path: String(p.path), title: p.title, shared: p.shared! }));
  return { passages, notes: [...own.notes, ...sharedNotes], ...(issue ? { sharedIssue: issue } : {}) };
}

export type SharedNote = { readonly drawer: string; readonly by: string; readonly path: string; readonly title: string; readonly description: string; readonly markdown: string };

/** One note of a colleague's drawer, as it is. Nothing outside a drawer can be asked for. */
export async function readShared(config: OkbConfig, env: NodeJS.ProcessEnv, drawer: string, path: string): Promise<SharedNote> {
  const o = await drawerOf(config, env, drawer);
  return noteFromOther(o, path);
}

function noteFromOther(o: Other, path: string): SharedNote {
  let at;
  try { at = asBundlePath(path); } catch { at = null; }
  const entry = at ? o.bundle.byPath.get(at) : undefined;
  const doc = at ? o.bundle.docs.get(at) : undefined;
  if (!entry || !doc || !isInside(resolve(o.root, entry.path), o.root)) throw new OkbError('E_NOT_FOUND', 'Note not found in this drawer.', { key: 'noteNotFound' });
  return { drawer: o.info.drawer, by: o.info.name, path: entry.path, title: entry.title, description: entry.description, markdown: doc.body };
}

/** A note without what differs from one brain to the other: its identity there, and where a copy came from. */
function canonical(content: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return content;
  let data: Record<string, unknown>;
  try { data = (YAML.parse(m[1]!) as Record<string, unknown>) ?? {}; } catch { return content; }
  const { id: _id, shared: _shared, pack: _pack, ...ext } = (data.x_okb as Record<string, unknown> | undefined) ?? {};
  return `${YAML.stringify({ ...data, x_okb: ext }, { lineWidth: 0 })}\n${content.slice(m[0].length)}`;
}

/**
 * « Garder dans mon cerveau »: a colleague's note, proposed to the person's own
 * brain at the same place, saying who shared it. A note the person already has
 * is never overwritten: the same one is said to be there, a different one is
 * for them to compare.
 */
export async function keepShared(config: OkbConfig, env: NodeJS.ProcessEnv, input: { readonly drawer: string; readonly path: string }, now = new Date()): Promise<{ proposal: string; target: string; title: string; by: string }> {
  const o = await drawerOf(config, env, input.drawer);
  const note = noteFromOther(o, input.path);
  // Keep exactly the validated snapshot, rather than reopening a file that may have changed since the read.
  const theirs = o.bundle.snapshot.files.get(asBundlePath(note.path))!;
  const bundle = await loadBundleFor(config);
  const target = asBundlePath(note.path);
  const mine = bundle.snapshot.files.get(target);
  if (mine !== undefined) {
    const same = canonical(mine) === canonical(theirs);
    throw new OkbError('E_CONFLICT', same ? 'you already have this note' : 'you have a different note at this place', { key: same ? 'shareAlreadyHave' : 'shareDiffers', params: { title: note.title, by: o.info.name } });
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(theirs);
  let content = theirs;
  if (m) {
    const data = (YAML.parse(m[1]!) as Record<string, unknown>) ?? {};
    // The note's identity in the colleague's brain stays there; this brain gives its own.
    const { id: _id, ...ext } = (data.x_okb as Record<string, unknown> | undefined) ?? {};
    data.x_okb = { ...ext, shared: { by: o.info.name, person: o.info.person, drawer: o.info.drawer, path: note.path, sha256: sha256(theirs), at: now.toISOString() } };
    content = `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n${theirs.slice(m[0].length)}`;
  }
  assertNoSecrets({ content }, 'shared note');
  const files = proposeFiles(config, bundle, new Map([[target, content]]), `keep in my brain: ${note.title}`);
  const { contentHash: _hash, status: _status, ...rest } = { ...files, changes: files.changes.map((c) => ({ ...c, category: 'article' as const, rationale: `a note shared by ${o.info.name}; read it before approving` })) };
  const proposal = { ...rest, status: 'prepared' as const, contentHash: computeProposalHash(rest) };
  await saveProposal(config, proposal);
  return { proposal: proposal.id, target, title: note.title, by: o.info.name };
}

type Ref = { readonly title: string; readonly path: string };
export type BrainsMap = {
  readonly drawer: string; readonly by: string;
  /** Notes both have, by their title. */
  readonly both: readonly Ref[];
  /** What the person has and the colleague did not share. */
  readonly mine: readonly Ref[];
  /** What the colleague shared and the person does not have. */
  readonly theirs: readonly Ref[];
  /** Terms both use in several notes, with a card on neither side. */
  readonly holes: readonly { readonly term: string }[];
  /** Terms the person uses without a card, that the colleague explains. */
  readonly fromThem: readonly { readonly term: string; readonly path: string }[];
};

/** The person's brain beside each colleague's drawer: what each knows, what both know, and the holes. Only what was shared is known of a colleague. */
export async function brainsMap(config: OkbConfig, env: NodeJS.ProcessEnv, bundle: Bundle): Promise<BrainsMap[]> {
  const layout = layoutOf(config);
  const key = (title: string) => normalizeSurface(title);
  const own = bundle.entries.filter((e) => !e.reserved);
  const ownKeys = new Set(own.map((e) => key(e.title)));
  const myGaps = conceptGaps(layout, bundle, config.conceptAssist.stoplist);
  const out: BrainsMap[] = [];
  for (const o of await others(config, env)) {
    const their = o.bundle.entries.filter((e) => !e.reserved);
    const theirKeys = new Map(their.map((e) => [key(e.title), e]));
    const theirTerms = new Map(glossary(layout, o.bundle).flatMap((g) => [g.term, ...g.aliases].map((t) => [key(t), g.path] as const)));
    const theirGaps = new Set(conceptGaps(layout, o.bundle, config.conceptAssist.stoplist).map((g) => key(g.term)));
    out.push({
      drawer: o.info.drawer, by: o.info.name,
      both: own.filter((e) => theirKeys.has(key(e.title))).map((e) => ({ title: e.title, path: e.path })),
      mine: own.filter((e) => !theirKeys.has(key(e.title))).map((e) => ({ title: e.title, path: e.path })),
      theirs: their.filter((e) => !ownKeys.has(key(e.title))).map((e) => ({ title: e.title, path: e.path })),
      holes: myGaps.filter((g) => theirGaps.has(key(g.term))).map((g) => ({ term: g.term })),
      fromThem: myGaps.flatMap((g) => { const path = theirTerms.get(key(g.term)); return path ? [{ term: g.term, path }] : []; }),
    });
  }
  return out;
}

export type CommonTerm = { readonly term: string; readonly definitions: readonly { readonly by: string | null; readonly drawer: string | null; readonly definition: string; readonly path: string }[] };

/** One glossary for everyone who shares: each term with who defines it (`by` is null for the person's own card). */
export async function commonGlossary(config: OkbConfig, env: NodeJS.ProcessEnv, bundle: Bundle): Promise<CommonTerm[]> {
  const layout = layoutOf(config);
  const terms = new Map<string, { term: string; definitions: { by: string | null; drawer: string | null; definition: string; path: string }[] }>();
  const add = (g: { term: string; path: string; description: string; oneLiner: string | null }, by: string | null, drawer: string | null) => {
    const k = normalizeSurface(g.term);
    const entry = terms.get(k) ?? { term: g.term, definitions: [] };
    entry.definitions.push({ by, drawer, definition: g.oneLiner ?? g.description, path: g.path });
    terms.set(k, entry);
  };
  for (const g of glossary(layout, bundle)) add(g, null, null);
  for (const o of await others(config, env)) for (const g of glossary(layout, o.bundle)) add(g, o.info.name, o.info.drawer);
  return [...terms.values()].sort((a, b) => a.term.localeCompare(b.term));
}
