import YAML from 'yaml';
import { randomUUID } from 'node:crypto';
import { materializeFile } from '../proposal/materialize.js';
import { renderAnalysis, validateAnalysis, type SourceAnalysis } from './analysis.js';
import { normalizeSurface } from '../kb/search.js';
import { lookup } from '../concepts/lexicon.js';
import type { OkbConfig } from '../config/schema.js';
import { buildConceptCard, conceptPathFor, sourceCiteId, sourceResource } from '../concepts/card.js';
import { detectConcepts, type ConceptCandidate } from '../concepts/detect.js';
import { planLinkInjection, type LinkTarget } from '../concepts/inject.js';
import { buildPrereqChain } from '../concepts/prereq.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { verifiedList } from '../okf/types.js';
import { hasIngested } from '../okf/extensions.js';
import {
  computeProposalHash,
  type Change,
  type Contradiction,
  type Evidence,
  type Proposal,
} from '../proposal/model.js';
import { formatLocator, type NormalizedDoc } from '../sources/types.js';
import { OkbError } from '../util/errors.js';
import { hashStructure, shortId } from '../util/hash.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { detectCorrections, type Correction } from './corrections.js';

export type IngestTarget =
  | { readonly mode: 'append'; readonly path: BundlePath; readonly heading: string }
  | { readonly mode: 'create'; readonly path: BundlePath; readonly title: string };

export type IngestOptions = {
  readonly target: IngestTarget;
  /** Prose written by the caller. Absent means "emit an evidence digest". */
  readonly sectionMarkdown?: string;
  readonly analysis?: unknown;
  readonly conceptAssistLevel?: 'off' | 'targeted' | 'pedagogical';
  readonly domain?: string;
  /** Rebuild even when the content key is already recorded in the target. */
  readonly reprocess?: boolean;
  readonly linkInto?: readonly BundlePath[];
};

export type IngestReport = {
  readonly proposal: Proposal;
  readonly candidates: readonly ConceptCandidate[];
  readonly corrections: readonly Correction[];
  readonly skipped: readonly { readonly reason: string; readonly detail: string }[];
  readonly conceptAssistLevel: string;
};

