import { posix } from 'node:path';
import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import { person } from '../identity/person.js';
import type { Bundle } from '../kb/bundle.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { saveProposal } from '../proposal/store.js';
import { isSecret } from '../security/confidential.js';
import { findSecrets } from '../security/secrets.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath } from '../util/paths.js';

/**
 * A pack: the knowledge of one subject (a repository, a product) in one file,
 * to hand to a colleague without any server (roadmap §6, step 1). It holds the
 * notes as they are, with who wrote them. A 🔒 note, a private one, or a note
 * that holds a secret never goes in. The colleague compares the pack with their
 * brain, then merges what they lack through a proposal they approve.
 */
export type PackNote = { readonly path: string; readonly title: string; readonly content: string };
export type Pack = {
  readonly kind: 'okb-pack';
  readonly v: 1;
  readonly subject: string;
  readonly exportedAt: string;
  readonly from: { readonly brain: string; readonly person: string };
  readonly notes: readonly PackNote[];
  readonly skipped: readonly { readonly path: string; readonly reason: 'secret' | 'private' | 'holds-secret' }[];
};

function assertPack(p: unknown): asserts p is Pack {
  const x = p as Partial<Pack> | null;
  if (!x || x.kind !== 'okb-pack' || x.v !== 1 || !Array.isArray(x.notes)) throw new OkbError('E_INVALID', 'not an OKB pack', { key: 'packInvalid' });
  for (const n of x.notes) {
    const path = (n as PackNote).path;
    if (typeof path !== 'string' || typeof (n as PackNote).content !== 'string' || path.startsWith('/') || path.split('/').some((s) => s === '..' || s === '.')) {
      throw new OkbError('E_INVALID', 'a note of the pack has an unsafe path', { key: 'packInvalid' });
    }
  }
}

const clean = (folder: string) => folder.replace(/^\/+|\/+$/g, '');

export async function exportPack(config: OkbConfig, bundle: Bundle, folder: string, now = new Date()): Promise<Pack> {
  const root = clean(folder);
  const prefix = `${root}/`;
  const notes: PackNote[] = [];
  const skipped: Pack['skipped'][number][] = [];
  for (const e of bundle.entries) {
    if (e.reserved || !e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    const level = (e.ext as { confidentiality?: string }).confidentiality;
    if (isSecret(e.ext)) { skipped.push({ path: rel, reason: 'secret' }); continue; }
    if (level === 'private') { skipped.push({ path: rel, reason: 'private' }); continue; }
    const content = bundle.snapshot.files.get(e.path) ?? '';
    if (findSecrets(content).length) { skipped.push({ path: rel, reason: 'holds-secret' }); continue; }
    notes.push({ path: rel, title: e.title, content });
  }
  if (!notes.length && !skipped.length) throw new OkbError('E_NOT_FOUND', `no note under ${root}`, { key: 'packEmpty', params: { folder: root } });
  return {
    kind: 'okb-pack', v: 1, subject: root, exportedAt: now.toISOString(),
    from: { brain: config.profile.displayName || config.profile.id, person: (await person()).id },
    notes: notes.sort((a, b) => a.path.localeCompare(b.path)), skipped,
  };
}

/** What the pack brings to the brain's folder: notes missing here, notes that differ, notes already the same. */
export function comparePack(bundle: Bundle, pack: Pack, into: string): { added: PackNote[]; changed: PackNote[]; same: number } {
  assertPack(pack);
  const root = clean(into);
  const added: PackNote[] = [];
  const changed: PackNote[] = [];
  let same = 0;
  for (const n of pack.notes) {
    const local = bundle.snapshot.files.get(asBundlePath(posix.join(root, n.path)));
    if (local === undefined) added.push(n);
    else if (sha256(local) !== sha256(n.content)) changed.push(n);
    else same++;
  }
  return { added, changed, same };
}

/**
 * Merge what the brain lacks: one proposal creating the missing notes in the
 * folder, each keeping its author (`generated.by`) and the pack it came from.
 * Notes that differ are not overwritten: comparePack lists them for a person to read.
 */
export async function mergePack(config: OkbConfig, pack: Pack, into: string, bundle?: Bundle): Promise<Proposal> {
  assertPack(pack);
  const { loadBundleFor } = await import('../kb/bundle.js');
  const b = bundle ?? (await loadBundleFor(config));
  const root = clean(into);
  const { added } = comparePack(b, pack, root);
  if (!added.length) throw new OkbError('E_INVALID', 'nothing to merge', { key: 'packNothingNew' });
  const desired = new Map<string, string>();
  for (const n of added) {
    desired.set(posix.join(root, n.path), withOrigin(n.content, pack));
  }
  const proposal = proposeFiles(config, b, desired, `merge pack ${pack.subject} from ${pack.from.brain}`);
  await saveProposal(config, proposal);
  return proposal;
}

/** The note as it came, with `x_okb.pack` saying where from (the author stays in `generated.by`). */
function withOrigin(content: string, pack: Pack): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return content;
  let data: Record<string, unknown>;
  try { data = (YAML.parse(m[1]!) as Record<string, unknown>) ?? {}; } catch { return content; }
  const ext = (data.x_okb as Record<string, unknown> | undefined) ?? {};
  // A note's identity in the other brain must not collide with ours.
  const { id: _id, ...rest } = ext as { id?: unknown };
  data.x_okb = { ...rest, pack: { from: pack.from.brain, person: pack.from.person, subject: pack.subject, at: pack.exportedAt } };
  return `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n${content.slice(m[0].length)}`;
}
