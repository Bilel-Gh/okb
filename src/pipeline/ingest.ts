import YAML from 'yaml';
import { randomUUID } from 'node:crypto';
import { materializeFile } from '../proposal/materialize.js';
import { analysisRelated, renderAnalysis, validateAnalysis, type RichConcept, type SourceAnalysis } from './analysis.js';
import { buildRichConceptCard } from '../concepts/rich-card.js';
import { getTemplate } from '../templates/registry.js';
import type { NoteTemplate } from '../templates/builtin.js';
import { normalizeSurface } from '../kb/search.js';
import { lookup } from '../concepts/lexicon.js';
import type { OkbConfig } from '../config/schema.js';
import { buildConceptCard, conceptPathFor, sourceCiteId, sourceLabel, sourceResource } from '../concepts/card.js';
import { detectConcepts, type ConceptCandidate } from '../concepts/detect.js';
import { planLinkInjection, type LinkTarget } from '../concepts/inject.js';
import { buildPrereqChain } from '../concepts/prereq.js';
import { loadBundleFor, withPendingFiles, type Bundle } from '../kb/bundle.js';
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
  | { readonly mode: 'create'; readonly path: BundlePath; readonly title: string; readonly description?: string; readonly type?: string };

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
  /** Notes created by other prepared proposals this one builds on (path → content). */
  readonly pending?: { readonly files: ReadonlyMap<BundlePath, string>; readonly proposalIds: readonly string[] };
};

export type IngestReport = {
  readonly proposal: Proposal;
  readonly candidates: readonly ConceptCandidate[];
  readonly corrections: readonly Correction[];
  readonly skipped: readonly { readonly reason: string; readonly detail: string }[];
  readonly conceptAssistLevel: string;
};

/**
 * Build a proposal from one source, or from several when a version 2 dossier
 * synthesises them (e.g. a design note plus the code that implements it). The
 * first source is the primary one: it names the run and the evidence digest.
 */
