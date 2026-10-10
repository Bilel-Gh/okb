import type { OkbConfig } from '../config/schema.js';
import { findSecrets } from '../security/secrets.js';
import { estimateTokens } from '../util/context-meter.js';
import { OkbError } from '../util/errors.js';
import { complete, type AiRequest, type AiResult } from './provider.js';
import { recordAiUsage } from './usage.js';

/**
 * The one way out to a model. Every call OKB makes itself (translate, ask,
 * exam) goes through here, so the same rules hold everywhere (F2.0-23):
 * 1. the exact message is checked as a whole: a secret anywhere (instructions,
 *    titles, glossary, question) and nothing leaves;
 * 2. a 🔒 note leaves only with the person's yes for that note and that content;
 * 3. the day's budget is checked before the call;
 * 4. what the call used is counted, even when its answer is unusable.
 * Callers keep their own `oneAtATime` queue: this function never waits on it.
 */
export type Purpose = 'translate' | 'ask' | 'exam';
/** A note whose text, title or terms the message carries; `hash` is the content the person saw. */
export type OutgoingNote = { readonly path: string; readonly secret: boolean; readonly hash?: string };
/** The person's yes to send one 🔒 note, for the content they saw. */
export type Consent = { readonly path: string; readonly hash: string };
export type Outgoing = AiRequest & {
  readonly purpose: Purpose;
  readonly notes?: readonly OutgoingNote[];
  readonly consent?: readonly Consent[];
  /** Tokens to check against the day's budget; by default the message plus a short answer. */
  readonly cost?: number;
};

export async function sendToAi(config: OkbConfig, out: Outgoing, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<AiResult> {
  const secrets = findSecrets(`${out.system}\n${out.prompt}`);
  if (secrets.length) throw new OkbError('E_SECRET', 'the message to the AI holds a secret: nothing was sent', { key: 'aiPayloadSecret', params: { kind: secrets[0]!.kind } });
  for (const n of out.notes ?? []) {
    if (!n.secret) continue;
    const yes = (out.consent ?? []).some((c) => c.path === n.path && (n.hash === undefined || c.hash === n.hash));
    if (!yes) throw new OkbError('E_SECRET', 'a 🔒 note leaves the computer only when the person confirms it', { key: 'aiSecretNote', params: { path: n.path } });
  }
  const cost = out.cost ?? estimateTokens(out.system + out.prompt) + Math.min(out.maxTokens, 400);
  const { dailyBudget, spentToday } = await import('../suggest/suggest.js');
  const [spent, budget] = await Promise.all([spentToday(config, now), dailyBudget(env)]);
  if (spent + cost > budget) throw new OkbError('E_INVALID', `daily budget reached (${spent} + ${cost} > ${budget} tokens)`, { key: 'budgetExceeded', params: { spent, cost, budget } });
  try {
    const r = await complete({ system: out.system, prompt: out.prompt, size: out.size, maxTokens: out.maxTokens }, env);
    await recordAiUsage(config, { tokens: r.tokens.input + r.tokens.output, purpose: out.purpose, provider: r.provider }, now);
    return r;
  } catch (e) {
    // A call can fail after the model has worked (an answer cut by its limit): that work is counted too.
    const used = e instanceof OkbError ? (e.detail.usage as { tokens?: number; provider?: string } | undefined) : undefined;
    if (used?.tokens) await recordAiUsage(config, { tokens: used.tokens, purpose: out.purpose, provider: used.provider ?? 'unknown' }, now);
    throw e;
  }
}
