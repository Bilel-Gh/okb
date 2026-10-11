import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { SQLInputValue } from 'node:sqlite';
import type { OkbConfig } from '../config/schema.js';
import { openDb } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';
import { asBundlePath, assertInsideRoot } from '../util/paths.js';
import { withStateLock } from '../util/state-lock.js';
import { listTickets, ticketsDir, type TicketRecord } from './tickets.js';

// Explicit columns keep this a ticket transfer, never a copy of unrelated private state.
const TABLES = {
  ticket_details: ['ref', 'goal', 'last_action', 'next_step', 'external'],
  ticket_states: ['ref', 'dimension', 'environment', 'status', 'source', 'at', 'detail', 'url'],
  ticket_criteria: ['id', 'ref', 'kind', 'text', 'required', 'status', 'at'],
  ticket_attempts: ['id', 'ref', 'approach', 'conditions', 'result', 'next_step', 'at'],
  ticket_reuses: ['id', 'ref', 'path', 'title', 'sha256', 'why', 'at'],
} as const;
type Row = Record<string, SQLInputValue>;

/** After the note proposal was applied: transfer current tickets, retaining the source as-is. */
export async function transferTickets(source: OkbConfig, target: OkbConfig, repoId: string, noteBase: string): Promise<number> {
  if (resolve(source.stateHome) === resolve(target.stateHome)) throw new OkbError('E_INVALID', 'ticket state cannot be transferred into itself', { key: 'mergeSame' });
  const selected = (await listTickets(source)).filter((r) => r.repos.some((repo) => repo.id === repoId));
  await listTickets(target);
  const refs = new Set(selected.map((r) => r.ref));
  const from = openDb(source);
  const to = openDb(target);
  const transfer = async () => {
    const snapshot = from.tx(() => from.all<{ payload: string }>('SELECT payload FROM tickets ORDER BY ref').map(({ payload }) => JSON.parse(payload) as TicketRecord)
      .filter((r) => refs.has(r.ref)).map((record) => ({
        record: { ...record, textFile: record.textFile === null ? null : resolve(ticketsDir(target), `${record.ref}.md`) },
        sourceText: record.textFile,
        tables: Object.entries(TABLES).map(([table, columns]) => ({ table, columns,
          rows: from.all<Row>(`SELECT ${columns.join(', ')} FROM ${table} WHERE ref = ?`, record.ref).map((row) => table === 'ticket_reuses'
            ? { ...row, path: asBundlePath(`${asBundlePath(noteBase)}/${asBundlePath(String(row.path))}`) } : row),
        })),
      })));

    const conflict = (ref: string): never => { throw new OkbError('E_CONFLICT', `ticket ${ref} already has different state in the target KB; nothing was overwritten`, { key: 'ticketMergeConflict', params: { ref } }); };
    const check = () => {
      for (const { record, tables } of snapshot) {
        const existing = to.get<{ payload: string }>('SELECT payload FROM tickets WHERE ref = ?', record.ref);
        if (existing && !isDeepStrictEqual(JSON.parse(existing.payload), record)) conflict(record.ref);
        for (const { table, columns, rows } of tables) {
          if (!columns.some((c) => c === 'id')) continue;
          for (const row of rows) {
            const used = to.get<{ ref: string }>(`SELECT ref FROM ${table} WHERE id = ?`, row.id!);
            if (used && used.ref !== record.ref) conflict(record.ref);
          }
        }
      }
    };
    to.tx(check);
    // Preflight all text files before copying any. A failed retry may leave only identical/new private text.
    const texts: { file: string; content: string }[] = [];
    for (const { record, sourceText } of snapshot) {
      if (sourceText === null) continue;
      const expected = resolve(ticketsDir(source), `${record.ref}.md`);
      if (sourceText !== expected) conflict(record.ref);
      const src = await assertInsideRoot(ticketsDir(source), `${record.ref}.md`);
      const content = await readTextIfExists(src);
      if (content === null) continue;
      const file = await assertInsideRoot(ticketsDir(target), `${record.ref}.md`);
      const existing = await readTextIfExists(file);
      if (existing !== null && existing !== content) conflict(record.ref);
      if (existing === null) texts.push({ file, content });
    }
    for (const { file, content } of texts) await writeTextAtomic(file, content);
    return to.tx(() => {
      check();
      let count = 0;
      for (const { record, tables } of snapshot) {
        if (to.get('SELECT ref FROM tickets WHERE ref = ?', record.ref)) continue;
        to.run('INSERT INTO tickets (ref, payload, updated_at) VALUES (?, ?, ?)', record.ref, JSON.stringify(record), record.updatedAt);
        for (const { table, columns, rows } of tables) for (const row of rows) {
          to.run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, ...columns.map((c) => row[c]!));
        }
        count++;
      }
      return count;
    });
  };
  // Hold source and target writers' locks while taking the snapshot and transferring its text/state.
  const locks = selected.flatMap((r) => [source, target].map((c) => resolve(ticketsDir(c), `${r.ref}.json`))).sort();
  const locked = (index: number): Promise<number> => index === locks.length ? transfer()
    : withStateLock(locks[index]!, () => locked(index + 1));
  return locked(0);
}
