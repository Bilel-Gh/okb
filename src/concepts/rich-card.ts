import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { markdownLink } from '../links/portable.js';
import { nowIso } from '../okf/types.js';
import { renderAid, type Aid, type RichConcept } from '../pipeline/analysis.js';
import { formatLocator, type Block, type NormalizedDoc } from '../sources/types.js';
import { labelsFor, LANDMARKS } from '../style/labels.js';
import type { WritingStyle } from '../style/resolve.js';
import type { NoteTemplate } from '../templates/builtin.js';
import { sectionHeading } from '../templates/registry.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { OkbError } from '../util/errors.js';
import { sourceCiteId, sourceLabel, sourceResource } from './card.js';

export type RichCardInput = {
  readonly concept: RichConcept;
  readonly docs: readonly NormalizedDoc[];
  readonly style: WritingStyle;
  readonly template: NoteTemplate;
  readonly config: OkbConfig;
  readonly bundle: Bundle;
  readonly path: BundlePath;
  readonly domain?: string;
  /** Cards created by the same proposal (path → title), valid “see also” targets. */
  readonly siblings?: ReadonlyMap<BundlePath, string>;
};

/**
 * A concept card that teaches: one-sentence definition, an everyday analogy with
 * its limit, how it works, an example, a diagram, what not to confuse it with,
 * the exact excerpts behind it, and where to read next. Every fact carries a
 * footnote to a located excerpt; aids say which facts they rephrase.
 */
