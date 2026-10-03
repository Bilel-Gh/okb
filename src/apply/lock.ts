import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../util/hash.js';
import { OkbError } from '../util/errors.js';

/** One local writer per physical KB, including writers using different profiles. */
export async function withBundleLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const physical = await realpath(root);
  const base = join(tmpdir(), `okb-locks-${process.getuid?.() ?? 'user'}`);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const path = join(base, sha256(physical));
  const nonce = randomUUID();
  for (let attempt = 0; ; attempt++) {
    try { await mkdir(path, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: { pid: number; host: string } | null = null;
      try { owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')); } catch { /* fail closed while owner is being written */ }
      let dead = false;
      if (owner?.host === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
      }
      if (!dead || attempt > 0) throw new OkbError('E_CONFLICT', 'another OKB writer holds this bundle lock', { detail: { lock: path, owner }, hint: 'Wait for the other process. If owner metadata is missing after a crash, inspect the lock directory before removing it.' });
      const recovery = `${path}.recover`;
      try { await mkdir(recovery, { mode: 0o700 }); }
      catch { throw new OkbError('E_CONFLICT', 'another process is recovering this bundle lock'); }
      try {
        const current = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
        if (current.pid !== owner?.pid || current.host !== owner?.host) throw new OkbError('E_CONFLICT', 'lock owner changed during recovery');
        try { process.kill(current.pid, 0); throw new OkbError('E_CONFLICT', 'lock owner is alive'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
        const stale = `${path}.stale-${nonce}`;
        await rename(path, stale);
        await rm(stale, { recursive: true });
      } finally { await rm(recovery, { recursive: true, force: true }); }
    }
  }
  try {
    await writeFile(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), nonce }), { mode: 0o600 });
    return await fn();
  } finally {
    const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8').catch(() => '{}'));
    if (owner.nonce === nonce) await rm(path, { recursive: true, force: true });
  }
}
