import { complete } from '../ai/provider.js';
import { plain } from '../concepts/one-liner.js';
import { recordAiUsage } from '../ai/usage.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { isSecret } from '../security/confidential.js';
import { findSecrets } from '../security/secrets.js';
import { dailyBudget, spentToday } from '../suggest/suggest.js';
import { estimateTokens } from '../util/context-meter.js';
import { OkbError } from '../util/errors.js';
import type { BundlePath } from '../util/paths.js';
import { findNotes } from './find.js';
import { roots, meaningQuery } from './meaning.js';

/**
 * « Ask your brain »: the passages of your notes that answer a question, found
 * by words and meaning, numbered as citations. On request only, the AI writes an
 * answer from those passages and nothing else, citing each claim [n]; a 🔒 note
 * and a passage holding a secret never leave the computer.
 */
export type Passage = { readonly n: number; readonly path: BundlePath | string; readonly title: string; readonly text: string; readonly line: number; readonly secret?: boolean };

/** Paragraphs of a note, with the line each starts at; headings, code and the breadcrumb left out. */
function paragraphs(body: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let buf: string[] = [];
  let start = 0;
  let fence = false;
  // Readable text: link targets, emphasis and inline code marks gone (src/concepts/one-liner.ts).
  const flush = () => { const text = plain(buf.join(' ')); if (text.length > 20) out.push({ text, line: start + 1 }); buf = []; };
  body.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('```')) { fence = !fence; flush(); return; }
    if (fence) return;
    if (!line || line.startsWith('#') || line.startsWith('🧭') || line.startsWith('|')) { flush(); return; }
    if (!buf.length) start = i;
    buf.push(line.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^>\s?/, ''));
  });
  flush();
  return out;
}

/** `scope`: only these notes (a repository's own, for its exam). */
export function passagesFor(config: OkbConfig, bundle: Bundle, question: string, options: { notes?: number; perNote?: number; scope?: ReadonlySet<string> } = {}): { passages: Passage[]; notes: { path: string; title: string }[] } {
  const scope = options.scope;
  const hits = scope
    ? findNotes(config, bundle, question, { limit: 500 }).hits.filter((h) => scope.has(h.path)).slice(0, options.notes ?? 5)
    : findNotes(config, bundle, question, { limit: options.notes ?? 5 }).hits;
  const wanted = new Set(meaningQuery(question));
  const found: (Omit<Passage, 'n'> & { score: number })[] = [];
  hits.forEach((h, rank) => {
    const doc = bundle.docs.get(h.path);
    if (!doc) return;
    const secret = isSecret(bundle.byPath.get(h.path)?.ext);
    const titleRoots = new Set(roots(h.title));
    const ranked = paragraphs(doc.body)
      // Distinct notions of the question found in the paragraph (and its note's title), the note's rank as a tie-break.
      .map((p) => ({ ...p, score: new Set([...roots(p.text), ...titleRoots].filter((r) => wanted.has(r))).size - rank * 0.1 }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.perNote ?? 2);
    for (const p of ranked) found.push({ path: h.path, title: h.title, text: p.text.slice(0, 600), line: p.line, score: p.score, ...(secret ? { secret: true } : {}) });
  });
  const passages = found.sort((a, b) => b.score - a.score).slice(0, 8).map(({ score: _s, ...p }, i) => ({ n: i + 1, ...p }));
  return { passages, notes: hits.map((h) => ({ path: h.path, title: h.title })) };
}

export async function composeAnswer(config: OkbConfig, question: string, passages: readonly Passage[], env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<{ answer: string; tokens: number; used: number[] }> {
  // Only what may leave the computer: no 🔒 note, no passage that looks like it holds a secret.
  const sendable = passages.filter((p) => !p.secret && !findSecrets(p.text).length);
  if (!sendable.length) throw new OkbError('E_INVALID', 'no passage can be sent to the AI', { key: 'askNothingToSend' });
  const lang = (config.writing.language ?? config.profile.answer.language ?? 'en').startsWith('fr') ? 'French' : 'English';
  const system = [
    `You answer a question in ${lang} using only the numbered excerpts of the person's notes below.`,
    'After each sentence, cite the excerpt it comes from as [n]. If the excerpts do not answer, say so in one sentence and cite nothing.',
    'Be short and plain: three to six sentences, no preamble.',
  ].join('\n');
  const prompt = `Question: ${question}\n\n${sendable.map((p) => `[${p.n}] ${p.title}\n${p.text}`).join('\n\n')}`;
  const cost = estimateTokens(system + prompt) + 400;
  const [spent, budget] = await Promise.all([spentToday(config, now), dailyBudget(env)]);
  if (spent + cost > budget) throw new OkbError('E_INVALID', `daily budget reached (${spent} + ${cost} > ${budget} tokens)`, { key: 'budgetExceeded', params: { spent, cost, budget } });
  const r = await complete({ system, prompt, size: 'small', maxTokens: 700 }, env);
  const tokens = r.tokens.input + r.tokens.output;
  await recordAiUsage(config, { tokens, purpose: 'ask', provider: r.provider }, now);
  const used = [...new Set([...r.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => sendable.some((p) => p.n === n)))];
  return { answer: r.text.trim(), tokens, used };
}
