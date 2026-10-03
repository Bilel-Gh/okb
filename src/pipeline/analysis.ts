import { z } from 'zod';
import { OkbError } from '../util/errors.js';
import { formatLocator, type NormalizedDoc } from '../sources/types.js';
import { sourceCiteId } from '../concepts/card.js';

const support = z.object({ blockId: z.string(), quote: z.string().min(1) }).strict();
export const analysisSchema = z.object({
  version: z.literal(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedBlockIds: z.array(z.string()),
  summary: z.string().default(''),
  sections: z.array(z.object({
    heading: z.string().min(1),
    claims: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      text: z.string().min(1),
      kind: z.enum(['reported', 'inferred']),
      evidence: z.array(support).min(1),
    }).strict()).min(1),
  }).strict()).min(1),
  concepts: z.array(z.object({
    term: z.string().min(2), definition: z.string().min(5), evidence: z.array(support).min(1),
  }).strict()).default([]),
  corrections: z.array(z.object({ earlierBlockId: z.string().optional(), laterBlockId: z.string(), note: z.string().min(1) }).strict()).default([]),
  openQuestions: z.array(z.string()).default([]),
}).strict();
export type SourceAnalysis = z.infer<typeof analysisSchema>;

/** This verifies coverage declarations and quote identity, not semantic truth. */
export function validateAnalysis(raw: unknown, doc: NormalizedDoc): SourceAnalysis {
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid analysis dossier', { detail: { issues: parsed.error.issues } });
  const a = parsed.data;
  if (a.sourceSha256 !== doc.source.sha256) throw new OkbError('E_STALE', 'analysis was written for different source bytes');
  const blocks = new Map(doc.blocks.map(b => [b.id, b]));
  const reviewed = new Set(a.reviewedBlockIds);
  if (reviewed.size !== blocks.size || [...blocks.keys()].some(id => !reviewed.has(id)) || a.reviewedBlockIds.length !== reviewed.size) {
    throw new OkbError('E_INVALID', 'analysis must account for every extracted block exactly once', { detail: { missing: [...blocks.keys()].filter(id => !reviewed.has(id)) } });
  }
  const claims = a.sections.flatMap(s => s.claims);
  if (new Set(claims.map(c => c.id)).size !== claims.length) throw new OkbError('E_INVALID', 'duplicate claim ids');
  for (const item of [...claims, ...a.concepts]) for (const ev of item.evidence) {
    if (!blocks.get(ev.blockId)?.text.includes(ev.quote)) throw new OkbError('E_INVALID', `quote is not a verbatim excerpt of ${ev.blockId}`);
  }
  for (const c of a.corrections) if (!blocks.has(c.laterBlockId) || (c.earlierBlockId && !blocks.has(c.earlierBlockId))) throw new OkbError('E_INVALID', 'correction references a nonexistent block');
  // An author may not supply raw frontmatter or self-issued verification.
  for (const c of claims) if (/^---\s*$/m.test(c.text) || /\[\^[^\]]+\]/.test(c.text)) throw new OkbError('E_INVALID', 'claim text must omit frontmatter and hand-written citation labels');
  return a;
}

export function renderAnalysis(a: SourceAnalysis, doc: NormalizedDoc): string {
  const base = sourceCiteId(doc);
  const blocks = new Map(doc.blocks.map(b => [b.id,b]));
  const lines = ['> Source rapportée ; les déductions sont signalées. Aucune vérification technique automatique.', ''];
  const footnotes: string[] = [];
  for (const section of a.sections) {
    lines.push(`## ${section.heading.replace(/[\r\n]/g, ' ')}`, '');
    for (const c of section.claims) {
      const label = `${base}-${c.id}`;
      lines.push(`- ${c.kind === 'inferred' ? '**Déduction :** ' : ''}${c.text}[^${label}]`);
      const locators = [...new Set(c.evidence.map(e => formatLocator(blocks.get(e.blockId)!.locator)))];
      footnotes.push(`[^${label}]: ${doc.source.title ?? 'Source'} — ${locators.join('; ')}. Source ID : ${base}.`);
    }
    lines.push('');
  }
  if (a.corrections.length) {
    lines.push('## Corrections et exceptions', '');
    for (const c of a.corrections) lines.push(`- ${c.note} (${formatLocator(blocks.get(c.laterBlockId)!.locator)}).`);
    lines.push('');
  }
  if (a.openQuestions.length) lines.push('## Questions ouvertes', '', ...a.openQuestions.map(q => `- ${q}`), '');
  return [...lines, ...footnotes, ''].join('\n');
}

export function analysisTemplate(doc: NormalizedDoc): unknown {
  return { version: 1, sourceSha256: doc.source.sha256, reviewedBlockIds: [], summary: '', sections: [], concepts: [], corrections: [], openQuestions: [] };
}
