import { z } from 'zod';
import { OkbError } from '../util/errors.js';
import { formatLocator, type Block, type NormalizedDoc } from '../sources/types.js';
import { sourceCiteId, sourceLabel } from '../concepts/card.js';
import { markdownLink } from '../links/portable.js';
import { resolvedStyleSchema, type WritingStyle } from '../style/resolve.js';
import { labelsFor, LANDMARKS, type Labels } from '../style/labels.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { sectionHeading } from '../templates/registry.js';
import type { NoteTemplate } from '../templates/builtin.js';

const support = z.object({ blockId: z.string(), quote: z.string().min(1) }).strict();
const conceptSupport = support.extend({
  /** Optional shorter excerpt for publication; the full quote remains evidence. */
  displayQuote: z.string().min(1).refine((text) => text.trim().length > 0, 'displayQuote must not be blank').optional(),
}).strict();
const claimSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  text: z.string().min(1),
  kind: z.enum(['reported', 'inferred']),
  evidence: z.array(support).min(1),
}).strict();
const conceptSchema = z.object({
  term: z.string().min(2), definition: z.string().min(5), evidence: z.array(conceptSupport).min(1),
}).strict();
const correctionSchema = z.object({ earlierBlockId: z.string().optional(), laterBlockId: z.string(), note: z.string().min(1) }).strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/);

export const analysisSchemaV1 = z.object({
  version: z.literal(1),
  sourceSha256: sha,
  reviewedBlockIds: z.array(z.string()),
  summary: z.string().default(''),
  sections: z.array(z.object({
    heading: z.string().min(1),
    claims: z.array(claimSchema).min(1),
  }).strict()).min(1),
  concepts: z.array(conceptSchema).default([]),
  corrections: z.array(correctionSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
}).strict();
/** Kept under its historical name: version 1 dossiers are still accepted unchanged. */
export const analysisSchema = analysisSchemaV1;

/**
 * Teaching aids. They make claims easier to understand; they are never evidence.
 * Each one names the claims it rephrases, so a reviewer can check it adds nothing.
 */
const basedOn = z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1);
const placement = z.enum(['before', 'after']).optional();
export const aidSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('explanation'), text: z.string().min(1).max(1500), basedOn, placement }).strict(),
  z.object({ type: z.literal('analogy'), text: z.string().min(1).max(900), limits: z.string().min(5).max(600), basedOn, placement }).strict(),
  z.object({ type: z.literal('diagram'), mermaid: z.string().min(1).max(4000), caption: z.string().max(300).default(''), basedOn, placement }).strict(),
  z.object({ type: z.literal('example'), text: z.string().min(1).max(1500), basedOn, placement }).strict(),
]);
export type Aid = z.infer<typeof aidSchema>;

const relatedSchema = z.object({
  path: z.string().min(1),
  relation: z.enum(['prerequisite', 'next', 'deeper']),
  why: z.string().max(240).default(''),
  /** Used when the target is created by a later proposal and has no title yet. */
  title: z.string().max(160).optional(),
}).strict();
export type Related = z.infer<typeof relatedSchema>;

/**
 * A concept written for a reader, not just named: aliases for linking and search,
 * sourced claims about how it works and what not to confuse it with, and aids.
 * Aids may rephrase the definition itself (`basedOn: ["definition"]`).
 */
const richConceptSchema = conceptSchema.extend({
  aliases: z.array(z.string().min(2).max(60)).max(8).default([]),
  sections: z.array(z.object({
    role: z.enum(['how', 'pitfalls']),
    claims: z.array(claimSchema).min(1),
  }).strict()).default([]),
  aids: z.array(aidSchema).default([]),
  /** Existing or pending notes worth reading next. */
  seeAlso: z.array(z.string().min(1)).max(8).default([]),
}).strict();
export type RichConcept = z.infer<typeof richConceptSchema>;

export const analysisSchemaV2 = z.object({
  version: z.literal(2),
  /** Note template the dossier follows (`okb template list`). */
  template: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  /** sha256 of every source the dossier draws on; the first one is the primary source. */
  sources: z.array(sha).min(1),
  /** The resolved style used to write this dossier (`okb style --json` → style). */
  style: resolvedStyleSchema,
  reviewedBlockIds: z.array(z.string()),
  summary: z.string().default(''),
  sections: z.array(z.object({
    /** A template role (heading supplied by the template) … */
    role: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
    /** … or a free section with its own heading. */
    heading: z.string().min(1).optional(),
    claims: z.array(claimSchema).default([]),
    aids: z.array(aidSchema).default([]),
  }).strict()).min(1),
  concepts: z.array(richConceptSchema).default([]),
  corrections: z.array(correctionSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  related: z.array(relatedSchema).default([]),
}).strict();

export type AnalysisV1 = z.infer<typeof analysisSchemaV1>;
export type AnalysisV2 = z.infer<typeof analysisSchemaV2>;
export type SourceAnalysis = AnalysisV1 | AnalysisV2;
type Claim = z.infer<typeof claimSchema>;

const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|block-beta|architecture-beta)\b/;

