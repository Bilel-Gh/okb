import { realpath, lstat } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { OkbError } from './errors.js';
import { exists } from './fsx.js';

/** Internal canonical form for bundle paths: POSIX, no leading slash, no `..`. */
export type BundlePath = string & { readonly __brand: 'BundlePath' };

export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export function asBundlePath(input: string): BundlePath {
  if (typeof input !== 'string' || !input || /[\\\u0000-\u001f]/.test(input) || input.startsWith('/') || /^[a-z]:/i.test(input)) {
    throw new OkbError('E_FORBIDDEN_PATH', 'bundle paths must be relative POSIX paths');
  }
  const normalized = posix.normalize(input);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new OkbError('E_FORBIDDEN_PATH', `path escapes the bundle: ${input}`, {
      detail: { input },
    });
  }
  return normalized as BundlePath;
}

export function bundlePathToAbsolute(root: string, p: BundlePath | string): string {
  return resolve(root, asBundlePath(p));
}

export function absoluteToBundlePath(root: string, abs: string): BundlePath {
  const rel = relative(resolve(root), resolve(abs));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new OkbError('E_FORBIDDEN_PATH', `path is outside the bundle: ${abs}`, {
      detail: { root, abs },
    });
  }
  return asBundlePath(rel);
}

/**
 * Resolve a write target and prove it stays inside the bundle *after* symlink
 * resolution. A symlink inside the bundle pointing out of it is the realistic
 * escape, so the check runs on the nearest existing ancestor too.
 */
export async function assertInsideRoot(root: string, target: string): Promise<string> {
  asBundlePath(target);
  const realRoot = await realpath(resolve(root)).catch(() => resolve(root));
  const absTarget = resolve(root, target);
  let component = resolve(root);
  for (const part of asBundlePath(target).split('/')) {
    component = resolve(component, part);
    const info = await lstat(component).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
    if (info?.isSymbolicLink()) throw new OkbError('E_FORBIDDEN_PATH', 'symlink targets below kb.root are not writable');
  }

  let probe = absTarget;
  // Walk up to the first path that exists; a not-yet-created file has no realpath.
  while (!(await lstat(probe).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  }))) {
    const parent = resolve(probe, '..');
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = await realpath(probe).catch((cause) => {
    throw new OkbError('E_FORBIDDEN_PATH', 'unresolvable target ancestor (possibly a dangling symlink)', { cause });
  });
  const tail = relative(probe, absTarget);
  const realTarget = resolve(realProbe, tail);

  const rel = relative(realRoot, realTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new OkbError('E_FORBIDDEN_PATH', `write target escapes the knowledge bundle`, {
      detail: { root: realRoot, target: realTarget },
      hint: 'Targets must resolve inside the configured kb.root, symlinks included.',
    });
  }
  return realTarget;
}

/** Identifiers are never filesystem paths. Validate before any resolve/read/write. */
export function assertId(value: string, label = 'id'): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new OkbError('E_INVALID', `invalid ${label}; use letters, digits, hyphens or underscores`);
  }
  return value;
}

/** Minimal glob: `*` (no `/`), `**` (any depth), `?`. Enough for path policies. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        out += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
