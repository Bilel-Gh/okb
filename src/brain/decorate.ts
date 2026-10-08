import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import { markdownLink } from '../links/portable.js';
import { parseOkf } from '../okf/document.js';
import { computeProposalHash, type Change, type Proposal } from '../proposal/model.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { layoutOf, rootFile, type BrainLayout } from './layout.js';
import { hubOf, positionOf, subjectFoldersOf } from './tree.js';

/**
 * What a brain adds to every new note before it is proposed, without AI:
 * a stable id, a breadcrumb up to the brain's home (so the graph forms a tree
 * in Obsidian too), and the hub pages of the subjects above it when they do
 * not exist yet (a skeleton the person fills later, through a suggestion).
 * Everything stays inside the proposal: nothing is written before approval.
 */
const CRUMB = '🧭 ';

/** A stable, time-ordered note id: `n-` + 9 time characters + 8 random ones. */
export function newNoteId(now = Date.now()): string {
  return `n-${now.toString(36).padStart(9, '0')}${randomBytes(5).toString('hex').slice(0, 8)}`;
}

function brainName(config: OkbConfig): string {
  return config.profile.displayName?.trim() || config.profile.id;
}

/** The breadcrumb line of a note: links to the home and to each subject's hub above it. */
export function crumbLine(layout: BrainLayout, config: OkbConfig, path: string): string {
  const home = asBundlePath(rootFile(layout, 'home'));
  const parts = [markdownLink(path, home, `🧠 ${brainName(config)}`)];
  for (const f of subjectFoldersOf(layout, path)) {
    const hub = hubOf(f.folder)!;
    parts.push(markdownLink(path, hub, f.title));
  }
  return `${CRUMB}${parts.join(' › ')}`;
}

function hubSkeleton(config: OkbConfig, layout: BrainLayout, path: BundlePath, title: string, kind: string): string {
  const fr = layout.lang === 'fr';
  const front = {
    type: 'Overview',
    title,
    description: fr ? `Page du sujet « ${title} » : sa synthèse en 5 minutes et tout ce qu’il contient.` : `Page of the subject “${title}”: its 5-minute summary and everything it holds.`,
    status: 'draft',
    generated: { by: config.okf.machineActor, at: new Date().toISOString() },
    x_okb: { v: 1, id: newNoteId(), brain: { type: `${kind}-hub` }, template: 'subject-five' },
  };
  const lines = [`---\n${YAML.stringify(front, { lineWidth: 0 })}---`, ''];
  if (path !== rootFile(layout, 'home')) lines.push(crumbLine(layout, config, path), '');
  lines.push(`# ${title}`, '', fr
    ? '> La synthèse « en 5 minutes » de ce sujet n’est pas encore écrite. Demande-la à Claude quand le sujet aura quelques notes.'
    : '> The 5-minute summary of this subject is not written yet. Ask Claude for it once the subject has a few notes.', '');
  return lines.join('\n');
}

function withIdAndCrumb(config: OkbConfig, layout: BrainLayout, path: BundlePath, content: string): string {
  let doc;
  try { doc = parseOkf(path, content); } catch { return content; }
  if (doc.reserved) return content;
  let out = content;
  const ext = (doc.data.x_okb ?? {}) as Record<string, unknown>;
  if (doc.hasFrontmatter && typeof ext.id !== 'string') {
    const data = { ...doc.data, x_okb: { v: 1, ...ext, id: newNoteId() } };
    out = `---\n${YAML.stringify(data, { lineWidth: 0 })}---${doc.eol}${doc.body.startsWith('\n') || doc.body.startsWith('\r\n') ? '' : doc.eol}${doc.body}`;
  }
  const after = parseOkf(path, out);
  const isHome = path === rootFile(layout, 'home');
  if (!isHome && positionOf(layout, path).drawer && !after.body.trimStart().startsWith(CRUMB)) {
    const body = after.body.replace(/^\s*\n/, '');
    out = `${out.slice(0, after.bodyOffset)}\n${crumbLine(layout, config, path)}\n\n${body}`;
  }
  return out;
}

/**
 * Decorate a proposal for a brain. A no-op for KBs that are not brains and for
 * proposals that create nothing.
 */
export function decorateProposal(config: OkbConfig, existing: ReadonlySet<string>, proposal: Proposal): Proposal {
  const layout = layoutOf(config);
  if (!layout) return proposal;
  const creates = proposal.changes.filter((c) => c.kind === 'create-document' && c.path.endsWith('.md'));
  if (!creates.length) return proposal;
  const created = new Set(proposal.changes.map((c) => c.path as string));
  const baseline: Record<string, string | null> = { ...proposal.baseline };
  const hubs: Change[] = [];
  const hubId = new Map<string, string>();
  const add = (path: BundlePath, title: string, kind: string) => {
    if (existing.has(path) || hubId.has(path)) return;
    if (created.has(path)) return;
    baseline[path] = null;
    const id = `c-hub-${sha256(path).slice(0, 10)}`;
    hubId.set(path, id);
    hubs.push({
      id, kind: 'create-document', path, label: `subject page ${path}`,
      rationale: 'the subject this note belongs to has no page yet: an empty page, filled later on request',
      contentKey: sha256(`hub:${path}`), evidenceIds: [], dependsOn: [], category: 'metadata',
      createDocument: { content: hubSkeleton(config, layout, path, title, kind) },
    });
  };
  const home = asBundlePath(rootFile(layout, 'home'));
  const needs = new Map<string, string[]>();
  for (const c of creates) {
    const above = [{ path: home, title: brainName(config), kind: 'home' }, ...subjectFoldersOf(layout, c.path).map((f) => ({ path: hubOf(f.folder)!, title: f.title, kind: f.kind }))];
    for (const h of above) add(h.path, h.title, h.kind);
    needs.set(c.id, above.map((h) => hubId.get(h.path)).filter((x): x is string => Boolean(x)));
  }
  // A hub's own breadcrumb points at the hubs above it: it depends on them too.
  for (const h of hubs) {
    const above = [home, ...subjectFoldersOf(layout, h.path).map((f) => hubOf(f.folder)!)].map((p) => hubId.get(p)).filter((x): x is string => Boolean(x) && x !== h.id);
    (h as { dependsOn: readonly string[] }).dependsOn = above;
  }
  // The new notes link to those pages through their breadcrumb: they depend on them.
  const changes: Change[] = [...hubs, ...proposal.changes.map((c) => {
    if (c.kind !== 'create-document' || !c.createDocument || !c.path.endsWith('.md')) return c;
    const content = withIdAndCrumb(config, layout, c.path, c.createDocument.content);
    const deps = [...new Set([...c.dependsOn, ...(needs.get(c.id) ?? [])])];
    return { ...c, dependsOn: deps, createDocument: { content } };
  })];
  const next = { ...proposal, changes, baseline };
  const { contentHash: _h, status: _s, ...rest } = next;
  return { ...next, contentHash: computeProposalHash(rest) };
}

/** The relative path of a note's folder, for messages. */
export function folderOf(path: string): string {
  const dir = posix.dirname(path);
  return dir === '.' ? '' : dir;
}