function asDocs(input: NormalizedDoc | readonly NormalizedDoc[]): readonly NormalizedDoc[] {
  return Array.isArray(input) ? (input as readonly NormalizedDoc[]) : [input as NormalizedDoc];
}

export function analysisSources(a: SourceAnalysis): string[] {
  return a.version === 1 ? [a.sourceSha256] : [...a.sources];
}
export function sectionAids(section: SourceAnalysis['sections'][number]): readonly Aid[] {
  return 'aids' in section ? section.aids : [];
}
export function analysisRelated(a: SourceAnalysis): readonly Related[] {
  return a.version === 2 ? a.related : [];
}

/**
 * This verifies coverage declarations, quote identity and the wiring of aids to
 * claims — not semantic truth, and not whether an analogy is a good one.
 */
export function validateAnalysis(raw: unknown, input: NormalizedDoc | readonly NormalizedDoc[], options: { template?: NoteTemplate } = {}): SourceAnalysis {
  const docs = asDocs(input);
  const version = (raw as { version?: unknown } | null)?.version;
  const parsed = version === 2 ? analysisSchemaV2.safeParse(raw) : analysisSchemaV1.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid analysis dossier', { detail: { issues: parsed.error.issues } });
  const a: SourceAnalysis = parsed.data;

  const declared = analysisSources(a);
  if (a.version === 1 && docs.length !== 1) throw new OkbError('E_INVALID', 'a version 1 dossier covers exactly one source; use version 2 for several');
  if (new Set(declared).size !== declared.length) throw new OkbError('E_INVALID', 'a source is listed twice in the dossier');
  const actual = docs.map((d) => d.source.sha256);
  if (declared.length !== actual.length || declared.some((s) => !actual.includes(s))) {
    throw new OkbError('E_STALE', 'analysis was written for different source bytes', { detail: { declared, extracted: actual } });
  }

  const blocks = new Map(docs.flatMap((d) => d.blocks.map((b) => [b.id, b] as const)));
  const reviewed = new Set(a.reviewedBlockIds);
  if (reviewed.size !== blocks.size || [...blocks.keys()].some(id => !reviewed.has(id)) || a.reviewedBlockIds.length !== reviewed.size) {
    throw new OkbError('E_INVALID', 'analysis must account for every extracted block exactly once', { detail: { missing: [...blocks.keys()].filter(id => !reviewed.has(id)) } });
  }
  const claims = a.sections.flatMap(s => s.claims);
  if (!claims.length) throw new OkbError('E_INVALID', 'a dossier needs at least one sourced claim');
  const conceptClaims = a.version === 2 ? a.concepts.flatMap((c) => c.sections.flatMap((s) => s.claims)) : [];
  const allClaims = [...claims, ...conceptClaims];
  const dupes = allClaims.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) throw new OkbError('E_INVALID', `duplicate claim ids: ${[...new Set(dupes)].join(', ')}`, { hint: 'Claim ids are unique across sections and concepts.' });
  for (const item of [...allClaims, ...a.concepts]) for (const ev of item.evidence) {
    if (!blocks.get(ev.blockId)?.text.includes(ev.quote)) throw new OkbError('E_INVALID', `quote is not a verbatim excerpt of ${ev.blockId}`);
  }
  for (const concept of a.concepts) for (const ev of concept.evidence) {
    if (ev.displayQuote !== undefined && !ev.quote.includes(ev.displayQuote)) {
      throw new OkbError('E_INVALID', `displayQuote is not a verbatim excerpt of the full quote for ${ev.blockId}`);
    }
  }
  for (const c of a.corrections) if (!blocks.has(c.laterBlockId) || (c.earlierBlockId && !blocks.has(c.earlierBlockId))) throw new OkbError('E_INVALID', 'correction references a nonexistent block');
  // An author may not supply raw frontmatter or self-issued verification.
  const forged = (text: string) => /^---\s*$/m.test(text) || /\[\^[^\]]+\]/.test(text);
  for (const c of allClaims) if (forged(c.text)) throw new OkbError('E_INVALID', 'claim text must omit frontmatter and hand-written citation labels');

  if (a.version === 2) {
    const ids = new Set(claims.map((c) => c.id));
    const checkAid = (aid: Aid, where: string, known: ReadonlySet<string>) => {
      const missing = aid.basedOn.filter((id) => !known.has(id));
      if (missing.length) throw new OkbError('E_INVALID', `${aid.type} in "${where}" is based on unknown claims: ${missing.join(', ')}`);
      if (aid.type === 'analogy' && a.style.analogies === 'off') throw new OkbError('E_INVALID', 'the recorded style turns analogies off, yet the dossier contains one');
      if (aid.type === 'example' && a.style.examples === 'none') throw new OkbError('E_INVALID', 'the recorded style turns examples off, yet the dossier contains one');
      if (aid.type === 'diagram') {
        if (a.style.diagrams === 'off') throw new OkbError('E_INVALID', 'the recorded style turns diagrams off, yet the dossier contains one');
        if (aid.mermaid.includes('```') || !MERMAID_START.test(aid.mermaid.trim())) throw new OkbError('E_INVALID', `diagram in "${where}" must be bare Mermaid code starting with a diagram type`);
      }
      const texts = aid.type === 'diagram' ? [aid.caption] : aid.type === 'analogy' ? [aid.text, aid.limits] : [aid.text];
      if (texts.some(forged)) throw new OkbError('E_INVALID', 'aid text must omit frontmatter and hand-written citation labels');
    };
    for (const section of a.sections) {
      const where = section.heading ?? section.role ?? 'section';
      if (!section.claims.length && !section.aids.length) throw new OkbError('E_INVALID', `section "${where}" is empty`);
      for (const aid of section.aids) checkAid(aid, where, ids);
    }
    for (const concept of a.concepts) {
      const roles = concept.sections.map((s) => s.role);
      if (new Set(roles).size !== roles.length) throw new OkbError('E_INVALID', `concept "${concept.term}" repeats a section role`);
      if (concept.sections.some((s) => s.claims.some((c) => c.id === 'definition'))) {
        throw new OkbError('E_INVALID', `concept "${concept.term}" uses reserved claim id "definition"`);
      }
      const own = new Set(['definition', ...concept.sections.flatMap((s) => s.claims.map((c) => c.id))]);
      for (const aid of concept.aids) checkAid(aid, concept.term, own);
      if (forged(concept.definition) || forged(concept.term)) throw new OkbError('E_INVALID', 'a concept term or definition must omit frontmatter and hand-written citation labels');
      for (const target of concept.seeAlso) {
        if (!asBundlePath(target).endsWith('.md')) throw new OkbError('E_INVALID', `concept related target must be a Markdown note: ${target}`);
      }
    }
    checkTemplate(a, options.template);
    for (const r of a.related) {
      const path = asBundlePath(r.path);
      if (!path.endsWith('.md')) throw new OkbError('E_INVALID', `related target must be a Markdown note: ${r.path}`);
    }
  }
  return a;
}

