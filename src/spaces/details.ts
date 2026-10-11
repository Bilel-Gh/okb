import { listProducts } from '../brain/products.js';
import { noteKind } from '../brain/types.js';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { modulePrivateNames } from '../projects/sources.js';

/**
 * What in a text belongs to a workplace: the names of its products, clients
 * and repositories, ticket references, emails, internal links, amounts, and
 * the person's own list of words. Found without AI; used before anything
 * leaves a work space (a portable copy of the career notes, « Garder dans mon
 * bagage »).
 */
export type DetailKind = 'product' | 'client' | 'repository' | 'ticket' | 'email' | 'url' | 'amount' | 'custom';
export type Detail = { readonly line: number; readonly text: string; readonly kind: DetailKind };
export type Names = readonly { readonly re: RegExp; readonly kind: DetailKind }[];

const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const URL = /\bhttps?:\/\/[^\s)>\]]+/g;
const AMOUNT = /(?:\b\d[\d\s.,]*\s?(?:k€|M€|€|EUR|USD|\$)|[$€]\s?\d[\d\s.,]*)/g;
/** References that look like a ticket and are public knowledge (UTF-8, ISO-8601, SHA-256, a CVE). */
const PUBLIC_REFS = /^(?:UTF|ISO|SHA|AES|RSA|RFC|HTTP|TLS|SSL|MD|CVE|PEP|ES|WCAG|IPV|COVID|BASE|X|H|MP|HS|RS)-/;
export const PUBLIC_HOSTS = /^(https?:\/\/)?([\w-]+\.)*(wikipedia\.org|github\.com|developer\.mozilla\.org|nodejs\.org|claude\.com|anthropic\.com|npmjs\.com|w3\.org)\b/i;

const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');

/** The names this workplace is known by in the brain. */
export async function workplaceNames(config: OkbConfig, bundle: Bundle, extraWords: readonly string[] = []): Promise<Names> {
  const names: { re: RegExp; kind: DetailKind }[] = [];
  for (const p of await listProducts(config).catch(() => [])) {
    if (p.name.length > 2) names.push({ re: word(p.name), kind: 'product' });
    for (const r of p.repos ?? []) if (r.name.length > 2) names.push({ re: word(r.name), kind: 'repository' });
  }
  for (const r of await modulePrivateNames().catch(() => [])) if (r.name.length > 2 && r.kind === 'repository') names.push({ re: word(r.name), kind: 'repository' });
  for (const e of bundle.entries) if (noteKind(e) === 'client' && e.title.length > 2) names.push({ re: word(e.title), kind: 'client' });
  for (const w of extraWords) if (w.trim().length > 1) names.push({ re: word(w.trim()), kind: 'custom' });
  return names;
}

type Span = { start: number; end: number; text: string; kind: DetailKind };

/** The mentions of one line; a mention inside a longer one (a product's name in its repository's) counts once. */
function spansOf(raw: string, names: Names): Span[] {
  const spans: Span[] = [];
  // Link targets are judged as links, not as words: « [x](a-b-1.md) » is not a ticket.
  const plain = raw.replace(/\]\([^)]*\)/g, (m) => `]${' '.repeat(m.length - 1)}`);
  const add = (source: string, re: RegExp, kind: DetailKind, keep: (text: string) => boolean = () => true) => {
    for (const m of source.matchAll(re)) {
      const text = m[0].trim();
      if (text && keep(text)) spans.push({ start: m.index, end: m.index + m[0].length, text, kind });
    }
  };
  add(raw, URL, 'url', (text) => !PUBLIC_HOSTS.test(text));
  add(plain, EMAIL, 'email');
  add(plain, TICKET, 'ticket', (text) => !PUBLIC_REFS.test(text));
  add(plain, AMOUNT, 'amount', (text) => /\d/.test(text));
  for (const n of names) add(plain, n.re, n.kind);
  const inside = (a: Span, b: Span) => a !== b && a.start >= b.start && a.end <= b.end && (b.end - b.start > a.end - a.start || spans.indexOf(b) < spans.indexOf(a));
  return spans.filter((s) => !spans.some((o) => inside(s, o))).sort((a, b) => a.start - b.start);
}

/** Every mention of the workplace in a text, line by line. The breadcrumb of a brain (🧭) is not part of the text. */
export function detailsIn(text: string, names: Names): Detail[] {
  return text.split('\n').flatMap((raw, i) => (raw.startsWith('🧭') ? [] : spansOf(raw, names).map((s) => ({ line: i + 1, text: s.text, kind: s.kind }))));
}

const NEUTRAL: Readonly<Record<'fr' | 'en', Readonly<Record<DetailKind, string>>>> = {
  fr: { product: 'un produit', client: 'un client', repository: 'un dépôt', ticket: 'un ticket', email: 'une adresse', url: 'un lien interne', amount: 'un montant', custom: '…' },
  en: { product: 'a product', client: 'a client', repository: 'a repository', ticket: 'a ticket', email: 'an address', url: 'an internal link', amount: 'an amount', custom: '…' },
};

/**
 * The same text without the workplace: each mention gives way to a neutral
 * word, a link that is not public keeps its words and loses its address, the
 * breadcrumb goes. A first version, made without AI, for the person to reread.
 */
export function withoutDetails(text: string, names: Names, lang: 'fr' | 'en'): string {
  const neutral = NEUTRAL[lang];
  return text.split('\n').filter((l) => !l.startsWith('🧭')).map((line) => {
    const unlinked = line.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (all, label: string, target: string) => (/^https?:/i.test(target) && PUBLIC_HOSTS.test(target) ? all : label));
    let out = '';
    let at = 0;
    for (const s of spansOf(unlinked, names)) {
      if (s.start < at) continue;
      const lead = unlinked.slice(s.start, s.end).length - unlinked.slice(s.start, s.end).trimStart().length;
      out += unlinked.slice(at, s.start + lead) + neutral[s.kind];
      at = s.start + lead + s.text.length;
    }
    return out + unlinked.slice(at);
  }).join('\n');
}
