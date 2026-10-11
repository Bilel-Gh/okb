import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from './paths.js';

/**
 * The operational state (F2.0-18): what gets ticked, dated or computed
 * (projects, actions, the journal) lives in one SQLite file per profile, in the
 * profile's state folder: outside the notes and outside any synced folder.
 * Knowledge stays in Markdown, readable without OKB.
 *
 * SQLite is Node's own (`node:sqlite`): no dependency to install or compile.
 * The file is opened in WAL mode with a busy timeout, so the terminal and the
 * app write at the same time without losing a row.
 */
export type Db = {
  run(sql: string, ...params: SQLInputValue[]): void;
  all<T>(sql: string, ...params: SQLInputValue[]): T[];
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined;
  /** All or nothing: an exception rolls every write of `fn` back. */
  tx<T>(fn: () => T): T;
};

/** Each entry upgrades the file by one version; never edit one that shipped, add the next. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     module TEXT NOT NULL DEFAULT 'core',
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     status TEXT NOT NULL,
     where_line TEXT NOT NULL DEFAULT '',
     next_step TEXT NOT NULL DEFAULT '',
     ref TEXT,
     folder TEXT,
     space TEXT NOT NULL DEFAULT 'work',
     left_off TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX projects_ref ON projects(kind, ref) WHERE ref IS NOT NULL;
   CREATE TABLE actions (
     id TEXT PRIMARY KEY,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
     text TEXT NOT NULL,
     kind TEXT NOT NULL,
     who TEXT,
     due TEXT,
     status TEXT NOT NULL DEFAULT 'open',
     source TEXT NOT NULL DEFAULT 'person',
     created_at TEXT NOT NULL,
     done_at TEXT
   );
   CREATE INDEX actions_open ON actions(status, due);
   CREATE TABLE journal (
     id TEXT PRIMARY KEY,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
     at TEXT NOT NULL,
     day TEXT NOT NULL,
     kind TEXT NOT NULL,
     text TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'person'
   );
   CREATE INDEX journal_day ON journal(day);
   CREATE INDEX journal_project ON journal(project_id, at);`,
  // 2: the documents, files kept as they are, with their text for the search.
  `CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     path TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL,
     mime TEXT NOT NULL DEFAULT '',
     size INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
     note_path TEXT,
     secret INTEGER NOT NULL DEFAULT 0,
     text_read INTEGER NOT NULL DEFAULT 0,
     limitations TEXT NOT NULL DEFAULT '',
     added_at TEXT NOT NULL
   );
   CREATE INDEX documents_sha ON documents(sha256);
   CREATE VIRTUAL TABLE documents_fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');`,
];

/** Node still calls its SQLite experimental; the warning has no place in a person's terminal. */
function loadSqlite(): typeof import('node:sqlite') {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (text.includes('SQLite is an experimental feature')) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
}

const open = new Map<string, { db: Db; raw: DatabaseSync }>();

function migrate(raw: DatabaseSync): void {
  raw.exec('BEGIN IMMEDIATE');
  try {
    const version = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = version; v < MIGRATIONS.length; v++) raw.exec(MIGRATIONS[v]!);
    if (version < MIGRATIONS.length) raw.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}

export function dbFile(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'okb.db');
}

export function openDb(config: OkbConfig): Db {
  const file = dbFile(config);
  const hit = open.get(file);
  if (hit) return hit.db;
  mkdirSync(statePaths(config).root, { recursive: true });
  const { DatabaseSync: Database } = loadSqlite();
  const raw = new Database(file);
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  migrate(raw);
  let depth = 0;
  const db: Db = {
    run: (sql, ...params) => { raw.prepare(sql).run(...params); },
    all: <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | undefined,
    tx: <T>(fn: () => T): T => {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    },
  };
  open.set(file, { db, raw });
  return db;
}

/** Close every open file (tests, and before a backup copies the file). */
export function closeDbs(): void {
  for (const { raw } of open.values()) raw.close();
  open.clear();
}