/**
 * A template fixes which sections exist and in what order. Role sections take
 * the template heading; free sections bring their own and sit anywhere.
 */
function checkTemplate(a: AnalysisV2, template: NoteTemplate | undefined): void {
  if (a.template === undefined) {
    for (const section of a.sections) {
      if (section.role !== undefined || section.heading === undefined) {
        throw new OkbError('E_INVALID', 'without a template every section needs a heading and no role', { hint: 'Add "template" to the dossier (okb template list) or give each section a heading.' });
      }
    }
    return;
  }
  if (!template || template.id !== a.template) throw new OkbError('E_INVALID', `template "${a.template}" was not loaded`);
  if (template.id === 'concept') throw new OkbError('E_INVALID', 'the concept template is for the dossier concepts array, not for a whole note');
  const roles = template.sections.map((s) => s.role);
  let last = -1;
  const seen = new Set<string>();
  for (const section of a.sections) {
    if (section.role === undefined) {
      if (section.heading === undefined) throw new OkbError('E_INVALID', 'a free section needs a heading');
      continue;
    }
    if (section.heading !== undefined) throw new OkbError('E_INVALID', `section "${section.role}" takes its heading from the template; remove "heading"`);
    const index = roles.indexOf(section.role);
    if (index < 0) throw new OkbError('E_INVALID', `template "${template.id}" has no role "${section.role}"`, { hint: `Roles: ${roles.join(', ')}` });
    if (seen.has(section.role)) throw new OkbError('E_INVALID', `role "${section.role}" appears twice`);
    if (index < last) throw new OkbError('E_INVALID', `role "${section.role}" is out of order for template "${template.id}"`, { hint: `Order: ${roles.join(' → ')}` });
    seen.add(section.role);
    last = index;
  }
  const missing = template.sections.filter((s) => s.required && !seen.has(s.role)).map((s) => s.role);
  if (missing.length) throw new OkbError('E_INVALID', `template "${template.id}" requires: ${missing.join(', ')}`);
}

