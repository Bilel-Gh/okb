import { findSecrets } from '../security/secrets.js';
import { detectMoments, type MomentKind } from '../suggest/moments.js';
import type { Chunk, Turn } from './transcript.js';

/**
 * Before any model is asked (D77): is this conversation worth the scribe's
 * tokens, and what does it say, in a form a model can cite word for word.
 * Both are plain code: a short exchange about nothing costs nothing.
 */
export type Triage = {
  readonly worth: boolean;
  /** A fixed word: why it is (not) worth it. */
  readonly reason: 'empty' | 'short' | 'small-talk' | 'work' | 'moments' | 'long';
  readonly moments: readonly MomentKind[];
  /** Ticket references named in the conversation or the branch (ABC-123), most frequent first. */
  readonly refs: readonly string[];
  readonly edited: readonly string[];
  readonly personTurns: number;
};

const REF = /\b([A-Z][A-Z0-9]{1,15}-\d{1,7})\b/g;
const LONG = 6000;

export function triage(chunk: Pick<Chunk, 'turns' | 'branch'>): Triage {
  const turns = chunk.turns;
  const person = turns.filter((t) => t.who === 'person');
  const edited = [...new Set(turns.flatMap((t) => t.edited))];
  const counts = new Map<string, number>();
  for (const text of [chunk.branch ?? '', ...turns.map((t) => t.text)]) for (const m of text.toUpperCase().matchAll(REF)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  const refs = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).filter((r) => !/^(UTF|ISO|SHA|RFC|HTTP|TLS|ES)-/.test(r));
  const moments = new Set<MomentKind>();
  const earlier: string[] = [];
  turns.forEach((t, i) => {
    if (t.who !== 'person') return;
    const answer = turns[i + 1]?.who === 'assistant' ? turns[i + 1]!.text : '';
    for (const m of detectMoments({ prompt: t.text, answer, earlier, toolErrors: t.errors })) moments.add(m.kind);
    earlier.push(t.text);
  });
  const size = turns.reduce((n, t) => n + t.text.length, 0);
  const base = { moments: [...moments], refs, edited, personTurns: person.length };
  if (!person.length) return { ...base, worth: false, reason: 'empty' };
  if (person.length < 2 && !edited.length && size < LONG) return { ...base, worth: false, reason: 'short' };
  if (edited.length) return { ...base, worth: true, reason: 'work' };
  if (moments.size) return { ...base, worth: true, reason: 'moments' };
  if (size >= LONG) return { ...base, worth: true, reason: 'long' };
  return { ...base, worth: false, reason: 'small-talk' };
}

const MAX_PERSON = 2500;
const MAX_ASSISTANT = 2500;
const MAX_DIGEST = 60_000;

/**
 * The conversation as a Markdown source: one section per turn, with the time,
 * the files changed and the commands run. A paragraph holding a secret is left
 * out, never sent. A long conversation keeps its beginning and its end.
 */
export function renderDigest(chunk: Pick<Chunk, 'session' | 'cwd' | 'branch' | 'turns'>, lang: 'fr' | 'en'): string {
  const fr = lang === 'fr';
  const head = [
    `# ${fr ? 'Conversation' : 'Conversation'} ${chunk.session.slice(0, 8)}`,
    '',
    ...(chunk.cwd ? [`- ${fr ? 'Dossier' : 'Folder'} : ${chunk.cwd}`] : []),
    ...(chunk.branch ? [`- ${fr ? 'Branche' : 'Branch'} : ${chunk.branch}`] : []),
    '',
  ];
  const sections = chunk.turns.map((t) => section(t, fr));
  let body = sections.join('\n');
  if (body.length > MAX_DIGEST) {
    const take = (list: string[]) => { const out: string[] = []; let used = 0; for (const x of list) { if (used + x.length > MAX_DIGEST / 2) break; out.push(x); used += x.length; } return out; };
    const first = take(sections);
    const last = take([...sections].reverse()).reverse().filter((x) => !first.includes(x));
    body = [...first, fr ? '_(milieu de la conversation non repris)_\n' : '_(middle of the conversation left out)_\n', ...last].join('\n');
  }
  return `${head.join('\n')}\n${body}`;
}

function section(t: Turn, fr: boolean): string {
  const who = t.who === 'person' ? (fr ? 'Personne' : 'Person') : 'Claude';
  const time = t.at ? ` · ${t.at.slice(11, 16)}` : '';
  const limit = t.who === 'person' ? MAX_PERSON : MAX_ASSISTANT;
  const lines = [`## ${who}${time}`, '', clean(t.text, limit)];
  if (t.edited.length) lines.push('', `${fr ? 'Fichiers modifiés' : 'Files changed'} : ${t.edited.slice(0, 20).join(', ')}`);
  if (t.commands.length) lines.push('', `${fr ? 'Commandes' : 'Commands'} : ${t.commands.slice(0, 10).map((c) => `\`${c.replace(/`/g, "'")}\``).join(' · ')}`);
  if (t.errors) lines.push('', `${fr ? 'Erreurs d’outils' : 'Tool errors'} : ${t.errors}`);
  return `${lines.join('\n')}\n`;
}

function clean(text: string, limit: number): string {
  const kept = text.split(/\n{2,}/).filter((p) => !findSecrets(p).length).join('\n\n').trim();
  return kept.length <= limit ? kept : `${kept.slice(0, limit).trimEnd()} […]`;
}
