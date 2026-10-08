import { posix } from 'node:path';
import type { Localized } from '../templates/builtin.js';
import { OkbError } from '../util/errors.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import {
  drawerFolder, drawerLabel, pickName, rootFile, SHARED_SUBJECT, subName, UNSORTED_SUBJECT,
  type BrainLayout, type DrawerId, type SubId,
} from './layout.js';
import { noteType, type Level, type NoteType, type Place } from './types.js';

/**
 * The address engine: from a note type and its subject (a product, a
 * repository, a theme, a ticket reference, a date), the exact path of the
 * note. Claude chooses the type and the subject; this function decides the
 * place, the same way every time — that is what keeps a brain navigable when
 * it holds thousands of notes.
 *
 * Two rules decide the level (« l'ascenseur ») and are applied by whoever
 * chooses the subject: a fact goes to the lowest level that holds it (a bug of
 * repo2 goes to repo2); a lesson rises to the highest level where it stays
 * true (a method that works everywhere goes to the toolbox).
 */
export type AddressInput = {
  readonly type: string;
  readonly title?: string;
  /** Product (work), project (projects), topic (topics) or skill (career). */
  readonly product?: string;
  readonly repo?: string;
  /** Theme for the `domain` level. */
  readonly theme?: string;
  /** Ticket or case reference (`ABC-123`). */
  readonly ref?: string;
  /** ISO date (defaults to today) for dated names and year folders. */
  readonly date?: string;
  /** Force a level among the type's places (`concept` defaults to the toolbox). */
  readonly level?: Level;
};

export type Address = {
  readonly path: BundlePath;
  readonly type: string;
  readonly level: Level;
  readonly drawer: DrawerId | null;
  /** Human breadcrumb: drawer, subjects, sub-folders. */
  readonly crumbs: readonly string[];
  /** Hub pages of the subjects above the note (created with it when missing). */
  readonly hubs: readonly { readonly path: BundlePath; readonly title: string; readonly kind: 'world' | 'domain' | 'product' | 'repo' }[];
};

export type AddressContext = {
  readonly layout: BrainLayout;
  /** Existing note paths, to keep names unique across the brain. */
  readonly existing?: ReadonlySet<string>;
  readonly today?: Date;
};

