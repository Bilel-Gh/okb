import type { Signal } from './suggest.js';

/**
 * The moments of a conversation worth a note, spotted without AI (F2.0-09):
 * a long explanation the person asked for, the same question twice, a bug
 * solved after several tries, a decision, a command discovered, an error and
 * its cause. Spotting costs nothing and writes nothing: a moment only waits
 * for the end of the session, where the person says which ones to keep.
 */
export type MomentKind = 'explained' | 'repeat' | 'solved' | 'decision' | 'command' | 'error';

export type Moment = {
  readonly kind: MomentKind;
  /** The kind of note it would become. */
  readonly type: string;
  readonly signal: Signal;
  /** The title, when the words give it (a term asked about); null when the assistant has to name it. */
  readonly title: string | null;
  /** The person's words (or the command, the error line) that made the moment. */
  readonly hint: string;
};

export type MomentInput = {
  /** The person's last message. */
  readonly prompt: string;
  /** The assistant's answer to it. */
  readonly answer: string;
  /** The person's earlier messages in this session, oldest first. */
  readonly earlier: readonly string[];
  /** Commands that failed in this session. */
  readonly toolErrors: number;
};

/** A word boundary that knows accents (`\b` does not). */
const W = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');
const line = (text: string, max = 160) => (text.trim().split('\n')[0] ?? '').trim().slice(0, max);
const plain = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’`]/g, "'");

const ASKED = /(?:c['’]est quoi|qu['’]est[- ]ce (?:que|qu['’])|ça veut dire quoi|que (?:veut dire|signifie)|explique[- ]moi|what is|what are|what does|explain)\s+(?:un |une |le |la |les |l['’]|des |du |a |an |the )?([^?.!,\n]{2,60})/i;
const UNKNOWN = W("je (?:ne )?savais pas|j['’]ignorais|je (?:ne )?connaissais pas|didn['’]t know|never heard");
const SOLVED = W("(?:ça|ca|it|that) (?:re)?(?:marche|fonctionne|works?|worked)|résolu|réglé|corrigé|fixed|solved");
const FAILED = W("(?:marche|fonctionne) (?:toujours )?(?:pas|plus)|toujours pas|(?:encore|même|meme) (?:l['’]|la |cette )?erreur|same error|still (?:fail\\w*|broken|not|doesn['’]t)|doesn['’]t work|does not work|not working|non plus|plante|crash\\w*|échoue|fails?|failed");
const DECIDED = W("on part sur|on va partir sur|on garde|on choisit|je choisis|on prend|on retient|j['’]ai décidé|on a décidé|décision ?:|on va utiliser .{2,60} plutôt que|let['’]s go with|we['’]ll go with|we will go with|we['’]ll use .{2,60} instead of|i['’]ve decided|we decided|decision:");
const HOW = W("comment|quelle (?:est la )?commande|how (?:do|can|to)|what['’]?s the command|which command");
const ERROR_LINE = /^\s*(?:[\w.]*(?:Error|Exception)\b.*:|(?:error|fatal|panic)\b\s*[:[]|Traceback\b|.*\bE[A-Z]{4,}\b|.*\bexit code \d+)/;
const ERROR_WORD = W('error|erreur|exception|traceback|échec|failed');
const CAUSE = W("la cause|cause ?:|parce qu\\w*|because|vient d[eu]|due to|caused by|root cause|la raison|the reason|s['’]explique");
const CLOSING = W("[àa] demain|[àa] plus|[àa] lundi|bonne (?:soirée|nuit|journée)|fin de (?:la )?session|on s['’]arr[êe]te|j['’]arr[êe]te l[àa]|c['’]est (?:tout|bon) pour (?:aujourd['’]hui|ce soir|l['’]instant)|on termine|that['’]s all(?: for (?:today|now))?|done for (?:today|now)|see you|good ?night|bye|end of session");
const SHELL_BLOCK = /```(?:bash|sh|zsh|shell|console|powershell|ps1)\s*\n([\s\S]*?)```/i;

/** The term a question is about (« c'est quoi OData ? » → OData), or null. */
function termOf(prompt: string): string | null {
  const asked = ASKED.exec(prompt);
  if (!asked) return null;
  const term = asked[1]!
    .replace(/^(?:comment (?:marche(?:nt)?|fonctionne(?:nt)?)|how)\s+/i, '').replace(/^(?:un |une |le |la |les |l['’]|des |du |a |an |the )/i, '')
    .replace(/\s+(?:dans|in|pour|for|chez|sur|on)\s.*$/i, '').replace(/["«»“”`']/g, '').trim();
  if (!term || term.split(/\s+/).length > 6) return null;
  return term.charAt(0).toUpperCase() + term.slice(1);
}

