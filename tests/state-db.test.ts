import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeDbs, openDb } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { demoBrain } from './helpers/brain.js';
import { TEST_ROOT } from './helpers/sandbox.js';

describe('the operational state in SQLite (F2.0-18)', () => {
  it('lives in the profile’s state, outside the notes, and knows its version', async () => {
    const { config, kb } = await demoBrain();
    const db = openDb(config);
    const file = resolve(statePaths(config).root, 'okb.db');
    await access(file);
    expect(file.startsWith(kb)).toBe(false);
    expect(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version).toBeGreaterThan(0);
    expect(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name)).toEqual(expect.arrayContaining(['projects']));
    closeDbs();
  });

  it('opening twice gives the same connection, and a failed transaction writes nothing', async () => {
    const { config } = await demoBrain();
    const db = openDb(config);
    expect(openDb(config)).toBe(db);
    const count = () => db.get<{ n: number }>('SELECT count(*) AS n FROM projects')!.n;
    expect(() => db.tx(() => {
      db.run("INSERT INTO projects (id, kind, title, status, created_at, updated_at) VALUES ('p1', 'subject', 'A', 'active', 'now', 'now')");
      throw new Error('stop');
    })).toThrow('stop');
    expect(count()).toBe(0);
    closeDbs();
  });

  it('the terminal and the app write at the same time without losing a row or printing a warning', async () => {
    const { config, env } = await demoBrain();
    openDb(config);
    closeDbs();
    const script = `
      import { openDb } from ${JSON.stringify(resolve(TEST_ROOT, '..', 'dist', 'state', 'db.js'))};
      import { loadConfig } from ${JSON.stringify(resolve(TEST_ROOT, '..', 'dist', 'config', 'load.js'))};
      const { config } = await loadConfig({ profileId: 'travail' });
      const db = openDb(config);
      for (let i = 0; i < 40; i++) db.run("INSERT INTO projects (id, kind, title, status, created_at, updated_at) VALUES (?, 'subject', 'x', 'active', 'now', 'now')", process.argv.at(-1) + '-' + i);
    `;
    const run = (tag: string) => new Promise<string>((done, fail) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, tag], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (c) => { err += String(c); });
      child.on('error', fail);
      child.on('close', () => done(err));
    });
    const errors = await Promise.all([run('a'), run('b'), run('c')]);
    expect(errors.join('')).toBe('');
    expect(openDb(config).get<{ n: number }>('SELECT count(*) AS n FROM projects')!.n).toBe(120);
    closeDbs();
  });
});
