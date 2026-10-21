import type { OkbConfig } from '../config/schema.js';
import { newId } from '../projects/projects.js';
import { openDb } from '../state/db.js';
import { isMeaningful } from './ticket-fields.js';

const MARK = 'tickets.fields.v1';

/**
 * Move the 2.0 tickets to their sheet once (D70), inside one transaction, after
 * the database copy taken by the migration. Nothing is dropped: the 2.0 columns
 * stay readable. A title or goal that only repeats the reference, or a last
 * action that is only a commit message, stays undefined instead of pretending.
 * 2.0 kept no trace of a hand correction, so moved values are the agent's; if
 * the agent later replaces one, the old value stays in the ticket's journal.
 */
export async function migrateTicketFields(config: OkbConfig): Promise<{ tickets: number; todos: number }> {
  const db = openDb(config);
  if (db.get('SELECT value FROM meta WHERE key = ?', MARK)) return { tickets: 0, todos: 0 };
  return db.tx(() => {
    // Checked again under the write lock: another process may have just done it.
    if (db.get('SELECT value FROM meta WHERE key = ?', MARK)) return { tickets: 0, todos: 0 };
    let tickets = 0, todos = 0;
    const rows = db.all<{ ref: string; payload: string; goal: string | null; last_action: string | null; next_step: string | null }>(
      'SELECT t.ref, t.payload, d.goal, d.last_action, d.next_step FROM tickets t LEFT JOIN ticket_details d ON d.ref = t.ref ORDER BY t.ref');
    for (const r of rows) {
      const record = JSON.parse(r.payload) as { title?: string; startedAt?: string; journal?: { kind: string; text: string }[] };
      const at = new Date().toISOString();
      const put = (field: string, value: string) => db.run("INSERT OR IGNORE INTO ticket_fields (ref, field, value, origin, url, at, manual) VALUES (?, ?, ?, 'agent', NULL, ?, 0)", r.ref, field, value.trim(), at);
      const title = record.title?.trim() ?? '';
      if (isMeaningful(title, r.ref)) put('title', title.slice(0, 200));
      const goal = r.goal?.trim() ?? '';
      if (isMeaningful(goal, r.ref) && goal !== title) put(goal.length <= 600 ? 'summary' : 'description', goal);
      const last = r.last_action?.trim() ?? '';
      const commits = new Set((record.journal ?? []).filter((j) => j.kind === 'commit').map((j) => j.text.trim()));
      if (isMeaningful(last, r.ref) && !commits.has(last)) put('done', last.slice(0, 1000));
      const project = db.get<{ id: string; next_step: string }>("SELECT id, next_step FROM projects WHERE kind = 'ticket' AND ref = ?", r.ref);
      const steps = [r.next_step?.trim() ?? '', project?.next_step?.trim() ?? ''].filter((s, i, all) => s && all.indexOf(s) === i);
      steps.forEach((text, i) => {
        db.run("INSERT INTO actions (id, project_id, text, kind, status, source, created_at, ticket_ref, importance, pinned) VALUES (?, ?, ?, 'todo', 'open', 'ai', ?, ?, 'medium', ?)",
          newId('A'), project?.id ?? null, text, at, r.ref, i === 0 && r.next_step?.trim() ? 1 : 0);
        todos++;
      });
      if (project) db.run('UPDATE actions SET ticket_ref = ? WHERE project_id = ? AND ticket_ref IS NULL', r.ref, project.id);
      tickets++;
    }
    db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', MARK, new Date().toISOString());
    return { tickets, todos };
  });
}
