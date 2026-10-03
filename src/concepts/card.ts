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
  const quotes = quotesFor(doc, candidate.evidenceBlockIds, 3);
  const sourceId = sourceCiteId(doc);

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
        .map((q) => `> ${q.text}\n>\n> — ${formatLocator(q.locator)}[^${sourceId}]`)
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
    `  - id: ${sourceId}`,
    `    resource: ${yamlString(sourceResource(doc))}`,
    `    title: ${yamlString(doc.source.title ?? doc.source.uri)}`,
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
    `[^${sourceId}]: ${doc.source.title ?? doc.source.uri}`,
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
    : `Fiche courte : ${candidate.surface}.`;
}

function quotesFor(doc: NormalizedDoc, blockIds: readonly string[], max: number): Block[] {
  const wanted = new Set(blockIds);
  return doc.blocks.filter((b) => wanted.has(b.id)).slice(0, max);
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

export function sourceResource(doc: NormalizedDoc): string {
  return doc.source.uri.startsWith('file:') ? `urn:sha256:${doc.source.sha256}` : doc.source.uri;
}