export async function prepareProposal(
  config: OkbConfig,
  input: NormalizedDoc | readonly NormalizedDoc[],
  options: IngestOptions,
): Promise<IngestReport> {
  const docs: readonly NormalizedDoc[] = Array.isArray(input) ? (input as readonly NormalizedDoc[]) : [input as NormalizedDoc];
  const doc = docs[0];
  if (!doc) throw new OkbError('E_INVALID', 'no source given');
  if (new Set(docs.map((d) => d.source.sha256)).size !== docs.length) throw new OkbError('E_INVALID', 'the same source bytes are listed twice');
  for (const d of docs) if (d.source.support === 'unsupported' || !d.blocks.length) throw new OkbError('E_UNSUPPORTED', `source has no readable content; no proposal created (${d.source.uri})`);
  if (docs.length > 1 && options.analysis === undefined) throw new OkbError('E_INVALID', 'several sources need a version 2 analysis dossier; there is no multi-source raw digest');
  const templateId = (options.analysis as { template?: unknown } | undefined)?.template;
  const noteTemplate = typeof templateId === 'string' ? await getTemplate(config, templateId) : undefined;
  const analysis = options.analysis === undefined ? undefined : validateAnalysis(options.analysis, docs, noteTemplate ? { template: noteTemplate } : {});
  if (config.kb.requireTemplate && options.target.mode === 'create' && !noteTemplate) {
    throw new OkbError('E_INVALID', 'this knowledge bundle requires every new note to follow a template', {
      hint: 'Write a version 2 dossier with "template" (okb template list), so every note of a kind has the same sections.',
      key: 'templateRequired',
    });
  }
  const conceptTemplate = analysis?.version === 2 && analysis.concepts.length ? await getTemplate(config, 'concept') : undefined;
  const pendingFiles = options.pending?.files ?? new Map<BundlePath, string>();
  const bundle = withPendingFiles(await loadBundleFor(config), pendingFiles);
  if (options.target.mode === 'append' && pendingFiles.has(options.target.path)) {
    throw new OkbError('E_CONFLICT', `${options.target.path} only exists in a pending proposal`, { hint: 'Apply that proposal first, then append to the note.' });
  }
  for (const file of options.linkInto ?? []) {
    if (pendingFiles.has(file)) throw new OkbError('E_CONFLICT', `${file} only exists in a pending proposal; links cannot be planned into it yet`);
  }
  const owner = new Map<string, NormalizedDoc>(docs.flatMap((d) => d.blocks.map((b) => [b.id, d] as const)));
  const merged: NormalizedDoc = { source: doc.source, blocks: docs.flatMap((d) => d.blocks), outline: docs.flatMap((d) => d.outline) };
  const skipped: { reason: string; detail: string }[] = [];
  const evidence: Evidence[] = [];
  const changes: Change[] = [];
  const notes: string[] = [];
  const baseline: Record<string, string | null> = {};

  const citeId = sourceCiteId(doc);
  const corrections = docs.flatMap((d) => detectCorrections(d));

  for (const d of docs) {
    const prefix = docs.length > 1 ? `${sourceLabel(d)}: ` : '';
    for (const limitation of d.source.limitations) {
      notes.push(`${prefix}extraction limit: ${limitation}`);
    }
    if (d.source.support !== 'full') {
      notes.push(
        `${prefix}source support is "${d.source.support}" — parts of the document were not readable and nothing was invented to fill the gap`,
      );
    }
  }

  const digestBlocks = merged.blocks;
  for (const block of digestBlocks) {
    evidence.push({
      id: `ev-${block.id.replace('#', '-')}`,
      sourceId: owner.get(block.id)!.source.id,
      blockIds: [block.id],
      quote: block.text,
      locator: formatLocator(block.locator),
      claimKind: 'reported',
    });
  }

  const related = analysis ? analysisRelated(analysis) : [];
  const existingRelated = new Set<string>();
  for (const r of related) {
    const path = asBundlePath(r.path);
    if (path === options.target.path) throw new OkbError('E_INVALID', 'a note cannot list itself as related');
    if (bundle.byPath.has(path)) existingRelated.add(path);
    else notes.push(`related note ${path} does not exist yet; its link was left out (link it later with okb revise)`);
  }
  if (pendingFiles.size > 0) {
    notes.push(`may link to ${pendingFiles.size} note(s) that other prepared proposals create: apply those first, or combine them with this one (okb combine)`);
  }
  const renderable = analysis && analysis.version === 2
    ? { ...analysis, related: analysis.related.filter((r) => existingRelated.has(asBundlePath(r.path))) }
    : analysis;
  const articleMarkdown =
    renderable
      ? renderAnalysis(renderable, docs, { fromPath: options.target.path, titleOf: (p) => bundle.byPath.get(p)?.title, ...(noteTemplate ? { template: noteTemplate } : {}) })
      : options.sectionMarkdown ?? renderEvidenceDigest(doc, citeId, corrections);
  if (analysis?.version === 2) {
    const configured = config.writing.language ?? config.profile.answer.language;
    if (analysis.style.language !== configured || analysis.style.preset !== config.writing.preset) {
      notes.push(`written with a one-off style (preset ${analysis.style.preset}, language ${analysis.style.language}); the profile style was not changed`);
    }
  }
  if (!analysis) notes.push("raw evidence digest / legacy prose: not a complete semantic synthesis; use --analysis-file for coverage and citation checks");

  const articleKey = contentKeyFor({
    sourceSha: docs.length === 1 ? doc.source.sha256 : docs.map((d) => d.source.sha256).sort().join('+'),
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
      sourceIds: docs.map((d) => d.source.id),
      sourceUris: docs.map((d) => d.source.uri),
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
      rationale: `new document built from ${docs.map((d) => d.source.uri).join(', ')}`,
      contentKey: articleKey,
      evidenceIds: evidence.map((e) => e.id),
      dependsOn: [],
      category: 'article',
      createDocument: {
        content: renderNewDocument(config, docs, options.target, articleMarkdown, analysis, [...existingRelated].filter((p) => related.some((r) => r.relation === 'prerequisite' && asBundlePath(r.path) === p)), noteTemplate),
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
      rationale: `section built from ${docs.map((d) => d.source.uri).join(', ')}`,
      contentKey: articleKey,
      evidenceIds: evidence.map((e) => e.id),
      dependsOn: [],
      category: 'article',
      appendSection: { heading: options.target.heading, markdown: articleMarkdown },
      patchFrontmatter: { patch: { sources: mergeSources(targetDoc?.data.sources, docs, analysis), status: 'draft', ...(targetDoc && verifiedList(targetDoc.data).length ? { verified: [], x_okb: { ...(targetDoc.data.x_okb as Record<string,unknown> ?? {}), prior_verified: [...((targetDoc.data.x_okb as any)?.prior_verified ?? []), ...verifiedList(targetDoc.data)] } } : {}) } },
    });
  }

  const detection = detectConcepts(merged, bundle, config, {
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
        evidenceQuotes: term.evidence,
        ...(analysis.version === 2 ? { rich: term as RichConcept } : {}),
      };
      const index = detection.candidates.findIndex(c => c.canonical === canonical);
      if (index >= 0) detection.candidates[index] = candidate;
      else detection.candidates.push(candidate);
    }
    // Sourced definitions chosen by the dossier author come before heuristic
    // guesses, so the suggestion limit never drops them in favour of noise.
    const authored = new Set(analysis.concepts.map((t) => normalizeSurface(t.term)));
    detection.candidates = [
      ...detection.candidates.filter((c) => authored.has(c.canonical)),
      ...detection.candidates.filter((c) => !authored.has(c.canonical)),
    ].slice(0, config.conceptAssist.limits.maxSuggestionsPerSource);
  }

  const takenPaths = new Set<string>(bundle.entries.map((e) => e.path as string));
  const linkTargets: LinkTarget[] = [];
  const richCards: { changeId: string; path: BundlePath; content: string }[] = [];
  // Cards created together may name each other in “see also”: reserve their paths
  // in the order the loop below assigns them.
  const siblings = new Map<BundlePath, string>();
  {
    const taken = new Set(takenPaths);
    for (const c of detection.candidates) {
      if (c.resolution.status !== 'missing' || !c.rich || !c.expansionFromSource) continue;
      const reserved = conceptPathFor(config, c.surface, taken);
      taken.add(reserved);
      siblings.set(reserved, c.rich.term);
    }
  }

  for (const [i, candidate] of detection.candidates.entries()) {
    if (candidate.resolution.status === 'ambiguous') {
      notes.push(
        `"${candidate.surface}" is ambiguous (${candidate.resolution.options.map((o) => o.path).join(', ')}); no link was proposed`,
      );
      continue;
    }

    if (candidate.resolution.status === 'existing') {
      linkTargets.push({
        surfaces: [candidate.surface, ...(candidate.rich?.aliases ?? [])],
        canonical: candidate.canonical,
        target: candidate.resolution.path,
      });
      continue;
    }

    // A v2 dossier names its concept cards: a heuristic guess (an acronym and its
    // expansion found in the text) stays a suggestion instead of a thin card that
    // would not follow the concept template.
    if (analysis?.version === 2 && !candidate.rich) {
      notes.push(`"${candidate.surface}": possible concept card; add it to the dossier's concepts to create it`);
      continue;
    }

    if (!candidate.expansionFromSource || candidate.resolution.status === 'needs-clarification') {
      notes.push(`"${candidate.surface}": clarification needed; candidate retained in the proposal, no empty concept card created`);
      continue;
    }

    const path = conceptPathFor(config, candidate.surface, takenPaths);
    takenPaths.add(path);
    const prereqChain = { order: [] as BundlePath[] }; // prerequisites require evidence for this concept; never copy the article's graph

    const cardDoc = owner.get(candidate.evidenceBlockIds[0] ?? candidate.firstBlockId) ?? doc;
    const richContent = candidate.rich && conceptTemplate && analysis?.version === 2
      ? buildRichConceptCard({ concept: candidate.rich, docs, style: analysis.style, template: conceptTemplate, config, bundle, path, siblings, ...(options.domain ? { domain: options.domain } : {}) })
      : undefined;
    const card = richContent ? { content: richContent, needsClarification: false } : buildConceptCard({
      candidate,
      doc: cardDoc,
      otherDocs: docs.filter((d) => d !== cardDoc),
      bundle,
      config,
      path,
      prereqs: prereqChain.order,
      ...(options.domain ? { domain: options.domain } : {}),
    });

    // The line limit guards short auto-generated cards; a template card is bounded by its schema.
    if (!richContent && card.content.split('---').slice(2).join('---').split('\n').length > config.conceptAssist.limits.maxCardLines) {
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
        sourceSha: cardDoc.source.sha256,
        path,
        kind: 'concept-card',
        payload: candidate.canonical,
      }),
      evidenceIds: [...new Set([
        ...candidate.evidenceBlockIds,
        ...(candidate.rich?.sections.flatMap((s) => s.claims.flatMap((c) => c.evidence.map((e) => e.blockId))) ?? []),
      ])].map((b) => `ev-${b.replace('#', '-')}`),
      dependsOn: [],
      category: 'concept-card',
      createDocument: { content: card.content },
    });
    if (richContent) richCards.push({ changeId, path, content: richContent });

    if (!card.needsClarification) {
      linkTargets.push({
        surfaces: [candidate.surface, ...(candidate.rich?.aliases ?? [])],
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

  // Any concept card the bundle already knows (or a pending proposal creates) is a
  // link target when the written text mentions it, under its title or an alias.
  // One target per card, so a card is not linked twice through two spellings.
  if (detection.level !== 'off') {
    const conceptPrefix = `${config.kb.layout.concepts.replace(/\/$/, '')}/`;
    for (const term of detection.lexicon.byCanonical.values()) {
      const sense = term.senses[0];
      if (term.ambiguous || !sense || !sense.path.startsWith(conceptPrefix)) continue;
      linkTargets.push({ surfaces: term.surfaces, canonical: term.canonical, target: sense.path });
    }
  }
  const byTarget = new Map<string, LinkTarget>();
  for (const target of linkTargets) {
    const known = byTarget.get(target.target);
    byTarget.set(target.target, known
      ? { ...known, surfaces: [...new Set([...known.surfaces, ...target.surfaces])], ...(known.dependsOn ?? target.dependsOn ? { dependsOn: known.dependsOn ?? target.dependsOn! } : {}) }
      : target);
  }
  linkTargets.splice(0, linkTargets.length, ...byTarget.values());

  const linkFiles = [...new Set([options.target.path, ...(options.linkInto ?? [])])];
  let linkChangeIndex = 0;
  // New concept cards link to each other and to known cards, like the article.
  for (const card of richCards) {
    const plan = planLinkInjection(card.path, card.content, linkTargets.filter((t) => t.target !== card.path), config.conceptAssist.limits);
    for (const ins of plan.insertions) {
      changes.push({
        id: `c-links-${linkChangeIndex++}`, kind: 'insert-links', path: card.path,
        label: `link ${ins.original} in ${card.path}`, rationale: 'first useful occurrence; quotations and code untouched',
        contentKey: contentKeyFor({ sourceSha: doc.source.sha256, path: card.path, kind: 'links', payload: `${ins.linkKey}@${ins.span.start}` }),
        evidenceIds: [], dependsOn: [card.changeId, ...(ins.dependsOn ? [ins.dependsOn] : [])], category: 'link',
        insertLinks: { stage: 'before', insertions: [ins] },
      });
    }
  }
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
    sourceIds: docs.map((d) => d.source.id),
    sourceUris: docs.map((d) => d.source.uri),
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
    `Source : ${sourceLabel(doc)} (${doc.source.kind}, support \`${doc.source.support}\`).[^${citeId}]`,
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

  lines.push(`[^${citeId}]: ${sourceLabel(doc)}`);
  return lines.join('\n');
}

function renderNewDocument(
  config: OkbConfig,
  docs: readonly NormalizedDoc[],
  target: Extract<IngestTarget, { mode: 'create' }>,
  markdown: string,
  analysis: SourceAnalysis | undefined,
  prereqs: readonly string[],
  template?: NoteTemplate,
): string {
  const doc = docs[0]!;
  const style = analysis?.version === 2 ? analysis.style : undefined;
  const frontmatter = `---\n${YAML.stringify({
    type: target.type ?? template?.okfType ?? 'Reference', title: target.title,
    description: target.description ?? `Notes extraites de ${doc.source.title ?? 'la source'}.`,
    tags: ['ingested'], status: 'draft', generated: { by: config.okf.machineActor, at: new Date().toISOString() },
    sources: mergeSources([], docs, analysis),
    // The style a note was written in, so a later style change can list notes
    // worth revising instead of silently rewriting the whole bundle.
    x_okb: { v: 1, ...(template ? { template: template.id } : {}), ...(style ? { writing: { preset: style.preset, language: style.language } } : {}), ...(prereqs.length ? { prereqs: [...prereqs] } : {}) },
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

function mergeSources(existing: unknown, docs: readonly NormalizedDoc[], analysis?: SourceAnalysis): Record<string, unknown>[] {
  const owner = new Map<string, NormalizedDoc>(docs.flatMap((d) => d.blocks.map((b) => [b.id, d] as const)));
  const additions = [...docs.map((d) => ({ id: sourceCiteId(d), resource: sourceResource(d), title: sourceLabel(d) })),
    ...(analysis?.sections.flatMap(s => s.claims).map(c => {
      const d = owner.get(c.evidence[0]!.blockId) ?? docs[0]!;
      return { id: `${sourceCiteId(d)}-${c.id}`, resource: sourceResource(d), title: sourceLabel(d), x_okb_claim_kind: c.kind, x_okb_blocks: [...new Set(c.evidence.map(e => e.blockId))] };
    }) ?? [])];
  const sources = Array.isArray(existing) ? existing : [];
  return [...sources, ...additions.filter(a => !sources.some(s => s.id === a.id))];
}
