import { posix } from 'node:path';
import { extractLinks, headingSlugs, type Span } from '../markdown/ast.js';
import { parseOkf } from '../okf/document.js';
import type { BundlePath } from '../util/paths.js';
import { asBundlePath } from '../util/paths.js';
import { portableLink, classifyLink, type Classification } from './portable.js';

export type Renderer = 'standard' | 'github' | 'obsidian';

export const ALL_RENDERERS: readonly Renderer[] = ['standard', 'github', 'obsidian'];

export type BundleSnapshot = {
  /** bundle path -> file text. Only `.md` files need bodies; assets may map to ''. */
  readonly files: ReadonlyMap<BundlePath, string>;
};

export function snapshotFromEntries(
  entries: Iterable<readonly [string, string]>,
): BundleSnapshot {
  const files = new Map<BundlePath, string>();
  for (const [p, text] of entries) files.set(asBundlePath(p), text);
  return { files };
}

export type LinkIssueCode =
  | 'LINK_FORBIDDEN_FORM'
  | 'LINK_BROKEN_TARGET'
  | 'LINK_BROKEN_ANCHOR'
  | 'LINK_RENDERER_SPECIFIC';

export type LinkIssue = {
  readonly code: LinkIssueCode;
  readonly level: 'error' | 'warning';
  readonly file: BundlePath;
  readonly line: number;
  readonly url: string;
  readonly message: string;
  readonly renderers?: Renderer[];
  readonly span: Span;
};

export type LinkCheckOptions = {
  /** Which renderers must agree. Default: all three. */
  readonly renderers?: readonly Renderer[];
  /** A link to a not-yet-written concept is legal in OKF (§6.1) but reported. */
  readonly brokenTargetsAre?: 'error' | 'warning';
  /** Extra forms to tolerate, for migrating an existing bundle. */
  readonly allowBundleAbsolute?: boolean;
};

export type LinkCheckReport = {
  readonly issues: LinkIssue[];
  readonly scannedFiles: number;
  readonly scannedLinks: number;
  readonly byKind: Record<string, number>;
};

export function checkLinks(
  snapshot: BundleSnapshot,
  options: LinkCheckOptions = {},
): LinkCheckReport {
  const renderers = options.renderers ?? ALL_RENDERERS;
  const brokenLevel = options.brokenTargetsAre ?? 'warning';
  const issues: LinkIssue[] = [];
  const byKind: Record<string, number> = {};
  let scannedLinks = 0;
  let scannedFiles = 0;

  const anchorsOf = (p: BundlePath): ReadonlySet<string> => factsOf(p, snapshot.files.get(p) ?? '').anchors;

  for (const [file, text] of snapshot.files) {
    if (!file.endsWith('.md')) continue;
    scannedFiles += 1;
    const { links, lineBase } = factsOf(file, text);

    for (const link of links) {
      scannedLinks += 1;
      const c = classifyLink(link.url, file);
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
      const line = link.line + lineBase;

      if (c.kind === 'forbidden') {
        if (options.allowBundleAbsolute && c.reason === 'bundle-absolute') continue;
        issues.push({
          code: 'LINK_FORBIDDEN_FORM',
          level: 'error',
          file,
          line,
          url: link.url,
          message: c.message ?? `forbidden link form (${c.reason})`,
          span: link.span,
        });
        continue;
      }
      if (c.kind === 'external') continue;

      // Renderer agreement is checked first: a directory link that only GitHub
      // resolves must be reported even when the target itself is missing.
      const failing = renderers.filter((r) => !resolvesIn(r, link.url, c));
      if (failing.length > 0) {
        issues.push({
          code: 'LINK_RENDERER_SPECIFIC',
          level: 'error',
          file,
          line,
          url: link.url,
          message: `link does not resolve in: ${failing.join(', ')}`,
          renderers: failing,
          span: link.span,
        });
      }

      if (c.kind === 'anchor') {
        if (c.anchor && !anchorsOf(file).has(c.anchor)) {
          issues.push({
            code: 'LINK_BROKEN_ANCHOR',
            level: brokenLevel,
            file,
            line,
            url: link.url,
            message: `no heading in this document produces the anchor "#${c.anchor}"`,
            span: link.span,
          });
        }
        continue;
      }

      const target = c.target;
      if (!target) continue;
      if (!snapshot.files.has(target)) {
        issues.push({
          code: 'LINK_BROKEN_TARGET',
          level: brokenLevel,
          file,
          line,
          url: link.url,
          message: `target "${target}" does not exist in the bundle`,
          span: link.span,
        });
        continue;
      }
      if (c.anchor && target.endsWith('.md') && !anchorsOf(target).has(c.anchor)) {
        issues.push({
          code: 'LINK_BROKEN_ANCHOR',
          level: brokenLevel,
          file,
          line,
          url: link.url,
          message: `"${target}" has no heading producing "#${c.anchor}"`,
          span: link.span,
        });
      }
    }
  }

  return { issues, scannedFiles, scannedLinks, byKind };
}

/**
 * Renderer-specific resolution rules, kept explicit so "works on GitHub" never
 * silently means "works everywhere".
 */
function resolvesIn(renderer: Renderer, url: string, c: Classification): boolean {
  const isDirectoryLink = url.split('#')[0]!.endsWith('/');
  if (isDirectoryLink) {
    // Only GitHub turns `folder/` into a browsable listing.
    return renderer === 'github';
  }
  if (c.kind === 'internal' || c.kind === 'internal-asset' || c.kind === 'anchor') return true;
  return false;
}

