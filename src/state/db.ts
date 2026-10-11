import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from './paths.js';

/**
 * The operational state (F2.0-18): what gets ticked, dated or computed
 * (projects, actions, the journal, the documents' index, the reviews) lives in one SQLite file per profile, in the
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
  // 3: the reviews (each card's schedule and the log of answers), and what was imported from a 1.5 state.
  `CREATE TABLE reviews (card_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE review_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, card_id TEXT NOT NULL, rating INTEGER NOT NULL, was TEXT NOT NULL, next TEXT NOT NULL);
   CREATE INDEX review_log_at ON review_log(at);
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
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

/**
 * A whole copy of the state database, taken while it is in use (`VACUUM INTO`):
 * one file with everything committed, never the three files of a database
 * someone is writing. False when the profile has no database yet.
 */
export function copyDb(config: OkbConfig, target: string): boolean {
  if (!existsSync(dbFile(config))) return false;
  openDb(config);
  open.get(dbFile(config))!.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return true;
}

/** What a copy of the database holds, read without changing it; `sound` is SQLite's own check of the file. */
export function inspectDb(file: string): { sound: boolean; documents: number; projects: number; actions: number; entries: number; reviews: number } {
  const { DatabaseSync: Database } = loadSqlite();
  const raw = new Database(file, { readOnly: true });
  try {
    const count = (table: string) => { try { return (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n; } catch { return 0; } };
    const sound = (raw.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined)?.integrity_check === 'ok';
    return { sound, documents: count('documents'), projects: count('projects'), actions: count('actions'), entries: count('journal'), reviews: count('reviews') };
  } finally {
    raw.close();
  }
}

/** A value of the `meta` table, read without creating or changing the database; null when there is none. */
export function readMeta(config: OkbConfig, key: string): string | null {
  if (!existsSync(dbFile(config))) return null;
  const { DatabaseSync: Database } = loadSqlite();
  const raw = open.get(dbFile(config))?.raw ?? new Database(dbFile(config), { readOnly: true });
  try {
    return (raw.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  } catch {
    return null;
  } finally {
    if (!open.has(dbFile(config))) raw.close();
  }
}

/** How many cards were studied and how many answers were given, as the database holds them. */
export function reviewCounts(config: OkbConfig): { cards: number; answers: number } {
  const db = openDb(config);
  return { cards: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reviews')!.n, answers: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_log')!.n };
}

/** Close every open file (tests, and before a backup copies the file). */
export function closeDbs(): void {
  for (const { raw } of open.values()) raw.close();
  open.clear();
}
