import { applyProposal } from '../apply/apply.js';
import { grantApproval } from '../apply/approval.js';
import { guardApply } from '../apply/guard.js';
import type { OkbConfig } from '../config/schema.js';
import { listProposals, loadProposal } from '../proposal/store.js';
import { proposalTitle } from '../status/status.js';
import { dailyBudget, loadQueue, setStatus, spentToday } from '../suggest/suggest.js';
import { OkbError } from '../util/errors.js';

/**
 * The proportional yes (F2.0-13). What the person writes passes at once: a
 * capture, a line of the journal, an action, a document are their own gesture.
 * What an assistant drafted, replaces or proposes waits for their yes — and in
 * the evening it waits in one place, where they say « oui à tout, sauf… »:
 * one confirmation for the lot, and what they leave out stays as it was.
 */
export type Presence = 'confirmed' | 'refused' | 'unavailable';

export type Evening = {
  /** Notes an assistant proposed to write; accepting one spends tokens when it is written. */
  readonly cards: readonly { readonly id: string; readonly title: string; readonly type: string; readonly where: string; readonly why: string; readonly tokens: number }[];
  /** Changes ready to apply. */
  readonly changes: readonly { readonly id: string; readonly title: string; readonly files: number; readonly created: number; readonly updated: number }[];
  /** Changes OKB will not approve in a lot (a rule refuses them): to read one by one. */
  readonly apart: readonly { readonly id: string; readonly title: string; readonly reason: string }[];
  /** What writing every card would cost. */
  readonly tokens: number;
  readonly budget: { readonly daily: number; readonly spent: number };
};

export async function eveningView(config: OkbConfig, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<Evening> {
  const cards = (await loadQueue(config, now))
    .filter((s) => s.status === 'pending' && s.recommendation !== 'nothing' && s.recommendation !== 'link')
    .sort((a, b) => b.pertinence.total - a.pertinence.total)
    .map((s) => ({ id: s.id, title: s.title, type: s.type, where: s.breadcrumb, why: s.why, tokens: s.cost.tokens }));
  const changes: Evening['changes'][number][] = [];
  const apart: Evening['apart'][number][] = [];
  const prepared = (await listProposals(config)).filter((p) => p.profileId === config.profile.id && p.status === 'prepared').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of prepared) {
    const guard = await guardApply(config, p, p.changes);
    if (!guard.ok) { apart.push({ id: p.id, title: proposalTitle(p), reason: guard.violations[0]?.message ?? '' }); continue; }
    const paths = new Map(p.changes.map((c) => [c.path, c.kind]));
    const created = [...paths.values()].filter((k) => k === 'create-document').length;
    changes.push({ id: p.id, title: proposalTitle(p), files: paths.size, created, updated: paths.size - created });
  }
  return { cards, changes, apart, tokens: cards.reduce((n, c) => n + c.tokens, 0), budget: { daily: await dailyBudget(env), spent: await spentToday(config, now) } };
}

export type YesResult = {
  readonly presence: Presence | 'not-needed';
  readonly changes: readonly { readonly id: string; readonly ok: boolean; readonly error?: string; readonly key?: string }[];
  readonly cards: readonly { readonly id: string; readonly ok: boolean; readonly reason?: 'budget' | 'gone' }[];
};
export type Confirm = (lot: { readonly changes: number; readonly files: number; readonly titles: readonly string[] }) => Promise<Presence>;

/**
 * Say yes to a lot. The changes need the person: `confirm` asks them once, on
 * their screen, for all of them. A refusal changes nothing at all. When there
 * is no way to ask, the notes are still accepted (a click of theirs is enough
 * for a card) and the changes stay for the terminal. Each change is approved
 * and applied on its own, so one that no longer fits does not stop the others.
 */
export async function sayYes(config: OkbConfig, env: NodeJS.ProcessEnv, choice: { readonly changes: readonly string[]; readonly cards: readonly string[] }, confirm: Confirm): Promise<YesResult> {
  const proposals = [];
  for (const id of [...new Set(choice.changes)]) {
    const p = await loadProposal(config, id);
    if (p.status === 'prepared') proposals.push(p);
  }
  let presence: YesResult['presence'] = 'not-needed';
  if (proposals.length) {
    presence = await confirm({ changes: proposals.length, files: new Set(proposals.flatMap((p) => p.changes.map((c) => c.path))).size, titles: proposals.map(proposalTitle) });
    if (presence === 'refused') return { presence, changes: [], cards: [] };
  }
  const changes: YesResult['changes'][number][] = [];
  for (const p of proposals) {
    if (presence !== 'confirmed') { changes.push({ id: p.id, ok: false, key: 'presenceUnavailable' }); continue; }
    try {
      await grantApproval(config, p, p.changes.map((c) => c.id), config.profile.humanActor);
      await applyProposal(config, p, { env });
      changes.push({ id: p.id, ok: true });
    } catch (e) {
      changes.push({ id: p.id, ok: false, error: (e as Error).message, ...(e instanceof OkbError && e.key ? { key: e.key } : {}) });
    }
  }
  const cards: YesResult['cards'][number][] = [];
  const budget = await dailyBudget(env);
  for (const id of [...new Set(choice.cards)]) {
    const card = (await loadQueue(config)).find((s) => s.id === id);
    if (!card || (card.status !== 'pending' && card.status !== 'later')) { cards.push({ id, ok: false, reason: 'gone' }); continue; }
    // The day's budget holds for a lot as for one card: beyond it, the person is told, not overruled.
    if (budget > 0 && (await spentToday(config)) + card.cost.tokens > budget) { cards.push({ id, ok: false, reason: 'budget' }); continue; }
    await setStatus(config, id, 'accepted', 'person', undefined, env);
    cards.push({ id, ok: true });
  }
  return { presence, changes, cards };
}
