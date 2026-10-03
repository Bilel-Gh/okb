import { parseOkf, serializeOkf } from '../okf/document.js';
import { withExtension } from '../okf/extensions.js';
import { OkbError } from '../util/errors.js';
import type { BundlePath } from '../util/paths.js';
import type { Change } from './model.js';

/**
 * Turn a set of changes into the exact next text of one file.
 *
 * The same function feeds the diff shown at review time and the write performed
 * at apply time, so what a reviewer approves is what lands.
 */
export function materializeFile(
  path: BundlePath,
  baseline: string | null,
  changes: readonly Change[],
  options: { recordKeys?: boolean } = {},
): string {
  const ordered = [
    ...changes.filter((c) => c.kind === 'replace-document' || c.kind === 'delete-document'),
    ...changes.filter((c) => c.kind === 'create-document'),
    ...mergeLinkChanges(changes.filter((c) => c.kind === 'insert-links' && c.insertLinks?.stage !== 'after-article')),
    ...changes.filter((c) => c.kind === 'append-section'),
    ...mergeLinkChanges(changes.filter((c) => c.kind === 'insert-links' && c.insertLinks?.stage === 'after-article')),
    ...changes.filter((c) => c.kind === 'patch-frontmatter'),
  ];

  let text = baseline;

  for (const change of ordered) {
    if (change.path !== path) {
      throw new OkbError('E_INTERNAL', `change ${change.id} does not target ${path}`);
    }
    switch (change.kind) {
      case 'delete-document': text = ''; break;
      case 'replace-document': {
        if (text === null) throw new OkbError('E_CONFLICT', `cannot replace missing ${path}`);
        text = change.replaceDocument!.content; break;
      }
      case 'create-document': {
        if (text !== null) {
          throw new OkbError('E_CONFLICT', `cannot create ${path}: the file already exists`, {
            detail: { path },
            hint: 'Re-run `okb ingest` so the proposal targets the current tree.',
          });
        }
        text = change.createDocument!.content;
        break;
      }
      case 'insert-links': {
        if (text === null) {
          throw new OkbError('E_CONFLICT', `cannot add links to a missing file: ${path}`);
        }
        const insertions = [...(change.insertLinks?.insertions ?? [])].sort(
          (a, b) => b.span.start - a.span.start,
        );
        let previousStart = Number.POSITIVE_INFINITY;
        for (const ins of insertions) {
          if (ins.span.end > previousStart || ins.span.start < 0 || ins.span.end < ins.span.start) throw new OkbError('E_INVALID', 'overlapping or invalid link spans');
          previousStart = ins.span.start;
          const found = text.slice(ins.span.start, ins.span.end);
          if (found !== ins.original) {
            throw new OkbError('E_STALE', `the text at ${path}:${ins.span.start} changed since the proposal`, {
              detail: { path, expected: ins.original, found },
              hint: 'Run `okb ingest --reprocess` to rebuild the proposal against the current file.',
            });
          }
          text = text.slice(0, ins.span.start) + ins.replacement + text.slice(ins.span.end);
        }
        break;
      }
      case 'append-section': {
        if (text === null) {
          throw new OkbError('E_CONFLICT', `cannot append to a missing file: ${path}`);
        }
        const section = change.appendSection!;
        const sep = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
        text = `${text}${sep}# ${section.heading}\n\n${section.markdown.replace(/\s*$/, '')}\n`;
        if (change.patchFrontmatter) {
          const doc = parseOkf(path, text);
          text = serializeOkf(doc, { ...doc.data, ...change.patchFrontmatter.patch });
        }
        break;
      }
      case 'patch-frontmatter': {
        if (text === null) {
          throw new OkbError('E_CONFLICT', `cannot patch frontmatter of a missing file: ${path}`);
        }
        const doc = parseOkf(path, text);
        text = serializeOkf(doc, { ...doc.data, ...change.patchFrontmatter!.patch });
        break;
      }
    }
  }

  if (text === null) {
    throw new OkbError('E_INTERNAL', `no change produced content for ${path}`);
  }

  // Record the idempotence keys so a second import of the same source is a no-op.
  const keys = changes
    .filter((c) => c.category !== 'metadata' && c.kind !== 'patch-frontmatter')
    .map((c) => c.contentKey);
  const linkKeys = changes
    .filter((c) => c.kind === 'insert-links')
    .flatMap((c) => (c.insertLinks?.insertions ?? []).map((i) => i.linkKey));

  if (options.recordKeys !== false && (keys.length > 0 || linkKeys.length > 0)) {
    try {
      const doc = parseOkf(path, text);
      if (doc.hasFrontmatter) {
        const next = withExtension(doc.data, {
          ...(keys.length > 0 ? { ingested: keys } : {}),
          ...(linkKeys.length > 0 ? { linked: linkKeys } : {}),
        });
        text = serializeOkf(doc, next);
      }
    } catch {
      // A reserved file (index.md, log.md) carries no frontmatter: nothing to record.
    }
  }

  return text;
}

export function groupChangesByPath(
  changes: readonly Change[],
): Map<BundlePath, Change[]> {
  const out = new Map<BundlePath, Change[]>();
  for (const change of changes) {
    const list = out.get(change.path) ?? [];
    list.push(change);
    out.set(change.path, list);
  }
  return out;
}

function mergeLinkChanges(changes: readonly Change[]): Change[] {
  if (!changes.length) return [];
  return [{ ...changes[0]!, insertLinks: { insertions: changes.flatMap(c => c.insertLinks?.insertions ?? []) } }];
}
