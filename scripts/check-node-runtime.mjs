/** Exercise exactly the SQLite API used by the engine in temporary state. */
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { configSchema } from '../dist/config/schema.js';
import { closeDbs, copyDb, inspectDb, openDb, readMeta } from '../dist/state/db.js';
const scratch = await mkdtemp(resolve(tmpdir(), 'okb-node-runtime-'));
try {
  const config = configSchema.parse({ profile: { id: 'runtime-fixture' }, kb: { root: resolve(scratch, 'vault') }, stateHome: resolve(scratch, 'state') });
  const db = openDb(config);
  db.run('INSERT INTO meta(key,value) VALUES (?,?)', 'runtime-test', 'present');
  assert.equal(readMeta(config, 'runtime-test'), 'present');
  assert.throws(() => db.tx(() => { db.run('UPDATE meta SET value = ? WHERE key = ?', 'rolled-back', 'runtime-test'); throw new Error('fixture rollback'); }));
  assert.equal(db.get('SELECT value FROM meta WHERE key = ?', 'runtime-test').value, 'present');
  assert.equal(db.all('SELECT key FROM meta WHERE key = ?', 'runtime-test').length, 1);
  const backup = resolve(scratch, 'copy.db'); assert.equal(copyDb(config, backup), true); assert.equal(inspectDb(backup).sound, true);
  const result = { node: process.versions.node, electron: process.versions.electron ?? null, sqlite: process.versions.sqlite ?? null, platform: process.platform, arch: process.arch, tested: ['migrations', 'prepare/run/get/all', 'transaction rollback', 'WAL/busy_timeout/foreign_keys', 'VACUUM INTO', 'readOnly/integrity_check'], personalProfileUsed: false };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { closeDbs(); await rm(scratch, { recursive: true, force: true }); }
