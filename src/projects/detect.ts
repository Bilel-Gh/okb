import { localDay, shiftDay } from '../util/day.js';

/**
 * Spot an action in a line the person keeps (F2.0-06), without AI: « réserver
 * le car avant le 15 mai » is a thing to do with a date, « j'attends l'avis de
 * Paul » something expected from someone, « le quota passe à 500 » a plain
 * fact. OKB only offers what it spots; the person confirms.
 */
export type Detected = { kind: 'todo' | 'waiting'; text: string; due?: string; who?: string };

const TODO = /^(?:il faut(?: que je)?|je dois|à faire\s*:?|a faire\s*:?|penser à|ne pas oublier(?: de| d[’'])?|n[’']oublie pas(?: de| d[’'])?|todo\s*:?|to do\s*:?|i (?:need|have) to|need to|must|remember to|don[’']t forget to)\s+/i;
const WAITING = /^(?:j[’']attends(?: que)?|en attente de|attendre|waiting for|i am waiting for|i[’']m waiting for)\s+/i;
/** A first word that reads as a French infinitive: « réserver », « finir », « répondre ». */
const INFINITIVE = /^[a-zà-ÿ]{2,}(?:er|ir|re|oir)$/i;
const NOT_VERBS = new Set(['hier', 'premier', 'première', 'dernier', 'cher', 'entre', 'contre', 'notre', 'votre', 'autre', 'encore', 'derrière', 'soir', 'noir', 'pour', 'sur', 'leur', 'super', 'hiver', 'papier', 'dossier', 'atelier', 'février', 'janvier', 'cahier', 'chantier', 'quartier', 'courrier', 'serveur', 'être', 'avoir', 'faire']);

const MONTHS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const LEAD = '(?:avant le|avant|pour le|pour|d[’\']ici le|d[’\']ici|le|by|before|on|until)\\s+';
const iso = localDay;
const plus = shiftDay;

/** The next day with this number and month, this year or the next. */
function nextDate(now: Date, day: number, month: number): string | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let d = new Date(now.getFullYear(), month - 1, day, 12);
  if (d.getMonth() !== month - 1) return null;
  if (localDay(d) < localDay(now)) d = new Date(now.getFullYear() + 1, month - 1, day, 12);
  return iso(d);
}

/** A date said in the line, and the line without it. */
function takeDate(text: string, now: Date): { rest: string; due?: string } {
  const months = Object.keys(MONTHS).join('|');
  const days = Object.keys(WEEKDAYS).join('|');
  const forms: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [new RegExp(`\\s*(?:${LEAD})?(après-demain|apres-demain)\\b`, 'i'), () => iso(plus(now, 2))],
    [new RegExp(`\\s*(?:${LEAD})?(demain|tomorrow)\\b`, 'i'), () => iso(plus(now, 1))],
    [new RegExp(`\\s*(?:${LEAD})?(aujourd[’']hui|today)\\b`, 'i'), () => iso(plus(now, 0))],
    [new RegExp(`\\s*(?:${LEAD})?(\\d{1,2})(?:er)?\\s+(${months})\\b`, 'i'), (m) => nextDate(now, Number(m[1]), MONTHS[m[2]!.toLowerCase()]!)],
    [new RegExp(`\\s*(?:${LEAD})?(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m) => nextDate(now, Number(m[2]), MONTHS[m[1]!.toLowerCase()]!)],
    [new RegExp(`\\s*(?:${LEAD})?(\\d{1,2})/(\\d{1,2})\\b`, 'i'), (m) => nextDate(now, Number(m[1]), Number(m[2]))],
    [new RegExp(`\\s*(?:${LEAD})?(${days})\\b`, 'i'), (m) => { const ahead = (WEEKDAYS[m[1]!.toLowerCase()]! - now.getDay() + 7) % 7 || 7; return iso(plus(now, ahead)); }],
  ];
  for (const [re, when] of forms) {
    const m = re.exec(text);
    if (!m) continue;
    const due = when(m);
    if (due) return { rest: `${text.slice(0, m.index)}${text.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(), due };
  }
  return { rest: text };
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const tidy = (s: string) => s.replace(/^[\s:,-]+|[\s.,;:]+$/g, '');

export function detectAction(line: string, now = new Date()): Detected | null {
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 400) return null;
  const waiting = WAITING.exec(text);
  if (waiting) {
    const { rest, due } = takeDate(text.slice(waiting[0].length), now);
    const body = tidy(rest);
    if (!body) return null;
    // Who it is expected from: a name in the line (a capitalised word that is not an acronym).
    const who = /(?:^|\s)([A-ZÀ-Ý][a-zà-ÿ]+(?:-[A-ZÀ-Ý][a-zà-ÿ]+)?)(?=\s|$|[,.;:])/.exec(body.replace(/^(?:L|D|Qu)[’']/, ' '))?.[1];
    return { kind: 'waiting', text: capital(body), ...(who ? { who } : {}), ...(due ? { due } : {}) };
  }
  const todo = TODO.exec(text);
  const first = text.split(' ')[0]!.toLowerCase();
  if (!todo && !(INFINITIVE.test(first) && !NOT_VERBS.has(first) && text.split(' ').length >= 2)) return null;
  const { rest, due } = takeDate(todo ? text.slice(todo[0].length) : text, now);
  const body = tidy(rest);
  if (!body) return null;
  return { kind: 'todo', text: capital(body), ...(due ? { due } : {}) };
}
