/**
 * Every internal link the product emits goes through this module.
 *
 * House rule (stricter than OKF, which also allows bundle-absolute `/paths`):
 * internal links are **relative to the file that contains them** and keep the
 * `.md` extension. That form is the only one that resolves identically in
 * Obsidian, on GitHub and in a plain Markdown reader, whatever folder the reader
 * opened.
 */
import { posix } from 'node:path';
import { asBundlePath, type BundlePath } from '../util/paths.js';

export type LinkKind =
  | 'external' // http(s), mailto, tel… keeps its URL verbatim
  | 'internal' // a .md file inside the bundle
  | 'internal-asset' // a non-.md file inside the bundle (image, pdf…)
  | 'anchor' // same-document #fragment
  | 'forbidden';

export type ForbiddenReason =
  | 'bundle-absolute'
  | 'machine-absolute'
  | 'file-scheme'
  | 'obsidian-scheme'
  | 'wikilink'
  | 'block-reference'
  | 'missing-extension';

export type Classification = {
  readonly kind: LinkKind;
  readonly reason?: ForbiddenReason;
  /** Decoded bundle path for internal links. */
  readonly target?: BundlePath;
  readonly anchor?: string;
  readonly message?: string;
};

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function classifyLink(url: string, from: BundlePath | string): Classification {
  const raw = url.trim();

  if (raw === '') {
    return { kind: 'forbidden', reason: 'missing-extension', message: 'empty link target' };
  }
  if (raw.startsWith('#')) {
    return { kind: 'anchor', anchor: decodeSafe(raw.slice(1)) };
  }
  if (raw.startsWith('[[')) {
    return {
      kind: 'forbidden',
      reason: 'wikilink',
      message: 'Obsidian wikilinks do not render outside Obsidian',
    };
  }

  const lower = raw.toLowerCase();
  if (lower.startsWith('file://')) {
    return { kind: 'forbidden', reason: 'file-scheme', message: 'file:// links are machine-local' };
  }
  if (lower.startsWith('obsidian://')) {
    return {
      kind: 'forbidden',
      reason: 'obsidian-scheme',
      message: 'obsidian:// links require Obsidian',
    };
  }
  // `C:\...` would otherwise look like the scheme `c:`, so it is ruled out first.
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('\\\\')) {
    return {
      kind: 'forbidden',
      reason: 'machine-absolute',
      message: 'absolute filesystem path',
    };
  }
  if (EXTERNAL_SCHEME.test(raw) && !raw.startsWith('./') && !raw.startsWith('../')) {
    return { kind: 'external' };
  }
  if (raw.startsWith('//')) return { kind: 'external' };
  if (raw.startsWith('/')) {
    return {
      kind: 'forbidden',
      reason: 'bundle-absolute',
      message: 'bundle-absolute links break when the reader opens a parent folder',
    };
  }

  const [pathPart = '', ...rest] = raw.split('#');
  const anchor = rest.length > 0 ? decodeSafe(rest.join('#')) : undefined;

  if (anchor?.startsWith('^')) {
    return {
      kind: 'forbidden',
      reason: 'block-reference',
      message: 'Obsidian block references (#^id) do not render elsewhere',
    };
  }

  if (pathPart === '') {
    return anchor === undefined
      ? { kind: 'forbidden', reason: 'missing-extension', message: 'empty link target' }
      : { kind: 'anchor', anchor };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }

  const fromDir = posix.dirname(asBundlePath(from));
  const joined = posix.normalize(posix.join(fromDir === '.' ? '' : fromDir, decoded));
  if (joined.startsWith('..')) {
    return {
      kind: 'forbidden',
      reason: 'machine-absolute',
      message: 'relative link escapes the bundle',
    };
  }

  const target = joined as BundlePath;
  if (decoded.endsWith('/') || posix.extname(decoded) === '') {
    // A trailing-slash directory link is how index.md files are referenced in OKF §8.
    if (decoded.endsWith('/')) {
      return { kind: 'internal', target: posix.join(target, 'index.md') as BundlePath, anchor };
    }
    return {
      kind: 'forbidden',
      reason: 'missing-extension',
      message: 'internal links must carry an explicit extension',
      target,
      anchor,
    };
  }

  return {
    kind: posix.extname(decoded) === '.md' ? 'internal' : 'internal-asset',
    target,
    anchor,
  };
}

/** Percent-encode only what a Markdown link destination cannot carry literally. */
export function encodeLinkPath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/**
 * The single generator for internal links. Nothing else in the product builds a
 * link string by hand.
 */
export function portableLink(
  from: BundlePath | string,
  to: BundlePath | string,
  options: { anchor?: string; explicitDotSlash?: boolean } = {},
): string {
  const fromPath = asBundlePath(from);
  const toPath = asBundlePath(to);
  const fromDir = posix.dirname(fromPath);
  let rel = posix.relative(fromDir === '.' ? '' : fromDir, toPath);
  if (rel === '') rel = posix.basename(toPath);
  if (options.explicitDotSlash && !rel.startsWith('.')) rel = `./${rel}`;
  const encoded = encodeLinkPath(rel);
  return options.anchor ? `${encoded}#${encodeLinkPath(options.anchor)}` : encoded;
}

export function markdownLink(
  from: BundlePath | string,
  to: BundlePath | string,
  text: string,
  options: { anchor?: string; explicitDotSlash?: boolean } = {},
): string {
  return `[${escapeLinkText(text)}](${portableLink(from, to, options)})`;
}

export function escapeLinkText(text: string): string {
  return text.replace(/([[\]])/g, '\\$1');
}

/** Resolve a link found in `from` to the bundle path it points at. */
export function resolveInternal(from: BundlePath | string, url: string): BundlePath | null {
  const c = classifyLink(url, from);
  return c.kind === 'internal' || c.kind === 'internal-asset' ? (c.target ?? null) : null;
}

function decodeSafe(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
