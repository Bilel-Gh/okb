import { posix } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { markdownLink } from '../links/portable.js';
import { nowIso } from '../okf/types.js';
import { formatLocator, type Block, type NormalizedDoc } from '../sources/types.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import type { ConceptCandidate } from './detect.js';

export type ConceptCard = {
  readonly path: BundlePath;
  readonly surface: string;
  readonly content: string;
  readonly needsClarification: boolean;
  readonly evidenceBlockIds: readonly string[];
};

/** Rubrics are emitted only when they carry something; empty headings are noise. */
type Rubric = { heading: string; body: string };

export function conceptSlug(surface: string): string {
  return surface
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function conceptPathFor(config: OkbConfig, surface: string, taken: ReadonlySet<string>): BundlePath {
  const folder = config.kb.layout.concepts.replace(/\/$/, '');
  const base = conceptSlug(surface) || 'concept';
  let candidate = posix.join(folder, `${base}.md`);
  let n = 2;
  while (taken.has(candidate)) {
    candidate = posix.join(folder, `${base}-${n}.md`);
    n += 1;
  }
  return asBundlePath(candidate);
}

export type CardInput = {
  readonly candidate: ConceptCandidate;
  readonly doc: NormalizedDoc;
  readonly bundle: Bundle;
  readonly config: OkbConfig;
  readonly path: BundlePath;
  readonly prereqs?: readonly BundlePath[];
  readonly domain?: string;
  /** Other sources of the same import: an excerpt may come from any of them. */
  readonly otherDocs?: readonly NormalizedDoc[];
};

/**
 * Build a short OKF concept card.
 *
 * Two rules drive the content: never restate the term as its own definition, and
 * never invent an acronym expansion. When the meaning is not established the card
 * says so and carries `status: draft` plus `x_okb.needs_clarification`.
 */
export function buildConceptCard(input: CardInput): ConceptCard {
  const { candidate, doc, config, path } = input;
  const needsClarification = candidate.resolution.status === 'needs-clarification';
  const quotes = quotesFor([doc, ...(input.otherDocs ?? [])], candidate.evidenceBlockIds, 3, candidate.evidenceQuotes);
  const sourceId = sourceCiteId(doc);
  // Every source a displayed excerpt comes from is cited, the defining one first.
  const cited = [doc, ...quotes.map((q) => q.doc).filter((d) => d !== doc)].filter((d, i, all) => all.indexOf(d) === i);

  const rubrics: Rubric[] = [];

  if (needsClarification) {
    rubrics.push({
      heading: 'À clarifier',
      body: [
        `Le sens de **${candidate.surface}** n'est pas établi par les sources disponibles.`,
        '',
        candidate.kind === 'acronym'
          ? "Aucun développement de l'acronyme n'a été trouvé dans la source. Il n'a pas été deviné."
          : "Aucune définition fiable n'a été trouvée dans la source.",
        '',
        'À compléter par quelqu\'un qui connaît le terme, puis passer `status` à `stable`.',
      ].join('\n'),
    });
  } else if (candidate.expansionFromSource) {
    rubrics.push({
      heading: 'Définition',
      body: `**${candidate.surface}** — ${candidate.expansionFromSource.text}.[^${sourceId}]\n\nDéveloppement relevé dans la source, non vérifié contre le code.`,
    });
  } else {
    rubrics.push({
      heading: 'Définition',
      body: `*À rédiger.* Le terme **${candidate.surface}** apparaît ${candidate.occurrences}× dans la source ; la définition reste à écrire à partir des extraits ci-dessous.`,
    });
  }

  if (quotes.length > 0) {
    rubrics.push({
      heading: 'Ce que dit la source',
      body: quotes
        .map((q) => `${blockquote(q.block.text)}\n>\n> — ${formatLocator(q.block.locator)}[^${sourceCiteId(q.doc)}]`)
        .join('\n\n'),
    });
  }

  const prereqs = input.prereqs ?? [];
  if (prereqs.length > 0) {
    rubrics.push({
      heading: 'Prérequis utiles',
      body: prereqs
        .map((p, i) => `${i + 1}. ${markdownLink(path, p, titleOf(input.bundle, p))}`)
        .join('\n'),
    });
  }

  if (candidate.resolution.status === 'ambiguous') {
    rubrics.push({
      heading: 'Ne pas confondre',
      body: candidate.resolution.options
        .map((o) => `- ${markdownLink(path, o.path, titleOf(input.bundle, o.path))}${o.sense ? ` (sens « ${o.sense} »)` : ''}`)
        .join('\n'),
    });
  }

  const frontmatter = [
    '---',
    'type: Concept',
    `title: ${yamlString(candidate.surface)}`,
    `description: ${yamlString(describe(candidate))}`,
    `tags: [concept${input.domain ? `, ${yamlString(input.domain)}` : ''}]`,
    'status: draft',
    `generated: { by: ${yamlString(config.okf.machineActor)}, at: ${nowIso()} }`,
    'sources:',
    ...cited.flatMap((d) => [
      `  - id: ${sourceCiteId(d)}`,
      `    resource: ${yamlString(sourceResource(d))}`,
      `    title: ${yamlString(sourceLabel(d))}`,
    ]),
    'x_okb:',
    '  v: 1',
    `  aliases: [${[...new Set([candidate.surface])].map(yamlString).join(', ')}]`,
    ...(input.domain ? [`  domain: ${yamlString(input.domain)}`] : []),
    ...(prereqs.length > 0 ? ['  prereqs:', ...prereqs.map((p) => `    - ${yamlString(p)}`)] : []),
    ...(needsClarification ? ['  needs_clarification: true'] : []),
    '---',
  ].join('\n');

  const body = [
    '',
    oneLiner(candidate, needsClarification),
    '',
    ...rubrics.map((r) => `# ${r.heading}\n\n${r.body}\n`),
    ...cited.map((d) => `[^${sourceCiteId(d)}]: ${sourceLabel(d)}`),
    '',
  ].join('\n');

  return {
    path,
    surface: candidate.surface,
    content: `${frontmatter}\n${body}`,
    needsClarification,
    evidenceBlockIds: candidate.evidenceBlockIds,
  };
}

function oneLiner(candidate: ConceptCandidate, needsClarification: boolean): string {
  if (needsClarification) {
    return `Fiche ouverte pour **${candidate.surface}** : le terme revient dans les sources mais son sens n'est pas encore établi.`;
  }
  return `Fiche courte sur **${candidate.surface}**, créée pour que le lecteur n'ait pas à deviner le terme en cours de lecture.`;
}

function describe(candidate: ConceptCandidate): string {
  return candidate.resolution.status === 'needs-clarification'
    ? `Terme « ${candidate.surface} » relevé dans une source, sens à confirmer.`
    : candidate.expansionFromSource
      ? `${candidate.surface} : ${clip(candidate.expansionFromSource.text, 180)}.`
      : `Fiche courte : ${candidate.surface}.`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function quotesFor(docs: readonly NormalizedDoc[], blockIds: readonly string[], max: number, exact?: CardInput['candidate']['evidenceQuotes']): { block: Block; doc: NormalizedDoc }[] {
  const byId = new Map(docs.flatMap((d) => d.blocks.map((b) => [b.id, { block: b, doc: d }] as const)));
  if (exact?.length) {
    // The author's verbatim excerpt, not the whole block: a 50-line code block
    // would bury the definition and overflow a short card.
    return exact
      .filter((e) => byId.get(e.blockId)?.block.text.includes(e.quote) &&
        (e.displayQuote === undefined || (e.displayQuote.trim().length > 0 && e.quote.includes(e.displayQuote))))
      .slice(0, max)
      .map((e) => { const hit = byId.get(e.blockId)!; return { block: { ...hit.block, text: e.displayQuote ?? e.quote }, doc: hit.doc }; });
  }
  const wanted = new Set(blockIds);
  return docs[0]!.blocks.filter((b) => wanted.has(b.id)).slice(0, max).map((block) => ({ block, doc: docs[0]! }));
}

/** Every line prefixed, so a multi-line excerpt stays inside one quotation. */
function blockquote(text: string): string {
  return text.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

export function sourceCiteId(doc: NormalizedDoc): string {
  const base = (doc.source.title ?? doc.source.uri)
    .split(/[/\\]/)
    .pop()!
    .replace(/\.[a-z0-9]+$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${base || 'source'}-${doc.source.sha256.slice(0, 10)}`;
}

function titleOf(bundle: Bundle, path: BundlePath): string {
  return bundle.byPath.get(path)?.title ?? path.split('/').pop()!.replace(/\.md$/, '');
}

export function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * How a source is named inside a note. A local file without a title shows its
 * file name, never the absolute path: a bundle must not reveal where its author
 * keeps private material, and it must stay readable on another machine.
 */
export function sourceLabel(doc: NormalizedDoc): string {
  if (doc.source.title) return doc.source.title;
  if (doc.source.uri.startsWith('file:')) {
    const name = doc.source.uri.split(/[/\\]/).pop() ?? '';
    try { return decodeURIComponent(name) || 'Source'; } catch { return name || 'Source'; }
  }
  return doc.source.uri;
}

export function sourceResource(doc: NormalizedDoc): string {
  return doc.source.uri.startsWith('file:') ? `urn:sha256:${doc.source.sha256}` : doc.source.uri;
}