export type RenderContext = {
  /** Path of the note the rendered Markdown lands in; relative links start here. */
  readonly fromPath?: BundlePath;
  /** Title lookup for related notes that already exist. */
  readonly titleOf?: (path: BundlePath) => string | undefined;
  /** Template the dossier follows; role sections take its headings. */
  readonly template?: NoteTemplate;
  /** Replaces the generic opening notice (e.g. "written from the code at commit …"). */
  readonly notice?: string;
};

export function renderAnalysis(a: SourceAnalysis, input: NormalizedDoc | readonly NormalizedDoc[], context: RenderContext = {}): string {
  const docs = asDocs(input);
  const owner = new Map<string, NormalizedDoc>(docs.flatMap((d) => d.blocks.map((b) => [b.id, d] as const)));
  const blocks = new Map<string, Block>(docs.flatMap((d) => d.blocks.map((b) => [b.id, b] as const)));
  // Version 1 output is frozen byte for byte: existing proposals and tests depend on it.
  const style: WritingStyle | null = a.version === 2 ? a.style : null;
  const t: Labels = labelsFor(style?.language ?? 'fr');
  const mark = (emoji: string) => (style?.emojis === 'landmarks' ? `${emoji} ` : '');

  const labelOf = new Map<string, string>();
  const footnotes: string[] = [];
  for (const c of a.sections.flatMap((s) => s.claims)) {
    const primary = owner.get(c.evidence[0]!.blockId) ?? docs[0]!;
    const label = `${sourceCiteId(primary)}-${c.id}`;
    labelOf.set(c.id, label);
    footnotes.push(`[^${label}]: ${footnoteText(c, primary, owner, blocks, t, style !== null)}`);
  }
  const refs = (ids: readonly string[]) => ids.map((id) => `[^${labelOf.get(id)}]`).join('');

  const lines = style ? [`> ${mark(LANDMARKS.notice)}${context.notice ?? t.notice}`, ''] : ['> Source rapportée ; les déductions sont signalées. Aucune vérification technique automatique.', ''];

  const related = analysisRelated(a);
  const link = (r: Related) => {
    const target = asBundlePath(r.path);
    const title = context.titleOf?.(target) ?? r.title ?? target.split('/').pop()!.replace(/\.md$/, '');
    return context.fromPath ? markdownLink(context.fromPath, target, title) : title;
  };
  const before = related.filter((r) => r.relation === 'prerequisite');
  if (before.length) lines.push(`${mark(LANDMARKS.readFirst)}**${t.readFirst}** ${before.map(link).join(' · ')}`, '');

  for (const section of a.sections) {
    const templateSection = 'role' in section && section.role ? context.template?.sections.find((t) => t.role === section.role) : undefined;
    const heading = templateSection
      ? sectionHeading(templateSection, style?.language ?? 'fr', style?.emojis === 'landmarks')
      : (section.heading ?? '').replace(/[\r\n]/g, ' ');
    lines.push(`## ${heading}`, '');
    const aids = sectionAids(section);
    const placed = (where: 'before' | 'after') => aids.filter((aid) => (aid.placement ?? defaultPlacement(aid)) === where);
    const bare = (aid: Aid) => 'role' in section && section.role === aid.type;
    for (const aid of placed('before')) lines.push(...renderAid(aid, t, mark, refs, bare(aid)), '');
    if (section.claims.length) {
      for (const c of section.claims) lines.push(`- ${c.kind === 'inferred' ? `**${t.inferred}** ` : ''}${c.text}[^${labelOf.get(c.id)}]`);
      lines.push('');
    }
    for (const aid of placed('after')) lines.push(...renderAid(aid, t, mark, refs, bare(aid)), '');
  }
  if (a.corrections.length) {
    lines.push(`## ${mark(LANDMARKS.corrections)}${t.corrections}`, '');
    for (const c of a.corrections) lines.push(`- ${c.note} (${formatLocator(blocks.get(c.laterBlockId)!.locator)}).`);
    lines.push('');
  }
  if (a.openQuestions.length) lines.push(`## ${mark(LANDMARKS.openQuestions)}${t.openQuestions}`, '', ...a.openQuestions.map(q => `- ${q}`), '');
  const after = related.filter((r) => r.relation !== 'prerequisite');
  if (after.length) lines.push(`## ${mark(LANDMARKS.goingFurther)}${t.goingFurther}`, '', ...after.map((r) => `- ${link(r)}${r.why ? ` — ${r.why}` : ''}`), '');
  return [...lines, ...footnotes, ''].join('\n');
}