/** The words that carry a question, cut to their first letters so « relance » meets « relancer ». */
function stems(text: string): Set<string> {
  return new Set(plain(text).split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
}
const isQuestion = (text: string) => text.includes('?') || HOW.test(text) || ASKED.test(text);

function sameQuestion(a: string, b: string): boolean {
  if (!isQuestion(a) || !isQuestion(b)) return false;
  const x = stems(a);
  const y = stems(b);
  if (x.size < 3 || y.size < 3) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.6;
}

/** One moment per kind at most, the strongest first. */
export function detectMoments(input: MomentInput): Moment[] {
  const { prompt, answer, earlier } = input;
  const out: Moment[] = [];
  const hint = line(prompt);
  const term = termOf(prompt);

  // Asked twice: what was explained did not stay. It comes before a first explanation.
  const termAgain = term !== null && earlier.some((p) => plain(termOf(p) ?? '') === plain(term));
  const again = termAgain || earlier.some((p) => sameQuestion(p, prompt));
  if (again) out.push({ kind: 'repeat', type: term || !HOW.test(prompt) ? 'concept' : 'recipe', signal: 'repeat', title: term, hint });
  else if (term && answer.length >= 500) out.push({ kind: 'explained', type: 'concept', signal: 'asked', title: term, hint });
  else if (UNKNOWN.test(prompt)) out.push({ kind: 'explained', type: 'concept', signal: 'unknown', title: null, hint });

  // « Ça marche enfin » after the person said, at least twice, that it did not.
  if (SOLVED.test(prompt) && !FAILED.test(prompt)) {
    const tries = earlier.filter((p) => FAILED.test(p));
    if (tries.length >= 2 || (tries.length >= 1 && input.toolErrors >= 3)) out.push({ kind: 'solved', type: 'known-error', signal: 'solved', title: null, hint: line(tries[0]!) });
  }

  if (DECIDED.test(prompt)) out.push({ kind: 'decision', type: 'decision', signal: 'decision', title: null, hint });

  const block = SHELL_BLOCK.exec(answer);
  if (block && !again && HOW.test(prompt)) {
    const command = block[1]!.split('\n').map((l) => l.trim().replace(/^\$\s+/, '')).find((l) => l && !l.startsWith('#'));
    if (command) out.push({ kind: 'command', type: 'recipe', signal: 'asked', title: null, hint: command.slice(0, 120) });
  }

  // An error the person brought, and an answer that says where it comes from.
  const lines = prompt.split('\n');
  const error = lines.find((l) => ERROR_LINE.test(l)) ?? lines.find((l) => ERROR_WORD.test(l));
  if (error && answer.length >= 300 && CAUSE.test(answer) && !out.some((m) => m.kind === 'solved')) out.push({ kind: 'error', type: 'known-error', signal: 'solved', title: null, hint: line(error, 140) });

  return out;
}

/** The person closes the session (« merci, à demain », « fin de session »): the moment to offer what was spotted. */
export function isClosing(prompt: string): boolean {
  return prompt.length <= 200 && CLOSING.test(prompt);
}
