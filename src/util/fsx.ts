import { mkdir, readFile, rename, rm, stat, readdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { OkbError } from './errors.js';

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    throw new OkbError('E_IO', `cannot read ${path}`, { cause, detail: { path } });
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new OkbError('E_IO', `cannot read ${path}`, { cause: error });
  }
}

/** Write through a temp file + rename so a crash never leaves a half-written note. */
export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.okb-tmp-${randomUUID()}`;
  try {
    const mode = await stat(path).then(s => s.mode & 0o777).catch(() => 0o600);
    const handle = await open(tmp, 'wx', mode);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, path);
  } catch (cause) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new OkbError('E_IO', `cannot write ${path}`, { cause, detail: { path } });
  }
}

export async function readJson<T>(path: string): Promise<T> {
  const raw = await readText(path);
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new OkbError('E_INVALID', `malformed JSON in ${path}`, { cause, detail: { path } });
  }
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  const raw = await readTextIfExists(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new OkbError('E_INVALID', `malformed JSON in ${path}`, { cause, detail: { path } });
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendLine(path: string, line: string): Promise<void> {
  await ensureDir(dirname(path));
  const { appendFile } = await import('node:fs/promises');
  await appendFile(path, `${line}\n`, 'utf8');
}

export async function readLines(path: string): Promise<string[]> {
  const raw = await readTextIfExists(path);
  if (raw === null) return [];
  return raw.split('\n').filter((l) => l.trim().length > 0);
}

/** Depth-first walk returning paths relative to `root`, POSIX separators. */
export async function walkFiles(
  root: string,
  options: { skipDirs?: ReadonlySet<string> } = {},
): Promise<string[]> {
  const skip = options.skipDirs ?? new Set(['.git', 'node_modules', '.obsidian', '.okb-state']);
  const out: string[] = [];
  async function rec(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (cause) {
      throw new OkbError('E_IO', `cannot scan bundle directory ${dir}`, { cause });
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.isDirectory()) {
        // Hidden directories hold tooling (.git, .github, .obsidian, .okb, .trash), never notes.
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
        await rec(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        out.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  }
  await rec(root, '');
  return out;
}
