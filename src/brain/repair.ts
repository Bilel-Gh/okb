import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { applyFileEdits, rewriteUrl, type FileEdit } from '../links/check.js';
import { portableLink, resolveInternal } from '../links/portable.js';
import { extractLinks } from '../markdown/ast.js';
import { parseOkf } from '../okf/document.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import type { BundlePath } from '../util/paths.js';
import { newNoteId } from './decorate.js';
import type { IntegrityFinding } from './integrity.js';

/**
 * Repairs for what the integrity check found, as one proposal: identical sync
 * copies removed (they stay in the trash), missing note ids added, links to a
 * note moved outside OKB pointed at its new place. Nothing else is touched;
 * different copies and true broken links are left for the person.
 */
export function repairProposal(config: OkbConfig, bundle: Bundle, findings: readonly IntegrityFinding[], options: { ids?: boolean } = {}): { proposal: Proposal | null; counts: { copies: number; ids: number; links: number } } {
  const desired = new Map<string, string | null>();
  let copies = 0;
  let ids = 0;
  let links = 0;
  for (const f of findings) {
    if (f.code === 'sync-copy' && f.detail === 'identical' && f.path) { desired.set(f.path, null); copies++; }
  }
  if (options.ids !== false) {
    for (const f of findings.filter((x) => x.code === 'missing-id' && x.path)) {
      if (desired.has(f.path!)) continue;
      const text = bundle.snapshot.files.get(f.path as BundlePath);
      if (!text) continue;
      const doc = parseOkf(f.path!, text);
      if (!doc.hasFrontmatter) continue;
      const data = { ...doc.data, x_okb: { v: 1, ...((doc.data.x_okb as Record<string, unknown> | undefined) ?? {}), id: newNoteId() } };
      desired.set(f.path!, `---\n${YAML.stringify(data, { lineWidth: 0 })}---${doc.eol}${doc.body.startsWith('\n') ? '' : doc.eol}${doc.body}`);
      ids++;
    }
  }
  const moved = findings.filter((x) => x.code === 'moved-note' && x.path && x.to && x.detail);
  if (moved.length) {
    const edits: FileEdit[] = [];
    for (const m of moved) {
      const file = m.path as BundlePath;
      const text = (desired.get(file) ?? bundle.snapshot.files.get(file)) as string | undefined;
      if (!text) continue;
      const doc = parseOkf(file, text);
      for (const link of extractLinks(doc.body)) {
        if (link.url !== m.detail) continue;
        const target = resolveInternal(file, link.url);
        if (!target) continue;
        const anchor = link.url.includes('#') ? decodeURIComponent(link.url.split('#').slice(1).join('#')) : undefined;
        const span = { start: doc.bodyOffset + link.span.start, end: doc.bodyOffset + link.span.end };
        edits.push({ file, span, replacement: rewriteUrl(text.slice(span.start, span.end), link.url, portableLink(file, m.to!, anchor ? { anchor } : {})), reason: `moved to ${m.to}` });
        links++;
      }
    }
    const snapshot = { files: new Map([...bundle.snapshot.files].map(([p, t]) => [p, (desired.get(p) as string | undefined) ?? t])) };
    for (const [p, t] of applyFileEdits(snapshot, edits)) desired.set(p, t);
  }
  if (!desired.size) return { proposal: null, counts: { copies, ids, links } };
  return { proposal: proposeFiles(config, bundle, desired, 'brain repair'), counts: { copies, ids, links } };
}
