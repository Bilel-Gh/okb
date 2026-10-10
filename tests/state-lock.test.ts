import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addJournal, loadTicket, ticketsDir, type TicketRecord } from '../src/work/tickets.js';
import { addSuggestion, contextFor, loadQueue } from '../src/suggest/suggest.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeSetting } from '../src/settings/settings.js';
import { loadConfig } from '../src/config/load.js';
import { withStateLock } from '../src/util/state-lock.js';
import { demoBrain } from './helpers/brain.js';

async function ticket(config: Parameters<typeof ticketsDir>[0]) {
  const now = new Date().toISOString();
  const record: TicketRecord = { version: 1, ref: 'ABC-1', title: 'Export', repos: [], status: 'active', startedAt: now, updatedAt: now, doneAt: null, auto: false, textFile: null, journal: [{ at: now, kind: 'start', text: '' }] };
  await mkdir(ticketsDir(config), { recursive: true });
  await writeFile(resolve(ticketsDir(config), 'ABC-1.json'), JSON.stringify(record));
}

/** A process that runs for a while, then exits: a live owner, then a dead one. */
function sleeper(ms: number) {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);
  return { pid: child.pid!, done: new Promise<void>((ok) => child.on('exit', () => ok())) };
}

describe('writes that read, change and save a state file', () => {
  it('ten notes added at once to a ticket’s journal are all kept', async () => {
    const { config } = await demoBrain();
    await ticket(config);
    await Promise.all(Array.from({ length: 10 }, (_, i) => addJournal(config, 'ABC-1', { kind: 'note', text: `note ${i}` })));
    const record = await loadTicket(config, 'ABC-1');
    expect(record!.journal.filter((e) => e.kind === 'note').map((e) => e.text).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `note ${i}`).sort());
  }, 60_000);

  it('cards suggested at once all reach the queue', async () => {
    const { config } = await demoBrain();
    const ctx = await contextFor(config, await loadBundleFor(config));
    await Promise.all(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((title) => addSuggestion(config, { type: 'concept', title, why: 'test' }, ctx)));
    expect((await loadQueue(config)).map((s) => s.title).sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
  }, 60_000);

  it('two settings written at once are both kept', async () => {
    const { env } = await demoBrain();
    await Promise.all([writeSetting('travail', 'reader.level', 'beginner', env), writeSetting('travail', 'writing.preset', 'expert', env)]);
    const { config } = await loadConfig({ env, profileId: 'travail' });
    expect(config.reader.level).toBe('beginner');
    expect(config.writing.preset).toBe('expert');
  }, 60_000);
});

describe('the state lock', () => {
  it('waits while another process holds the file, then goes', async () => {
    const { dir } = await demoBrain();
    const file = resolve(dir, 'state.json');
    const owner = sleeper(5_000);
    await mkdir(`${file}.lock`);
    await writeFile(resolve(`${file}.lock`, 'owner.json'), JSON.stringify({ pid: owner.pid, host: hostname(), at: new Date().toISOString() }));
    const released = new Promise<void>((ok) => setTimeout(() => { void rm(`${file}.lock`, { recursive: true, force: true }).then(() => ok()); }, 300));
    const started = Date.now();
    const order: string[] = [];
    await withStateLock(file, async () => { order.push('ran'); });
    await released;
    expect(order).toEqual(['ran']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  }, 30_000);

  it('takes over the lock of a process that died', async () => {
    const { dir } = await demoBrain();
    const file = resolve(dir, 'state.json');
    const gone = sleeper(10);
    await gone.done;
    await mkdir(`${file}.lock`);
    await writeFile(resolve(`${file}.lock`, 'owner.json'), JSON.stringify({ pid: gone.pid, host: hostname(), at: new Date().toISOString() }));
    let ran = false;
    await withStateLock(file, async () => { ran = true; });
    expect(ran).toBe(true);
    await expect(readFile(resolve(`${file}.lock`, 'owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('gives up with a clear error when the owner never lets go', async () => {
    const { dir } = await demoBrain();
    const file = resolve(dir, 'state.json');
    const owner = sleeper(5_000);
    await mkdir(`${file}.lock`);
    await writeFile(resolve(`${file}.lock`, 'owner.json'), JSON.stringify({ pid: owner.pid, host: hostname(), at: new Date().toISOString() }));
    await expect(withStateLock(file, async () => undefined, { waitMs: 300 })).rejects.toMatchObject({ code: 'E_CONFLICT' });
  }, 30_000);
});
