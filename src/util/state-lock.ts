import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OkbError } from './errors.js';

/**
 * One writer at a time for a state file that is read, changed and saved again
 * (a ticket's journal, the suggestion queue, the review cards, a profile's
 * settings). An atomic rename keeps a file whole; it does not stop two writers
 * from starting from the same old content and one losing the other's change
 * (F2.0-15). This lock serializes them:
 * - inside this process, calls on the same file wait in line;
 * - across processes (the CLI and the web app), a `<file>.lock` folder names
 *   its owner; the next writer waits a little, and takes over the lock of a
 *   process that died on this computer.
 * Readers do not take it: they always see a whole file.
 */
const lines = new Map<string, Promise<unknown>>();

export async function withStateLock<T>(file: string, fn: () => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
  const key = resolve(file);
  const before = lines.get(key) ?? Promise.resolve();
  const run = before.then(() => acrossProcesses(key, fn, options.waitMs ?? 5_000), () => acrossProcesses(key, fn, options.waitMs ?? 5_000));
  const tail = run.catch(() => undefined);
  lines.set(key, tail);
  try {
    return await run;
  } finally {
    if (lines.get(key) === tail) lines.delete(key);
  }
}

async function acrossProcesses<T>(file: string, fn: () => Promise<T>, waitMs: number): Promise<T> {
  const lock = `${file}.lock`;
  const nonce = randomUUID();
  const deadline = Date.now() + waitMs;
  await mkdir(dirname(file), { recursive: true });
  for (let delay = 10; ; delay = Math.min(delay * 2, 100)) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await ownerIsGone(lock)) {
        // Move the dead owner's lock aside before removing it: two writers cannot both take it over.
        const aside = `${lock}.stale-${nonce}`;
        try { await rename(lock, aside); await rm(aside, { recursive: true, force: true }); } catch { /* another writer took it over first */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new OkbError('E_CONFLICT', `another OKB process is writing ${file}`, { key: 'stateBusy', params: { file }, detail: { lock }, hint: 'Wait a moment and try again.' });
      }
      await new Promise((done) => setTimeout(done, delay));
    }
  }
  try {
    await writeFile(resolve(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), nonce }), { mode: 0o600 });
    return await fn();
  } finally {
    const owner = JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8').catch(() => '{}')) as { nonce?: string };
    if (owner.nonce === nonce) await rm(lock, { recursive: true, force: true });
  }
}

/** The lock's owner is a process of this computer that no longer runs. An owner still writing its name is alive. */
async function ownerIsGone(lock: string): Promise<boolean> {
  let owner: { pid?: unknown; host?: unknown } | null = null;
  try { owner = JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8')); } catch { return false; }
  if (owner?.host !== hostname() || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}