export async function prepareProposal(
  config: OkbConfig,
  doc: NormalizedDoc,
  options: IngestOptions,
): Promise<IngestReport> {
  if (doc.source.support === 'unsupported' || !doc.blocks.length) throw new OkbError('E_UNSUPPORTED', 'source has no readable content; no proposal created');
  const analysis = options.analysis === undefined ? undefined : validateAnalysis(options.analysis, doc);
  const bundle = await loadBundleFor(config);
  const skipped: { reason: string; detail: string }[] = [];
  const evidence: Evidence[] = [];
  const changes: Change[] = [];
  const notes: string[] = [];
  const baseline: Record<string, string | null> = {};

  const citeId = sourceCiteId(doc);
  const corrections = detectCorrections(doc);

  for (const limitation of doc.source.limitations) {
    notes.push(`extraction limit: ${limitation}`);
  }
  if (doc.source.support !== 'full') {
    notes.push(
      `source support is "${doc.source.support}" — parts of the document were not readable and nothing was invented to fill the gap`,
    );
  }

  const digestBlocks = doc.blocks;
  for (const block of digestBlocks) {
    evidence.push({
      id: `ev-${block.id.replace('#', '-')}`,
      sourceId: doc.source.id,
      blockIds: [block.id],
      quote: block.text,
      locator: formatLocator(block.locator),
      claimKind: 'reported',
    });
  }

  const articleMarkdown =
    analysis ? renderAnalysis(analysis, doc) : options.sectionMarkdown ?? renderEvidenceDigest(doc, citeId, corrections);
  if (!analysis) notes.push("raw evidence digest / legacy prose: not a complete semantic synthesis; use --analysis-file for coverage and citation checks");

  const articleKey = contentKeyFor({
    sourceSha: doc.source.sha256,
    path: options.target.path,
    kind: 'article',
    payload: 'source-revision',
  });

  const targetEntry = bundle.byPath.get(options.target.path);
  const targetDoc = bundle.docs.get(options.target.path);
  const alreadyIngested =
    targetDoc !== undefined && hasIngested(targetDoc.data, articleKey) && !options.reprocess;

  if (alreadyIngested) {
    skipped.push({
      reason: 'already-ingested',
      detail: `${options.target.path} already carries content key ${articleKey.slice(0, 12)}…`,
    });
    notes.push(
      'this source was already merged into this target; nothing is proposed again — use --reprocess to rebuild it',
    );
    const empty = {
      id: shortId(`${doc.source.sha256}:${options.target.path}:noop`),
      createdAt: new Date().toISOString(),
      profileId: config.profile.id,
      kbRoot: config.kb.root,
      sourceIds: [doc.source.id],
      sourceUris: [doc.source.uri],
      baseline: {},
      changes: [],
      evidence: [],
      contradictions: [],
      notes,
      conceptAssistLevel: config.conceptAssist.level,
    };
    return {
      proposal: { ...empty, status: 'prepared', contentHash: computeProposalHash(empty) },
      candidates: [],
      corrections,
      skipped,
      conceptAssistLevel: config.conceptAssist.level,
    };
  }

  if (options.target.mode === 'create') {
    if (targetEntry) {
      throw new OkbError('E_CONFLICT', `${options.target.path} already exists`, {
        hint: 'Use --append to add a section to it instead of --create.',
      });
    }
    changes.push({
      id: 'c-article',
      kind: 'create-document',
      path: options.target.path,
      label: `create ${options.target.path}`,
      rationale: `new document built from ${doc.source.uri}`,
      contentKey: articleKey,
      evidenceIds: evidence.map((e) => e.id),
      dependsOn: [],
      category: 'article',
      createDocument: {
        content: renderNewDocument(config, doc, options.target.title, articleMarkdown, citeId, analysis),
      },
    });
  } else {
    if (!targetEntry) {
      throw new OkbError('E_NOT_FOUND', `${options.target.path} does not exist`, {
        hint: 'Use --create to start a new document.',
      });
    }
    changes.push({
      id: 'c-article',
      kind: 'append-section',
      path: options.target.path,
      label: `append "${options.target.heading}" to ${options.target.path}`,
      rationale: `section built from ${doc.source.uri}`,
      contentKey: articleKey,
      evidenceIds: evidence.map((e) => e.id),
      dependsOn: [],
      category: 'article',
      appendSection: { heading: options.target.heading, markdown: articleMarkdown },
      patchFrontmatter: { patch: { sources: mergeSources(targetDoc?.data.sources, doc, analysis), status: 'draft', ...(targetDoc && verifiedList(targetDoc.data).length ? { verified: [], x_okb: { ...(targetDoc.data.x_okb as Record<string,unknown> ?? {}), prior_verified: [...((targetDoc.data.x_okb as any)?.prior_verified ?? []), ...verifiedList(targetDoc.data)] } } : {}) } },
    });
  }

  const detection = detectConcepts(doc, bundle, config, {
    ...(options.conceptAssistLevel ? { level: options.conceptAssistLevel } : {}),
    ...(options.domain ? { domain: options.domain } : {}),
  });

  if (analysis && detection.level !== 'off') {
    for (const term of analysis.concepts) {
      const canonical = normalizeSurface(term.term);
      if (config.conceptAssist.known.map(normalizeSurface).includes(canonical) || config.conceptAssist.stoplist.map(normalizeSurface).includes(canonical)) continue;
      const known = lookup(detection.lexicon, term.term);
      if (known?.ambiguous) continue;
      const candidate: ConceptCandidate = {
        surface: term.term, canonical, kind: 'phrase', occurrences: term.evidence.length,
        firstBlockId: term.evidence[0]!.blockId, evidenceBlockIds: term.evidence.map(e => e.blockId), score: 10,
        resolution: known ? { status: 'existing', path: known.senses[0]!.path, via: 'alias' } : { status: 'missing' },
        rationale: 'definition proposed by the author with exact source excerpts; semantic review required',
        expansionFromSource: { text: term.definition, blockId: term.evidence[0]!.blockId },
      };
      const index = detection.candidates.findIndex(c => c.canonical === canonical);
      if (index >= 0) detection.candidates[index] = candidate;
      else detection.candidates.push(candidate);
    }
    detection.candidates = detection.candidates.slice(0, config.conceptAssist.limits.maxSuggestionsPerSource);
  }

  const takenPaths = new Set<string>(bundle.entries.map((e) => e.path as string));
  const linkTargets: LinkTarget[] = [];

  for (const [i, candidate] of detection.candidates.entries()) {
    if (candidate.resolution.status === 'ambiguous') {
      notes.push(
        `"${candidate.surface}" is ambiguous (${candidate.resolution.options.map((o) => o.path).join(', ')}); no link was proposed`,
      );
      continue;
    }

    if (candidate.resolution.status === 'existing') {
      linkTargets.push({
        surfaces: [candidate.surface],
        canonical: candidate.canonical,
        target: candidate.resolution.path,
      });
      continue;
    }

    if (!candidate.expansionFromSource || candidate.resolution.status === 'needs-clarification') {
      notes.push(`"${candidate.surface}": clarification needed; candidate retained in the proposal, no empty concept card created`);
      continue;
    }

    const path = conceptPathFor(config, candidate.surface, takenPaths);
    takenPaths.add(path);
    const prereqChain = { order: [] as BundlePath[] }; // prerequisites require evidence for this concept; never copy the article's graph

    const card = buildConceptCard({
      candidate,
      doc,
      bundle,
      config,
      path,
      prereqs: prereqChain.order,
      ...(options.domain ? { domain: options.domain } : {}),
    });

    if (card.content.split('---').slice(2).join('---').split('\n').length > config.conceptAssist.limits.maxCardLines) {
      notes.push(`\"${candidate.surface}\": card exceeds maxCardLines; shorten its sourced definition before publication`);
      continue;
    }
    const changeId = `c-concept-${i}`;
    changes.push({
      id: changeId,
      kind: 'create-document',
      path,
      label: `create concept card ${path}`,
      rationale: candidate.rationale,
      contentKey: contentKeyFor({
        sourceSha: doc.source.sha256,
        path,
        kind: 'concept-card',
        payload: candidate.canonical,
      }),
      evidenceIds: candidate.evidenceBlockIds.map((b) => `ev-${b.replace('#', '-')}`),
      dependsOn: [],
      category: 'concept-card',
      createDocument: { content: card.content },
    });

    if (!card.needsClarification) {
      linkTargets.push({
        surfaces: [candidate.surface],
        canonical: candidate.canonical,
        target: path,
        dependsOn: changeId,
      });
    } else {
      notes.push(
        `"${candidate.surface}" has no established meaning; a card was proposed with needs_clarification and no link was inserted`,
      );
    }
  }

  const linkFiles = [...new Set([options.target.path, ...(options.linkInto ?? [])])];
  let linkChangeIndex = 0;
  for (const file of linkFiles) {
    const article = changes.find(c => c.id === 'c-article' && c.path === file);
    const before = bundle.snapshot.files.get(file);
    const text = article ? materializeFile(file, before ?? null, [article], { recordKeys: false }) : before;
    if (text === undefined) { skipped.push({ reason: 'link-target-missing', detail: file }); continue; }
    const plan = planLinkInjection(file, text, linkTargets, config.conceptAssist.limits);
    for (const s of plan.skipped) skipped.push({ reason: 'link-skipped', detail: `${s.term}: ${s.reason}` });
    for (const ins of plan.insertions) {
      changes.push({
        id: `c-links-${linkChangeIndex++}`, kind: 'insert-links', path: file,
        label: `link ${ins.original} in ${file}`, rationale: 'first useful occurrence per section; protected quotations and code untouched',
        contentKey: contentKeyFor({ sourceSha: doc.source.sha256, path: file, kind: 'links', payload: `${ins.linkKey}@${ins.span.start}` }),
        evidenceIds: [], dependsOn: [...(article ? ['c-article'] : []), ...(ins.dependsOn ? [ins.dependsOn] : [])], category: 'link',
        insertLinks: { stage: article ? 'after-article' : 'before', insertions: [ins] },
      });
    }
  }

  const contradictions = findContradictions(bundle, doc, detection.candidates);

  for (const change of changes) {
    baseline[change.path] = bundle.byPath.get(change.path)?.sha256 ?? null;
  }

  const draft = {
    id: `p-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    profileId: config.profile.id,
    kbRoot: config.kb.root,
    sourceIds: [doc.source.id],
    sourceUris: [doc.source.uri],
    baseline,
    changes,
    evidence,
    contradictions,
    notes,
    conceptAssistLevel: detection.level,
    ...(analysis ? { analysis } : {}),
  };

  const proposal: Proposal = {
    ...draft,
    status: 'prepared',
    contentHash: computeProposalHash(draft),
  };

  return {
    proposal,
    candidates: detection.candidates,
    corrections,
    skipped,
    conceptAssistLevel: detection.level,
  };
}

function contentKeyFor(parts: {
  sourceSha: string;
  path: string;
  kind: string;
  payload: string;
}): string {
  return hashStructure(parts);
}

function renderEvidenceDigest(
  doc: NormalizedDoc,
  citeId: string,
  corrections: readonly Correction[],
): string {
  const lines: string[] = [
    `> **Aperçu partiel, non rédigé.** ${Math.min(12, doc.blocks.filter(b => b.kind !== 'heading').length)} extraits sur ${doc.blocks.length} blocs ; ce n’est pas une synthèse complète. Éléments rapportés, non vérifiés.`,
    '',
    `Source : ${doc.source.title ?? doc.source.uri} (${doc.source.kind}, support \`${doc.source.support}\`).[^${citeId}]`,
    '',
  ];

  const headings = doc.blocks.filter((b) => b.kind === 'heading').slice(0, 15);
  if (headings.length > 0) {
    lines.push('## Plan de la source', '');
    for (const h of headings) lines.push(`- ${h.text} — ${formatLocator(h.locator)}`);
    lines.push('');
  }

  lines.push('## Extraits', '');
  for (const block of doc.blocks.filter((b) => b.kind !== 'heading').slice(0, 12)) {
    const who = block.speaker ? `**${block.speaker}** — ` : '';
    lines.push(`> ${who}${block.text.split('\n').join('\n> ')}\n>\n> (${formatLocator(block.locator)})[^${citeId}]`, '');
  }
  lines.push('');

  if (corrections.length > 0) {
    lines.push('## Corrections et exceptions relevées', '');
    for (const c of corrections.slice(0, 10)) {
      lines.push(
        `- [${c.marker}] ${c.quote.slice(0, 200)} *(${c.locator})*${c.correctedBlockId ? ` — corrige \`${c.correctedBlockId}\`` : ''}`,
      );
    }
    lines.push('');
  }

  if (doc.source.limitations.length > 0) {
    lines.push('## Limites de l\'extraction', '');
    for (const l of doc.source.limitations) lines.push(`- ${l}`);
    lines.push('');
  }

  lines.push(`[^${citeId}]: ${doc.source.title ?? doc.source.uri}`);
  return lines.join('\n');
}

function renderNewDocument(
  config: OkbConfig,
  doc: NormalizedDoc,
  title: string,
  markdown: string,
  citeId: string,
  analysis?: SourceAnalysis,
): string {
  const frontmatter = `---\n${YAML.stringify({
    type: 'Reference', title, description: `Notes extraites de ${doc.source.title ?? 'la source'}.`,
    tags: ['ingested'], status: 'draft', generated: { by: config.okf.machineActor, at: new Date().toISOString() },
    sources: mergeSources([], doc, analysis), x_okb: { v: 1 },
  }, { lineWidth: 0 })}---`;

  return `${frontmatter}\n\n${markdown.replace(/\s*$/, '')}\n`;
}

/**
 * Surface, never resolve. When an existing card states a different expansion for
 * the same acronym, both versions are shown to the reviewer; picking a winner is
 * a human decision.
 */
function findContradictions(
  bundle: Bundle,
  doc: NormalizedDoc,
  candidates: readonly ConceptCandidate[],
): Contradiction[] {
  const out: Contradiction[] = [];
  for (const candidate of candidates) {
    if (!candidate.expansionFromSource) continue;
    if (candidate.resolution.status !== 'existing') continue;
    const entry = bundle.byPath.get(candidate.resolution.path);
    const existing = bundle.docs.get(candidate.resolution.path);
    if (!entry || !existing) continue;

    const incoming = candidate.expansionFromSource.text.trim().toLowerCase();
    const body = existing.body.toLowerCase();
    if (body.includes(incoming)) continue;

    const existingDefinition = firstDefinitionLine(existing.body);
    if (!existingDefinition) continue;

    out.push({
      id: `contra-${candidate.canonical.replace(/\s+/g, '-')}`,
      path: candidate.resolution.path,
      existingClaim: existingDefinition.slice(0, 240),
      incomingClaim: `${candidate.surface} = ${candidate.expansionFromSource.text}`,
      evidenceIds: [`ev-${candidate.expansionFromSource.blockId.replace('#', '-')}`],
      resolution: 'undecided',
      note: `the source states an expansion that the existing card does not contain (source: ${doc.source.uri})`,
    });
  }
  return out;
}

function firstDefinitionLine(body: string): string | null {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;
    return trimmed;
  }
  return null;
}

export { asBundlePath };

function mergeSources(existing: unknown, doc: NormalizedDoc, analysis?: SourceAnalysis): Record<string, unknown>[] {
  const base = sourceCiteId(doc);
  const additions = [{ id: base, resource: sourceResource(doc), title: doc.source.title ?? 'Source' },
    ...(analysis?.sections.flatMap(s => s.claims).map(c => ({ id: `${base}-${c.id}`, resource: sourceResource(doc), title: doc.source.title ?? 'Source', x_okb_claim_kind: c.kind, x_okb_blocks: c.evidence.map(e => e.blockId) })) ?? [])];
  const sources = Array.isArray(existing) ? existing : [];
  return [...sources, ...additions.filter(a => !sources.some(s => s.id === a.id))];
}
