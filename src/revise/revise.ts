import { randomUUID } from 'node:crypto';
import { visit } from 'unist-util-visit';
import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import { parseMarkdown } from '../markdown/ast.js';
import { parseOkf, serializeOkf } from '../okf/document.js';
import { verifiedList } from '../okf/types.js';
import { computeProposalHash, type Proposal } from '../proposal/model.js';
import type { WritingStyle } from '../style/resolve.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import type { BundlePath } from '../util/paths.js';

/** Frontmatter keys a revision may change. Everything else is provenance. */
const EDITABLE_KEYS = new Set(['title', 'description', 'tags']);

export type Protected = { readonly kind: 'quote' | 'code' | 'inline-code' | 'footnote' | 'citation'; readonly text: string };

export type RevisionCheck = {
  readonly kept: Readonly<Record<Protected['kind'], number>>;
  readonly missing: readonly Protected[];
  readonly frontmatterChanges: readonly string[];
};

/**
 * What a style change must leave intact: source quotations, code, footnote
 * definitions and every citation label. Teaching aids rendered as callouts
 * (`> [!TIP]`) and Mermaid diagrams are prose, so a revision may change them.
 */
export function protectedElements(body: string): Protected[] {
  const out: Protected[] = [];
  const tree = parseMarkdown(body);
  const slice = (node: any) => body.slice(node.position.start.offset, node.position.end.offset);
  visit(tree, (node: any) => {
    if (node.position?.start?.offset === undefined) return;
    if (node.type === 'blockquote') {
      const text = slice(node);
      // Teaching prose may change, but its citations and literal code remain
      // protected. Continue visiting children instead of dropping the subtree.
      if (/^>\s*\[!/.test(text) || isProductNotice(text)) return undefined;
      out.push({ kind: 'quote', text: normalizeQuote(text) });
      return 'skip';
    }
    if (node.type === 'code' && node.lang !== 'mermaid') out.push({ kind: 'code', text: String(node.value) });
    if (node.type === 'inlineCode') out.push({ kind: 'inline-code', text: String(node.value) });
    if (node.type === 'footnoteDefinition') out.push({ kind: 'footnote', text: slice(node).trim() });
    if (node.type === 'footnoteReference') out.push({ kind: 'citation', text: String(node.identifier) });
    return undefined;
  });
  return out;
}

export function checkRevision(beforeBody: string, afterBody: string): Omit<RevisionCheck, 'frontmatterChanges'> {
  const before = protectedElements(beforeBody);
  const after = protectedElements(afterBody);
  const present = (p: Protected) =>
    p.kind === 'citation' || p.kind === 'inline-code' || p.kind === 'code' || p.kind === 'footnote'
      ? after.some((a) => a.kind === p.kind && a.text === p.text)
      : after.some((a) => a.kind === 'quote' && a.text === p.text);
  const missing: Protected[] = [];
  const seen = new Set<string>();
  for (const p of before) {
    const key = `${p.kind}\u0000${p.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!present(p)) missing.push(p);
  }
  const kept = { quote: 0, code: 0, 'inline-code': 0, footnote: 0, citation: 0 } as Record<Protected['kind'], number>;
  for (const key of seen) kept[key.split('\u0000')[0] as Protected['kind']] += 1;
  for (const m of missing) kept[m.kind] -= 1;
  return { kept, missing };
}

export type RevisionInput = {
  readonly path: BundlePath;
  /** Revised Markdown: a body, or a full document whose frontmatter may only change title/description/tags. */
  readonly revised: string;
  readonly reason: string;
  readonly style?: WritingStyle;
};

/**
 * Prepare a replacement of one note, never written directly. The same approval,
 * staleness check, backup and rollback as any other proposal apply to it.
 */
export function proposeRevision(config: OkbConfig, bundle: Bundle, input: RevisionInput): { proposal: Proposal; check: RevisionCheck } {
  const beforeRaw = bundle.snapshot.files.get(input.path);
  if (beforeRaw === undefined) throw new OkbError('E_NOT_FOUND', `${input.path} does not exist`);
  const before = parseOkf(input.path, beforeRaw);
  if (before.reserved) throw new OkbError('E_INVALID', `${input.path} is a generated index; refresh it with okb nav instead`);

  const incoming = parseOkf(input.path, input.revised);
  const frontmatterChanges: string[] = [];
  let data = { ...before.data };
  if (incoming.hasFrontmatter) {
    const keys = new Set([...Object.keys(before.data), ...Object.keys(incoming.data)]);
    for (const key of keys) {
      if (JSON.stringify(before.data[key]) === JSON.stringify(incoming.data[key])) continue;
      if (!EDITABLE_KEYS.has(key)) {
        throw new OkbError('E_INVALID', `a revision cannot change frontmatter "${key}"`, {
          hint: 'Only title, description and tags may change; provenance, status and verification are managed by okb.',
        });
      }
      frontmatterChanges.push(key);
      data = { ...data, [key]: incoming.data[key] };
    }
  }

  const check = { ...checkRevision(before.body, incoming.body), frontmatterChanges };
  // The structure belongs to the note's template: prose may change, sections stay.
  const lostSections = sectionTitles(before.body).filter((h) => !sectionTitles(incoming.body).includes(h));
  if (lostSections.length) {
    throw new OkbError('E_INVALID', `the revision removes or renames section(s): ${lostSections.join(', ')}`, {
      hint: 'A style revision keeps every section heading (emojis aside); move content between sections instead.',
    });
  }
  if (check.missing.length) {
    throw new OkbError('E_INVALID', `the revision drops or alters ${check.missing.length} protected element(s)`, {
      detail: { missing: check.missing.slice(0, 20) },
      hint: 'Quotes, code, footnote definitions and citation labels must stay byte-identical; only prose may change.',
    });
  }
  if (incoming.body.trim() === before.body.trim() && !frontmatterChanges.length) {
    throw new OkbError('E_INVALID', 'the revision is identical to the current note');
  }

  // A reworded note was not the text a person verified: keep the history, clear
  // the current verification, mark it draft — the same rule as an appended section.
  const ext = (data.x_okb && typeof data.x_okb === 'object' ? { ...(data.x_okb as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const verified = verifiedList(before.data);
  if (verified.length) {
    ext.prior_verified = [...((ext.prior_verified as unknown[]) ?? []), ...verified];
    data = { ...data, verified: [] };
  }
  if (input.style) ext.writing = { preset: input.style.preset, language: input.style.language };
  data = { ...data, status: 'draft', x_okb: { v: 1, ...ext } };

  const withNewBody = parseOkf(input.path, before.hasFrontmatter ? beforeRaw.slice(0, before.bodyOffset) + incoming.body : incoming.body);
  const after = serializeOkf(withNewBody, data);

  const draft = {
    id: `p-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    profileId: config.profile.id,
    kbRoot: config.kb.root,
    sourceIds: [],
    sourceUris: [],
    baseline: { [input.path]: sha256(beforeRaw) },
    changes: [{
      id: 'c-revision',
      kind: 'replace-document' as const,
      path: input.path,
      label: `revise ${input.path}`,
      rationale: input.reason,
      contentKey: sha256(`${input.path}:${after}`),
      evidenceIds: [],
      dependsOn: [],
      category: 'article' as const,
      replaceDocument: { content: after },
    }],
    evidence: [],
    contradictions: [],
    notes: [
      `revision: ${input.reason}`,
      `protected elements kept: ${Object.entries(check.kept).map(([k, v]) => `${v} ${k}`).join(', ')}`,
      'prose changed only; no new source was read, so the revision cannot add facts — check the diff for that',
      ...(verified.length ? ['the note was verified: verification moved to x_okb.prior_verified, status set to draft'] : []),
    ],
    conceptAssistLevel: 'off',
  };
  return { proposal: { ...draft, status: 'prepared', contentHash: computeProposalHash(draft) }, check };
}

/** Level-2 headings, compared without landmark emojis or case. */
function sectionTitles(body: string): string[] {
  return [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]!.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').trim());
}

function normalizeQuote(text: string): string {
  return text.split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

const NOTICES = [
  'Source rapportée ; les déductions sont signalées. Aucune vérification technique automatique.',
  'Reported by the source; deductions are marked. No automatic technical verification.',
];
function isProductNotice(text: string): boolean {
  const inner = text.replace(/^>\s?/gm, '').replace(/^ℹ️\s*/, '').trim();
  return NOTICES.includes(inner);
}