function footnoteText(c: Claim, primary: NormalizedDoc, owner: Map<string, NormalizedDoc>, blocks: Map<string, Block>, t: Labels, precise: boolean): string {
  const byDoc = new Map<NormalizedDoc, Set<string>>();
  for (const e of c.evidence) {
    const doc = owner.get(e.blockId) ?? primary;
    const set = byDoc.get(doc) ?? new Set<string>();
    const block = blocks.get(e.blockId)!;
    set.add(precise ? preciseLocator(doc, block) : formatLocator(block.locator));
    byDoc.set(doc, set);
  }
  const parts = [...byDoc].map(([doc, locators]) => `${sourceLabel(doc)} — ${[...locators].join('; ')}`);
  return `${parts.join(' ; ')}. ${t.sourceId} : ${sourceCiteId(primary)}.`;
}

/**
 * "Overview, l.21" rather than "Extend Claude Code › Overview": the document
 * title already opens the footnote, and a line number lets a reader jump there.
 */
function preciseLocator(doc: NormalizedDoc, block: Block): string {
  const loc = block.locator;
  if (loc.kind !== 'section') return formatLocator(loc);
  const path = loc.path[0] === doc.source.title ? loc.path.slice(1) : [...loc.path];
  const line = loc.line !== undefined ? `l.${loc.line}` : '';
  return [path.join(' › '), line].filter(Boolean).join(', ') || formatLocator(loc);
}

function defaultPlacement(aid: Aid): 'before' | 'after' {
  return aid.type === 'explanation' || aid.type === 'analogy' ? 'before' : 'after';
}

/**
 * `bare` drops the aid's own label when the section heading already names it
 * ("## 💡 Example" does not need a second "💡 Example").
 */
export function renderAid(aid: Aid, t: Labels, mark: (e: string) => string, refs: (ids: readonly string[]) => string, bare = false): string[] {
  const quoted = (text: string) => text.split('\n').map((l) => (l.trim() ? `> ${l}` : '>'));
  if (bare && aid.type === 'example') return [`${aid.text.trim()}${refs(aid.basedOn)}`];
  if (bare && aid.type === 'diagram') return [`${aid.caption ? `*${aid.caption.trim()}*` : ''}${refs(aid.basedOn)}`, '', '```mermaid', aid.mermaid.trim(), '```'];
  switch (aid.type) {
    case 'explanation':
      return [`${aid.text.trim()}${refs(aid.basedOn)}`];
    case 'analogy':
      // GitHub alert syntax; Obsidian renders the same block as a callout.
      return ['> [!TIP]', ...quoted(`**${mark(LANDMARKS.analogy)}${t.analogy}** — ${aid.text.trim()}${refs(aid.basedOn)}`), '>', ...quoted(`**${t.limit}** ${aid.limits.trim()}`)];
    case 'example':
      return ['> [!NOTE]', ...quoted(`**${mark(LANDMARKS.example)}${t.example}** — ${aid.text.trim()}${refs(aid.basedOn)}`)];
    case 'diagram':
      return [`**${mark(LANDMARKS.diagram)}${t.diagram}**${aid.caption ? ` — ${aid.caption.trim()}` : ''}${refs(aid.basedOn)}`, '', '```mermaid', aid.mermaid.trim(), '```'];
  }
}

export function analysisTemplate(input: NormalizedDoc | readonly NormalizedDoc[], style?: WritingStyle, noteTemplate?: NoteTemplate): unknown {
  const docs = asDocs(input);
  if (!style && !noteTemplate && docs.length === 1) {
    return { version: 1, sourceSha256: docs[0]!.source.sha256, reviewedBlockIds: [], summary: '', sections: [], concepts: [], corrections: [], openQuestions: [] };
  }
  return {
    version: 2, ...(noteTemplate ? { template: noteTemplate.id } : {}), sources: docs.map((d) => d.source.sha256), ...(style ? { style } : {}),
    reviewedBlockIds: [], summary: '',
    // One empty section per template role, in order; drop the optional ones you do not need.
    sections: noteTemplate ? noteTemplate.sections.map((s) => ({ role: s.role, claims: [], aids: [] })) : [],
    concepts: [], corrections: [], openQuestions: [], related: [],
  };
}
