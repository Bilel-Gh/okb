import type { OkbConfig } from '../config/schema.js';
import { getAction, type Action } from '../projects/actions.js';
import { openDb } from '../state/db.js';
import { ticketId } from './tickets.js';

/**
 * The next step of a ticket is not a field of its own (F2.4-13, D70): it is its
 * first open todo — the pinned one, else the most important, then the oldest.
 * Today, the sheet and the session brief read it here, so they cannot disagree.
 */
export function nextStep(config: OkbConfig, ref: string): Action | null {
  const row = openDb(config).get<{ id: string }>(
    "SELECT id FROM actions WHERE ticket_ref = ? AND status = 'open' AND kind IN ('todo', 'asked') ORDER BY pinned DESC, CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at, rowid LIMIT 1",
    ticketId(ref),
  );
  return row ? getAction(config, row.id) : null;
}
