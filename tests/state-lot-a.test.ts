import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDbs, dbFile, MIGRATIONS, openDb } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const columns = (config: Parameters<typeof openDb>[0], table: string) => openDb(config).all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

describe('lot A state (F2.4-08..14)', () => {
  it('adds the lot A tables and action columns', async () => {
    const { config } = await workKb();
    expect(columns(config, 'ticket_fields')).toEqual(['ref', 'field', 'value', 'origin', 'url', 'at', 'manual', 'na_reason']);
    expect(columns(config, 'ticket_field_conflicts')).toEqual(['ref', 'field', 'value', 'origin', 'url', 'at']);
    expect(columns(config, 'ticket_links')).toEqual(['ref', 'path', 'note_id', 'state', 'origin', 'at']);
    expect(columns(config, 'ticket_requests')).toEqual(['id', 'ref', 'fields', 'state', 'created_at', 'closed_at', 'report']);
    expect(columns(config, 'ticket_flags')).toEqual(['ref', 'pinned', 'unfollowed_at', 'snapshot']);
    expect(columns(config, 'actions')).toEqual(expect.arrayContaining(['ticket_ref', 'importance', 'pinned']));
  });

  it('copies the database before migrating an existing file', async () => {
    const { config } = await workKb();
    mkdirSync(statePaths(config).root, { recursive: true });
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const raw = new DatabaseSync(dbFile(config));
    for (const m of MIGRATIONS.slice(0, 7)) raw.exec(m);
    raw.exec('PRAGMA user_version = 7');
    raw.close();
    openDb(config);
    const copies = readdirSync(statePaths(config).backups).filter((f) => /^state-v7-.+\.db$/.test(f));
    expect(copies).toHaveLength(1);
  });

  it('makes no copy for a new file', async () => {
    const { config } = await workKb();
    openDb(config);
    const dir = statePaths(config).backups;
    expect(existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('state-v')) : []).toEqual([]);
  });
});