/**
 * What a note's text says about links, read once per text (F2.0-22): its
 * links, the line its body starts on and the anchors its headings make. It
 * depends on the text alone, so a check after one note changed reads only
 * that note again. The issues themselves are always recomputed.
 */
type FileFacts = { readonly links: ReturnType<typeof extractLinks>; readonly lineBase: number; readonly anchors: ReadonlySet<string> };
const facts = new Map<string, FileFacts>();
const MAX_FACTS = 20_000;

function factsOf(path: BundlePath, text: string): FileFacts {
  const hit = facts.get(text);
  if (hit) return hit;
  const doc = safeParse(path, text);
  const body = doc?.body ?? text;
  const made = { links: extractLinks(body), lineBase: doc ? countLines(text.slice(0, doc.bodyOffset)) : 0, anchors: headingSlugs(body) };
  if (facts.size >= MAX_FACTS) facts.clear();
  facts.set(text, made);
  return made;
}

function safeParse(path: BundlePath, text: string) {
  try {
    return parseOkf(path, text);
  } catch {
    return null;
  }
}

function countLines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

export type FileEdit = {
  readonly file: BundlePath;
  readonly span: Span;
  readonly replacement: string;
  readonly reason: string;
};

export type MovePlan = {
  readonly from: BundlePath;
  readonly to: BundlePath;
  /** Rewrites of links *pointing at* the moved file, in other documents. */
  readonly inbound: FileEdit[];
  /** Rewrites of links *inside* the moved file, whose depth changed. */
  readonly outbound: FileEdit[];
};

/**
 * Compute every link rewrite a move implies. Inbound references are the ones a
 * naive `git mv` silently breaks, so they are first-class here.
 */
export function planMove(
  snapshot: BundleSnapshot,
  fromPath: string,
  toPath: string,
): MovePlan {
  const from = asBundlePath(fromPath);
  const to = asBundlePath(toPath);
  const inbound: FileEdit[] = [];
  const outbound: FileEdit[] = [];

  for (const [file, text] of snapshot.files) {
    if (!file.endsWith('.md')) continue;
    const doc = safeParse(file, text);
    const body = doc?.body ?? text;
    const base = doc?.bodyOffset ?? 0;

    for (const link of extractLinks(body)) {
      const c = classifyLink(link.url, file);
      if (c.kind !== 'internal' && c.kind !== 'internal-asset') continue;
      const span = { start: link.span.start + base, end: link.span.end + base };

      if (file === from) {
        // The moved file keeps pointing at the same targets, from a new depth.
        const retarget = c.target === from ? to : c.target!;
        const next = relink(to, retarget, c.anchor);
        if (next !== link.url) {
          outbound.push({
            file,
            span,
            replacement: rewriteUrl(text.slice(span.start, span.end), link.url, next),
            reason: `depth changed: ${from} -> ${to}`,
          });
        }
        continue;
      }

      if (c.target === from) {
        const next = relink(file, to, c.anchor);
        if (next !== link.url) {
          inbound.push({
            file,
            span,
            replacement: rewriteUrl(text.slice(span.start, span.end), link.url, next),
            reason: `target moved: ${from} -> ${to}`,
          });
        }
      }
    }
  }

  return { from, to, inbound, outbound };
}

function relink(from: BundlePath, to: BundlePath, anchor?: string): string { return portableLink(from, to, { anchor }); }

/** Swap only the destination inside a markdown link, leaving the text intact. */
export function rewriteUrl(rawLink: string, oldUrl: string, newUrl: string): string {
  // Locate the syntax's destination rather than replacing an occurrence in the
  // label or title. Positions come from the Markdown AST's link/definition node.
  let depth = 0, close = -1;
  for (let i = rawLink.indexOf('['); i >= 0 && i < rawLink.length; i++) {
    if (rawLink[i] === '\\') { i++; continue; }
    if (rawLink[i] === '[') depth++;
    if (rawLink[i] === ']' && --depth === 0) { close = i; break; }
  }
  if (close < 0 || !['(', ':'].includes(rawLink[close+1] ?? '')) return rawLink;
  let start = close + 2;
  while (/\s/.test(rawLink[start] ?? '') && start < rawLink.length) start++;
  if (rawLink[start] === '<') {
    const end = rawLink.indexOf('>', start+1);
    if (end < 0) return rawLink;
    return rawLink.slice(0,start+1) + newUrl + rawLink.slice(end);
  }
  let end = start; depth = 0;
  for (; end < rawLink.length; end++) {
    const ch = rawLink[end];
    if (ch === '\\') { end++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { if (depth === 0) break; depth--; }
    if (/\s/.test(ch!)) break;
  }
  return rawLink.slice(0,start) + newUrl + rawLink.slice(end);
}

export function applyFileEdits(
  snapshot: BundleSnapshot,
  edits: readonly FileEdit[],
): Map<BundlePath, string> {
  const byFile = new Map<BundlePath, FileEdit[]>();
  for (const e of edits) {
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }
  const out = new Map<BundlePath, string>();
  for (const [file, list] of byFile) {
    let text = snapshot.files.get(file) ?? '';
    for (const e of [...list].sort((a, b) => b.span.start - a.span.start)) {
      text = text.slice(0, e.span.start) + e.replacement + text.slice(e.span.end);
    }
    out.set(file, text);
  }
  return out;
}
