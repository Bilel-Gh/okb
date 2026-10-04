import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

/**
 * Read-only Git access for code repositories OKB documents. Nothing here
 * fetches, checks out, commits or changes a configuration: OKB looks at the
 * repository the way a new team member reads it, and leaves it as it was.
 */
const run = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

export async function git(root: string, args: readonly string[], options: { maxBuffer?: number; timeout?: number } = {}): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', '-C', root, ...args], {
    env: GIT_ENV, timeout: options.timeout ?? 30_000, maxBuffer: options.maxBuffer ?? 64_000_000,
  });
  return stdout;
}

async function attempt(root: string, args: readonly string[], options: { maxBuffer?: number; timeout?: number } = {}): Promise<string | null> {
  try { return await git(root, args, options); } catch { return null; }
}

/** The top of the working tree containing `dir`, or null outside Git. */
export async function gitRoot(dir: string): Promise<string | null> {
  const out = await attempt(dir, ['rev-parse', '--show-toplevel'], { timeout: 5000 });
  return out ? resolve(out.trim()) : null;
}

/** Remote URL without credentials, query or fragment: `https://user:token@host/x.git` → `https://host/x.git`. */
export function sanitizeRemote(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    // scp-like syntax (git@host:org/repo.git) carries no secret beyond the user name.
    return trimmed.replace(/^[^@\s/]+@/, '');
  }
}

export type GitIdentity = {
  readonly head: string | null;
  readonly branch: string | null;
  readonly remote: string | null;
  readonly headDate: string | null;
  readonly firstCommitDate: string | null;
  readonly commits: number | null;
  readonly dirty: boolean;
  readonly defaultBranch: string | null;
};

export async function gitIdentity(root: string): Promise<GitIdentity> {
  const [heads, remote, headDate, count, status, firstDate, originHead] = await Promise.all([
    attempt(root, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']),
    attempt(root, ['remote', 'get-url', 'origin']),
    attempt(root, ['log', '-1', '--format=%cI']),
    attempt(root, ['rev-list', '--count', 'HEAD']),
    attempt(root, ['status', '--porcelain', '--untracked-files=no']),
    attempt(root, ['log', '--reverse', '--format=%cI', '--max-parents=0']),
    attempt(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ]);
  const [head, branch] = (heads ?? '').split('\n').map((l) => l.trim());
  return {
    head: head || null,
    branch: branch && branch !== 'HEAD' ? branch : null,
    remote: remote?.trim() ? sanitizeRemote(remote) : null,
    headDate: headDate?.trim() || null,
    firstCommitDate: firstDate?.split('\n')[0]?.trim() || null,
    commits: count ? Number(count.trim()) || null : null,
    dirty: Boolean(status?.trim()),
    defaultBranch: originHead?.trim().replace(/^origin\//, '') || null,
  };
}

/** Tracked and untracked-but-not-ignored files, POSIX paths relative to the root. */
export async function listFiles(root: string): Promise<string[] | null> {
  const out = await attempt(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 256_000_000 });
  if (out === null) return null;
  return [...new Set(out.split('\0').filter(Boolean))].sort();
}

export type ChangeStats = {
  /** Commits that touched each file over the window. */
  readonly fileChanges: ReadonlyMap<string, number>;
  /** Author name → files they changed over the window (names only, never e-mails). */
  readonly authorFiles: ReadonlyMap<string, readonly string[]>;
  readonly commitsInWindow: number;
  readonly lastChange: ReadonlyMap<string, string>;
};

/** History over a window, bounded so a huge repository stays fast. */
export async function changeStats(root: string, since = '1.year', maxCommits = 4000): Promise<ChangeStats | null> {
  const out = await attempt(root, ['log', `--since=${since}`, `--max-count=${maxCommits}`, '--no-merges', '--format=@@%aN%x09%cI', '--name-only'], { timeout: 60_000 });
  if (out === null) return null;
  const fileChanges = new Map<string, number>();
  const authorFiles = new Map<string, string[]>();
  const lastChange = new Map<string, string>();
  let author = '';
  let date = '';
  let commits = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      [author = '', date = ''] = line.slice(2).split('\t');
      commits += 1;
      continue;
    }
    const file = line.trim();
    if (!file) continue;
    fileChanges.set(file, (fileChanges.get(file) ?? 0) + 1);
    if (!lastChange.has(file)) lastChange.set(file, date);
    if (author) {
      const list = authorFiles.get(author) ?? [];
      list.push(file);
      authorFiles.set(author, list);
    }
  }
  return { fileChanges, authorFiles, commitsInWindow: commits, lastChange };
}

export type FileChange = { readonly status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'; readonly path: string; readonly from?: string };

/** Files changed between two commits (`from` absent: the working tree against HEAD). */
export async function diffNames(root: string, from: string, to?: string): Promise<FileChange[] | null> {
  const out = await attempt(root, ['diff', '--name-status', '-M', '-z', from, ...(to ? [to] : [])]);
  if (out === null) return null;
  const parts = out.split('\0').filter(Boolean);
  const changes: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]![0] as FileChange['status'];
    if (code === 'R' || code === 'C') {
      changes.push({ status: code, from: parts[i + 1]!, path: parts[i + 2]! });
      i += 2;
    } else {
      changes.push({ status: code, path: parts[i + 1]! });
      i += 1;
    }
  }
  return changes;
}

export async function commitExists(root: string, sha: string): Promise<boolean> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  return (await attempt(root, ['cat-file', '-e', `${sha}^{commit}`])) !== null;
}

/** Where a branch started from the default line: the merge base with origin/main, main, master… */
export async function branchBase(root: string, preferred?: string): Promise<{ ref: string; sha: string } | null> {
  const candidates = [preferred, 'origin/HEAD', 'origin/main', 'origin/master', 'origin/develop', 'main', 'master', 'develop'].filter((c): c is string => Boolean(c));
  for (const ref of candidates) {
    const sha = await attempt(root, ['merge-base', 'HEAD', ref]);
    if (sha?.trim()) return { ref, sha: sha.trim() };
  }
  return null;
}

export type CommitInfo = { readonly sha: string; readonly date: string; readonly author: string; readonly subject: string; readonly body: string };

export async function commitsBetween(root: string, from: string, to = 'HEAD', max = 200): Promise<CommitInfo[]> {
  const out = await attempt(root, ['log', `--max-count=${max}`, '--format=%H%x1f%cI%x1f%aN%x1f%s%x1f%b%x1e', `${from}..${to}`]);
  if (!out) return [];
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha = '', date = '', author = '', subject = '', body = ''] = r.split('\x1f');
    return { sha, date, author, subject, body: body.trim() };
  });
}

/** Content of a file at a commit, or null when it did not exist there. */
export async function fileAt(root: string, sha: string, path: string): Promise<string | null> {
  return attempt(root, ['show', `${sha}:${path}`], { maxBuffer: 32_000_000 });
}