export function buildRichConceptCard(input: RichCardInput): string {
  const { concept, docs, style, template, config, path } = input;
  const owner = new Map<string, NormalizedDoc>(docs.flatMap((d) => d.blocks.map((b) => [b.id, d] as const)));
  const blocks = new Map<string, Block>(docs.flatMap((d) => d.blocks.map((b) => [b.id, b] as const)));
  const t = labelsFor(style.language);
  const emojis = style.emojis === 'landmarks';
  const mark = (emoji: string) => (emojis ? `${emoji} ` : '');

  const primary = owner.get(concept.evidence[0]!.blockId) ?? docs[0]!;
  const cited = new Set<NormalizedDoc>();
  const footnotes: string[] = [];
  const sourceEntries: Record<string, unknown>[] = [];
  const labelOf = new Map<string, string>();
  const cite = (id: string, kind: string, evidence: readonly { blockId: string; quote: string }[]) => {
    const doc = owner.get(evidence[0]!.blockId) ?? primary;
    const label = `${sourceCiteId(doc)}-${id}`;
    labelOf.set(id, label);
    const byDoc = new Map<NormalizedDoc, Set<string>>();
    for (const e of evidence) {
      const source = owner.get(e.blockId) ?? doc;
      cited.add(source);
      const locators = byDoc.get(source) ?? new Set<string>();
      locators.add(preciseLocator(source, blocks.get(e.blockId)!));
      byDoc.set(source, locators);
    }
    const located = [...byDoc].map(([source, locators]) => `${sourceLabel(source)} — ${[...locators].join('; ')}`);
    footnotes.push(`[^${label}]: ${located.join(' ; ')}. ${t.sourceId} : ${sourceCiteId(doc)}.`);
    sourceEntries.push({ id: label, resource: sourceResource(doc), title: sourceLabel(doc), x_okb_claim_kind: kind, x_okb_blocks: [...new Set(evidence.map((e) => e.blockId))] });
  };
  cite('definition', 'reported', concept.evidence);
  for (const claim of concept.sections.flatMap((s) => s.claims)) cite(claim.id, claim.kind, claim.evidence);
  const refs = (ids: readonly string[]) => ids.map((id) => `[^${labelOf.get(id)}]`).join('');
  const aidsOf = (type: Aid['type']) => concept.aids.filter((a) => a.type === type);
  const claimLines = (role: 'how' | 'pitfalls') => concept.sections
    .filter((s) => s.role === role)
    .flatMap((s) => s.claims.map((c) => `- ${c.kind === 'inferred' ? `**${t.inferred}** ` : ''}${c.text}[^${labelOf.get(c.id)}]`));

  const bodies = new Map<string, readonly string[]>();
  bodies.set('definition', [
    `**${concept.term}** — ${concept.definition.trim().replace(/\.$/, '')}.${refs(['definition'])}`,
    ...aidsOf('explanation').flatMap((aid) => ['', ...renderAid(aid, t, mark, refs)]),
  ]);
  bodies.set('analogy', aidsOf('analogy').flatMap((aid, i) => [...(i ? [''] : []), ...renderAid(aid, t, mark, refs)]));
  bodies.set('how', claimLines('how'));
  bodies.set('example', aidsOf('example').flatMap((aid, i) => [...(i ? [''] : []), ...renderAid(aid, t, mark, refs, true)]));
  bodies.set('diagram', aidsOf('diagram').flatMap((aid, i) => [...(i ? [''] : []), ...renderAid(aid, t, mark, refs, true)]));
  bodies.set('pitfalls', claimLines('pitfalls'));

  const quotes = concept.evidence.slice(0, 3).map((e) => {
    const doc = owner.get(e.blockId) ?? primary;
    const quoted = (e.displayQuote ?? e.quote).split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
    return `${quoted}\n>\n> — ${formatLocator(blocks.get(e.blockId)!.locator)}[^${sourceCiteId(doc)}]`;
  });
  bodies.set('source', quotes.flatMap((q, i) => (i ? ['', q] : [q])));

  // Local concept templates own headings and order just like article templates.
  // Do not silently discard supplied content or manufacture empty required roles.
  for (const [role, body] of bodies) {
    if (body.length && !template.sections.some((s) => s.role === role)) {
      throw new OkbError('E_INVALID', `concept "${concept.term}" supplies role "${role}", absent from its template`);
    }
  }
  const lines: string[] = [`> ${mark(LANDMARKS.notice)}${t.notice}`, ''];
  for (const section of template.sections) {
    const body = bodies.get(section.role) ?? [];
    if (!body.length) {
      if (section.required) throw new OkbError('E_INVALID', `concept "${concept.term}" requires role "${section.role}"`);
      continue;
    }
    lines.push(`## ${sectionHeading(section, style.language, emojis)}`, '', ...body, '');
  }

  const seeAlso = concept.seeAlso
    .map((p) => asBundlePath(p))
    .filter((p) => p !== path && (input.bundle.byPath.has(p) || input.siblings?.has(p)))
    .map((p) => `- ${markdownLink(path, p, input.bundle.byPath.get(p)?.title ?? input.siblings!.get(p)!)}`);
  if (seeAlso.length) lines.push(`## ${mark(LANDMARKS.seeAlso)}${t.seeAlso}`, '', ...seeAlso, '');

  for (const doc of new Set(concept.evidence.slice(0, 3).map((e) => owner.get(e.blockId) ?? primary))) {
    footnotes.push(`[^${sourceCiteId(doc)}]: ${sourceLabel(doc)}`);
  }

  const sources = [
    ...docs.filter((d) => cited.has(d))
      .map((d) => ({ id: sourceCiteId(d), resource: sourceResource(d), title: sourceLabel(d) })),
    ...sourceEntries,
  ];
  const frontmatter = YAML.stringify({
    type: template.okfType,
    title: concept.term,
    description: clip(concept.definition, 200),
    tags: ['concept', ...(input.domain ? [input.domain] : [])],
    status: 'draft',
    generated: { by: config.okf.machineActor, at: nowIso() },
    sources,
    x_okb: {
      v: 1,
      aliases: [...new Set([concept.term, ...concept.aliases])],
      ...(input.domain ? { domain: input.domain } : {}),
      template: template.id,
      writing: { preset: style.preset, language: style.language },
    },
  }, { lineWidth: 0 });
  return `---\n${frontmatter}---\n\n${[...lines, ...footnotes, ''].join('\n')}`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const short = flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return `${short.charAt(0).toUpperCase()}${short.slice(1)}.`;
}

function preciseLocator(doc: NormalizedDoc, block: Block): string {
  const loc = block.locator;
  if (loc.kind !== 'section') return formatLocator(loc);
  const pathParts = loc.path[0] === doc.source.title ? loc.path.slice(1) : [...loc.path];
  const line = loc.line !== undefined ? `l.${loc.line}` : '';
  return [pathParts.join(' › '), line].filter(Boolean).join(', ') || formatLocator(loc);
}
