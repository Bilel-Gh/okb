import type { OkbConfig } from '../config/schema.js';
import { invokedBy } from '../usage/events.js';
import { OkbError } from '../util/errors.js';
import { loadQueue, setStatus, type Suggestion } from './suggest.js';

/**
 * The technical side of « rien n'est écrit sans ton oui »: in a brain, when
 * Claude prepares a note (create, a dated section, a rewrite), the command
 * must name a suggestion the person accepted that covers this note — its exact
 * place, the note it completes, or the folder of a pack (a repository's pages).
 * Typed by the person in a terminal, the command is their own act and passes.
 */
export async function requireAccepted(config: OkbConfig, path: string, suggestionId: string | undefined, agent?: boolean): Promise<Suggestion | null> {
  if (!config.kb.brain) return null;
  const byClaude = agent ?? invokedBy() === 'claude';
  const queue = await loadQueue(config);
  const s = suggestionId ? queue.find((x) => x.id.toLowerCase() === suggestionId.toLowerCase()) : undefined;
  if (!byClaude) return s ?? null;
  if (!s) {
    throw new OkbError('E_NOT_APPROVED', `no accepted suggestion for ${path}`, {
      key: 'suggestRequired', params: { path },
      hint: 'Show a suggestion card first (okb suggest add …), wait for the person’s yes, then okb suggest accept <id> and pass --suggestion <id>.',
    });
  }
  const fresh = s.decidedAt && Date.now() - Date.parse(s.decidedAt) < 24 * 3_600_000;
  if (!(s.status === 'accepted' || (s.status === 'done' && fresh))) {
    throw new OkbError('E_NOT_APPROVED', `${s.id} is ${s.status}, not accepted`, { key: 'suggestNotAccepted', params: { id: s.id, status: s.status } });
  }
  const covers = s.path === path || s.target === path || (s.scope !== null && path.startsWith(`${s.scope.replace(/\/+$/, '')}/`));
  if (!covers) {
    throw new OkbError('E_NOT_APPROVED', `${s.id} was accepted for ${s.target ?? s.path ?? s.scope}, not ${path}`, { key: 'suggestOtherPlace', params: { id: s.id, path } });
  }
  return s;
}

/** After the proposal exists: the suggestion knows it (a pack stays open for its other notes). */
export async function linkProposal(config: OkbConfig, s: Suggestion | null, proposalId: string): Promise<void> {
  if (!s) return;
  await setStatus(config, s.id, s.scope ? 'accepted' : 'done', undefined, proposalId);
}