const FORBIDDEN = /[\\/:*?"<>|#^[\]{}\u0000-\u001f]/g;

/** A file or folder name people can read in Finder and Obsidian, safe on every disk. */
export function safeName(raw: string, max = 80): string {
  const cleaned = raw.normalize('NFC').replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

function need(value: string | undefined, what: string, type: string): string {
  const name = safeName(value ?? '');
  if (!name) throw new OkbError('E_INVALID', `a ${type} note needs its ${what}`, { key: 'brainNeeds', params: { type, what } });
  return name;
}

function isoDay(input: AddressInput, today: Date): string {
  if (input.date) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(input.date);
    if (!m) throw new OkbError('E_INVALID', `invalid date: ${input.date}`, { key: 'brainBadDate', params: { date: input.date } });
    return m[1]!;
  }
  return today.toISOString().slice(0, 10);
}

/** ISO week number: `2026-S41` (fr) / `2026-W41` (en). */
export function isoWeek(day: string, lang: 'fr' | 'en'): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-${lang === 'fr' ? 'S' : 'W'}${String(week).padStart(2, '0')}`;
}

function placeFor(type: NoteType, input: AddressInput): Place {
  if (input.level) {
    const forced = type.places.find((p) => p.level === input.level);
    if (!forced) throw new OkbError('E_INVALID', `a ${type.id} note cannot go at the ${input.level} level`, { key: 'brainBadLevel', params: { type: type.id, level: input.level } });
    return forced;
  }
  // The first place whose subject is known; the default (first) place otherwise.
  for (const p of type.places) {
    if (p.level === 'repo' && input.repo) return p;
    if (p.level === 'product' && input.product) return p;
    if (p.level === 'domain' && input.theme) return p;
    if (p.level === 'drawer' || p.level === 'root') return p;
  }
  return type.places[0]!;
}

function label(l: Localized | undefined, lang: 'fr' | 'en', fallback: string): string {
  return l ? pickName(l, lang) : fallback;
}

/**
 * The folder of a product's repository: `2 Produits/<product>/Code/<repo>`.
 * A repository without a product waits in « À classer ».
 */
export function repoFolderIn(layout: BrainLayout, product: string | undefined, repo: string): string {
  const p = safeName(product ?? '') || pickName(UNSORTED_SUBJECT, layout.lang);
  return posix.join(drawerFolder(layout, 'subjects'), p, subName(layout, 'code'), need(repo, 'repository', 'repo'));
}

export function productFolderIn(layout: BrainLayout, product: string): string {
  return posix.join(drawerFolder(layout, 'subjects'), need(product, 'product', 'product'));
}

export function sharedSubject(layout: BrainLayout): string {
  return pickName(SHARED_SUBJECT, layout.lang);
}

export function addressFor(ctx: AddressContext, input: AddressInput): Address {
  const { layout } = ctx;
  const type = noteType(input.type);
  if (!type) throw new OkbError('E_INVALID', `unknown note type "${input.type}"`, { key: 'brainUnknownType', params: { type: input.type } });
  if (type.presets && !type.presets.includes(layout.preset)) {
    throw new OkbError('E_INVALID', `a ${type.id} note does not exist in a ${layout.preset} brain`, { key: 'brainTypeNotHere', params: { type: type.id, preset: layout.preset } });
  }
  const lang = layout.lang;
  const today = ctx.today ?? new Date();
  const day = isoDay(input, today);
  const place = placeFor(type, input);
  const hubs: { path: BundlePath; title: string; kind: 'world' | 'domain' | 'product' | 'repo' }[] = [];
  const crumbs: string[] = [];
  let folder = '';
  let drawer: DrawerId | null = null;
  let subject = '';

  switch (place.level) {
    case 'root':
      break;
    case 'drawer': {
      drawer = place.drawer ?? 'inbox';
      folder = drawerFolder(layout, drawer);
      crumbs.push(drawerLabel(layout, drawer));
      subject = drawerLabel(layout, drawer);
      break;
    }
    case 'domain': {
      drawer = 'world';
      const theme = need(input.theme, 'theme', type.id);
      folder = posix.join(drawerFolder(layout, 'world'), subName(layout, 'domains'), theme);
      crumbs.push(drawerLabel(layout, 'world'), subName(layout, 'domains'), theme);
      hubs.push({ path: asBundlePath(`${folder}/${theme}.md`), title: theme, kind: 'domain' });
      subject = theme;
      break;
    }
    case 'product': {
      drawer = 'subjects';
      const product = need(input.product, layout.preset === 'work' ? 'product' : 'subject', type.id);
      folder = productFolderIn(layout, product);
      crumbs.push(drawerLabel(layout, 'subjects'), product);
      hubs.push({ path: asBundlePath(`${folder}/${product}.md`), title: product, kind: 'product' });
      subject = product;
      break;
    }
    case 'repo': {
      drawer = 'subjects';
      const repo = need(input.repo, 'repository', type.id);
      const product = safeName(input.product ?? '') || pickName(UNSORTED_SUBJECT, lang);
      const productFolder = productFolderIn(layout, product);
      folder = repoFolderIn(layout, product, repo);
      crumbs.push(drawerLabel(layout, 'subjects'), product, repo);
      hubs.push({ path: asBundlePath(`${productFolder}/${product}.md`), title: product, kind: 'product' });
      hubs.push({ path: asBundlePath(`${folder}/${repo}.md`), title: repo, kind: 'repo' });
      subject = repo;
      break;
    }
  }
  for (const sub of place.sub ?? []) {
    folder = posix.join(folder, subName(layout, sub as SubId));
    crumbs.push(subName(layout, sub as SubId));
  }
  if (type.yearly) {
    folder = posix.join(folder, day.slice(0, 4));
    crumbs.push(day.slice(0, 4));
  }

  const title = safeName(input.title ?? '');
  let name: string;
  switch (type.name) {
    case 'hub': name = subject; break;
    case 'fixed':
      if (place.level === 'root') name = type.id === 'home' ? rootFile(layout, 'home').replace(/\.md$/, '') : label(type.nameLabel, lang, type.id);
      else name = label(type.nameLabel, lang, type.id);
      break;
    case 'subject-type': name = `${subject} — ${label(type.nameLabel, lang, pickName(type.label, lang))}`; break;
    case 'ref-title': {
      const ref = need(input.ref, 'reference', type.id);
      name = title && title.toLowerCase() !== ref.toLowerCase() ? `${ref} — ${title}` : ref;
      break;
    }
    case 'date-title': name = title ? `${day} ${title}` : day; break;
    case 'year': name = day.slice(0, 4); break;
    case 'month': name = `${day.slice(0, 7)} ${label(type.nameLabel, lang, 'Bilan')}`; break;
    case 'week': name = isoWeek(day, lang); break;
    case 'title': name = need(input.title, 'title', type.id); break;
  }
  name = safeName(name, 100);
  if (!name) throw new OkbError('E_INVALID', `cannot name this ${type.id} note`, { key: 'brainNoName', params: { type: type.id } });

  // Unique names across the brain: the same title in two subjects gets its subject in front.
  let path = asBundlePath(folder ? `${folder}/${name}.md` : `${name}.md`);
  if (type.name === 'title' && ctx.existing && subject && !ctx.existing.has(path)) {
    const taken = [...ctx.existing].some((p) => posix.basename(p) === `${name}.md`);
    if (taken && !name.startsWith(`${subject} — `)) path = asBundlePath(`${folder}/${safeName(`${subject} — ${name}`, 100)}.md`);
  }
  return { path, type: type.id, level: place.level, drawer, crumbs, hubs };
}

/** The breadcrumb as people read it: `🧠 Travail › 📦 Produits › Produit A › Code › repo2`. */
export function breadcrumb(brainName: string, address: Pick<Address, 'crumbs'>): string {
  return [`🧠 ${brainName}`, ...address.crumbs].join(' › ');
}
