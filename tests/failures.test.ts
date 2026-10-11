import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { closeDbs, dbFile, inspectDb, openDb } from '../src/state/db.js';
import { serve } from '../src/web/server.js';
import { OkbError } from '../src/util/errors.js';
import { demoBrain } from './helpers/brain.js';
import { TEST_ROOT } from './helpers/sandbox.js';
import { BIN } from './helpers/team.js';

afterEach(() => closeDbs());
const DIST = resolve(TEST_ROOT, '..', 'dist');

function cli(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, cwd, stdio: 'ignore' });
    child.on('error', fail);
    child.on('close', (code) => done(code ?? 0));
  });
}

describe('when things go wrong (F2.0-20)', () => {
  it('two windows on the same brain write at the same time: every line is kept', async () => {
    const { config, env, dir } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Sortie de juin' }, ctx);
    closeDbs();
    // Four terminals, six lines each, all at once.
    const codes = await Promise.all(Array.from({ length: 4 }, (_, w) => (async () => {
      for (let i = 0; i < 6; i++) if ((await cli(['journal', 'add', `fenêtre ${w} ligne ${i}`, '--project', project.id, '--json'], env, dir)) !== 0) return 1;
      return 0;
    })()));
    expect(codes).toEqual([0, 0, 0, 0]);
    const lines = (await invoke('journal.list', { project: project.id, limit: 100 }, ctx)).entries.filter((e) => e.text.startsWith('fenêtre'));
    expect(lines).toHaveLength(24);
    expect(new Set(lines.map((e) => e.text)).size).toBe(24);
  });

  it('a cut in the middle of a write leaves the database sound, with none of the half-written lines', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    await invoke('journal.add', { text: 'avant la coupure' }, ctx);
    closeDbs();
    // A process starts a big write and is killed before it ends.
    const script = `
      const { openDb } = await import(${JSON.stringify(`${DIST}/state/db.js`)});
      const { loadConfig } = await import(${JSON.stringify(`${DIST}/config/load.js`)});
      const { config } = await loadConfig({ env: process.env, profileId: 'travail' });
      const db = openDb(config);
      db.tx(() => {
        for (let i = 0; i < 2000; i++) db.run("INSERT INTO journal (id, at, day, kind, text) VALUES (?, ?, ?, 'note', ?)", 'J-cut' + i, new Date().toISOString(), '2027-03-01', 'à moitié écrit ' + i);
        process.stdout.write('writing\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      });`;
    await new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['ignore', 'pipe', 'inherit'] });
      child.on('error', fail);
      child.stdout.on('data', (chunk) => { if (String(chunk).includes('writing')) child.kill('SIGKILL'); });
      child.on('close', () => done());
    });
    expect(inspectDb(dbFile(config)).sound).toBe(true);
    const texts = (await invoke('journal.list', { limit: 50 }, ctx)).entries.map((e) => e.text);
    expect(texts).toContain('avant la coupure');
    expect(texts.filter((t) => t.startsWith('à moitié écrit'))).toEqual([]);
    // And the brain goes on.
    await invoke('journal.add', { text: 'après la coupure' }, ctx);
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) AS n FROM journal WHERE id LIKE ?', 'J-cut%')!.n).toBe(0);
  });

  it('a cut while a file was being kept: keeping it again does not make a second copy', async () => {
    const { config, env, kb } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    // The file reached the folder, the cut came before OKB noted it.
    const year = String(new Date().getFullYear());
    await mkdir(resolve(kb, '_Documents', year), { recursive: true });
    await writeFile(resolve(kb, '_Documents', year, 'devis.txt'), 'Le car coûte 480 euros.');
    const kept = await invoke('documents.add', { name: 'devis.txt', data: Buffer.from('Le car coûte 480 euros.').toString('base64') }, ctx);
    expect(kept.document.path).toBe(`_Documents/${year}/devis.txt`);
    expect(await readdir(resolve(kb, '_Documents', year))).toEqual(['devis.txt']);
    expect((await invoke('documents.list', { query: 'euros' }, ctx)).documents).toHaveLength(1);
  });

  it('the app started twice on the same port: the second says so; on two ports, both serve the same brain', async () => {
    const { config, env } = await demoBrain();
    const first = await serve(config, { port: 0, env });
    const port = Number(new URL(first.url).port);
    try {
      const again = await serve(config, { port, env }).then(() => null, (e: unknown) => e as OkbError);
      expect(again).toMatchObject({ code: 'E_CONFLICT', key: 'portInUse' });
      const second = await serve(config, { port: 0, env });
      try {
        const token = async (url: string) => ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
        const add = async (url: string, text: string) => (await fetch(`${url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': await token(url) }, body: JSON.stringify({ text }) })).status;
        expect(await Promise.all([add(first.url, 'depuis la première fenêtre'), add(second.url, 'depuis la seconde')])).toEqual([200, 200]);
        const seen = ((await (await fetch(`${first.url}/api/entries?limit=10`)).json()) as { entries: { text: string }[] }).entries.map((e) => e.text);
        expect(seen).toEqual(expect.arrayContaining(['depuis la première fenêtre', 'depuis la seconde']));
      } finally { second.server.closeAllConnections(); second.server.close(); }
    } finally { first.server.closeAllConnections(); first.server.close(); }
  });
});
