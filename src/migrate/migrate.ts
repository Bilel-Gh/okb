import { posix } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { protectedSpans, isProtected } from '../markdown/ast.js';
import { proposeFiles } from '../proposal/files.js';
import { saveProposal } from '../proposal/store.js';
import type { Proposal } from '../proposal/model.js';
import { applyProposal, rollback, type Receipt } from '../apply/apply.js';
import { rewriteUrl, applyFileEdits, type FileEdit } from '../links/check.js';
import { extractLinks } from '../markdown/ast.js';
import { normalizeSurface } from '../kb/search.js';
import { parseOkf } from '../okf/document.js';
import { classifyLink, portableLink } from '../links/portable.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readJsonIfExists, writeJsonAtomic, writeTextAtomic, readTextIfExists } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, bundlePathToAbsolute, type BundlePath } from '../util/paths.js';
import { resolve } from 'node:path';

export type MigrationKind = 'portable-links';

export type MigrationEdit = {
  readonly file: BundlePath;
  readonly line: number;
  readonly before: string;
  readonly after: string;
  readonly reason: string;
};

export type MigrationPlan = {
  readonly kind: MigrationKind;
  readonly edits: readonly MigrationEdit[];
  /** Cases a machine must not decide: ambiguous wikilinks, unresolvable targets. */
  readonly manual: readonly { readonly file: BundlePath; readonly line: number; readonly url: string; readonly why: string }[];
  readonly filesTouched: number;
  readonly proposal: Proposal;
};

export type MigrationReceipt = Receipt;

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Convert an existing bundle to the house link form.
 *
 * Nothing is decided on the user's behalf when it is genuinely ambiguous: a
 * wikilink matching two documents goes to `manual`, not to a coin flip.
 */
export async function planMigration(
  config: OkbConfig,
  kind: MigrationKind,
  options: { bundle?: Bundle } = {},
): Promise<MigrationPlan> {
  if (kind !== 'portable-links') {
    throw new OkbError('E_UNSUPPORTED', `unknown migration "${kind}"`, {
      hint: 'Available: portable-links',
    });
  }
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const edits: MigrationEdit[] = [];
  const manual: MigrationPlan['manual'] = [];
  const byTitle = indexByTitle(bundle);
  const splices: FileEdit[] = [];

  for (const [file, text] of bundle.snapshot.files) {
    if (!file.endsWith('.md')) continue;
    const doc = safeBody(file, text);
    const offset = text.length - doc.body.length;
    const protectedRanges = protectedSpans(doc.body);
    const quotesAndCode = protectedRanges.filter(s => !extractLinks(doc.body).some(l => l.span.start === s.start && l.span.end === s.end));

    for (const link of extractLinks(doc.body)) {
      if (isProtected(quotesAndCode, link.span.start, link.span.end)) continue;
      const c = classifyLink(link.url, file);
      const addSplice = (url: string) => splices.push({ file, span: { start: offset + link.span.start, end: offset + link.span.end }, replacement: rewriteUrl(doc.body.slice(link.span.start, link.span.end), link.url, url), reason: 'portable link' });
      if (c.kind !== 'forbidden') continue;
      const line = link.line + doc.lineBase;

      if (c.reason === 'bundle-absolute') {
        const target = asBundlePath(link.url.split('#')[0]!.replace(/^\/+/, ''));
        const anchor = link.url.includes('#') ? link.url.split('#').slice(1).join('#') : undefined;
        if (!bundle.snapshot.files.has(target)) { (manual as any[]).push({ file, line, url: link.url, why: 'target absent' }); continue; }
        addSplice(portableLink(file, target, anchor ? { anchor } : {}));
        edits.push({
          file,
          line,
          before: link.url,
          after: portableLink(file, target, anchor ? { anchor } : {}),
          reason: 'bundle-absolute link made relative to the containing file',
        });
        continue;
      }

      if (c.reason === 'missing-extension' && c.target) {
        const candidate = `${c.target}.md` as BundlePath;
        if (bundle.byPath.has(candidate)) {
          addSplice(portableLink(file, candidate, c.anchor ? { anchor: c.anchor } : {}));
          edits.push({
            file,
            line,
            before: link.url,
            after: portableLink(file, candidate, c.anchor ? { anchor: c.anchor } : {}),
            reason: 'added the explicit .md extension',
          });
          continue;
        }
      }

      (manual as MigrationPlan['manual'][number][]).push({
        file,
        line,
        url: link.url,
        why: c.message ?? `forbidden form (${c.reason})`,
      });
    }

    for (const match of doc.body.matchAll(WIKILINK)) {
      if (isProtected(protectedRanges, match.index!, match.index! + match[0].length)) continue;
      const label = match[1]!.trim();
      const display = match[2]?.trim() ?? label;
      const line = doc.lineBase + countLines(doc.body.slice(0, match.index!)) + 1;
      const candidates = byTitle.get(normalizeSurface(label.replace(/#.*$/, ''))) ?? [];

      const anchor = label.includes('#') ? label.split('#').slice(1).join('#') : undefined;
      if (anchor?.startsWith('^')) { (manual as any[]).push({ file, line, url: match[0], why: 'block references need a portable heading' }); continue; }
      if (candidates.length === 1) {
        splices.push({ file, span: { start: offset + match.index!, end: offset + match.index! + match[0].length }, replacement: `[${display}](${portableLink(file, candidates[0]!, { anchor })})`, reason: 'resolved wikilink' });
        edits.push({
          file,
          line,
          before: match[0],
          after: `[${display}](${portableLink(file, candidates[0]!, { anchor })})`,
          reason: 'wikilink resolved to a single document',
        });
      } else {
        (manual as MigrationPlan['manual'][number][]).push({
          file,
          line,
          url: match[0],
          why:
            candidates.length === 0
              ? 'wikilink target not found in the bundle'
              : `wikilink matches ${candidates.length} documents: ${candidates.join(', ')}`,
        });
      }
    }
  }

  return {
    kind,
    edits,
    manual,
    filesTouched: new Set(edits.map((e) => e.file)).size,
    proposal: proposeFiles(config, bundle, applyFileEdits(bundle.snapshot, splices), 'portable-links migration'),
  };
}

export async function applyMigration(config: OkbConfig, plan: MigrationPlan): Promise<Receipt> {
  await saveProposal(config, plan.proposal);
  return applyProposal(config, plan.proposal);
}
export async function rollbackMigration(config: OkbConfig, id: string): Promise<string[]> {
  return (await rollback(config, id)).map(r => r.path);
}

function indexByTitle(bundle: Bundle): Map<string, BundlePath[]> {
  const out = new Map<string, BundlePath[]>();
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    const keys = new Set([
      normalizeSurface(entry.title),
      normalizeSurface(posix.basename(entry.path, '.md')),
      ...(entry.ext.aliases ?? []).map(normalizeSurface),
    ]);
    for (const key of keys) {
      if (key.length < 2) continue;
      out.set(key, [...new Set([...(out.get(key) ?? []), entry.path])]);
    }
  }
  return out;
}

function safeBody(file: BundlePath, text: string): { body: string; lineBase: number } {
  try {
    const doc = parseOkf(file, text);
    return { body: doc.body, lineBase: countLines(text.slice(0, doc.bodyOffset)) };
  } catch {
    return { body: text, lineBase: 0 };
  }
}

function countLines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}
