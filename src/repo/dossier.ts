import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { aidSchema } from '../pipeline/analysis.js';
import { resolvedStyleSchema } from '../style/resolve.js';
import { acquire, extractSource } from '../sources/registry.js';
import { buildOutline, type Block, type NormalizedDoc } from '../sources/types.js';
import { OkbError } from '../util/errors.js';
import { sha256, shortId } from '../util/hash.js';
import { isInside } from '../kb/registry.js';
import { mergeRanges, parseRange } from './state.js';

/**
 * Dossier version 3: knowledge about a code repository, cited the way people
 * cite code — `file` and `lines` — instead of OKB block ids. The CLI turns each
 * cited range into an exact excerpt, checks every quote against the file as it
 * is now, and hands the result to the same proposal pipeline as every other
 * import (version 2 underneath), so rendering, footnotes, concept cards,
 * review and apply do not change.
 *
 * What is checked: each quote is a verbatim substring of the cited lines of
 * the file (lines are located from the quote when absent), files stay inside
 * the repository (or are explicit outside sources such as a transcript), and
 * every diagram node declared in `nodes` is a real path or a named external
 * system. What is not checked: whether the quote supports the claim — that is
 * the reviewer's job, as for every OKB dossier.
 */
const fileEvidence = z.object({
  file: z.string().min(1),
  lines: z.string().regex(/^\s*\d+\s*(?:[-–:]\s*\d+\s*)?$/, 'lines look like "12" or "12-30"').optional(),
  quote: z.string().min(1),
}).strict();
const conceptEvidence = fileEvidence.extend({ displayQuote: z.string().min(1).optional() }).strict();
const claim = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  text: z.string().min(1),
  kind: z.enum(['reported', 'inferred']),
  evidence: z.array(fileEvidence).min(1),
}).strict();
const diagramNodes = z.record(z.string().regex(/^[\w.-]+$/), z.string().min(1)).optional();
const aid = z.union([
  z.object({ type: z.literal('diagram'), mermaid: z.string().min(1).max(6000), caption: z.string().max(300).default(''), basedOn: z.array(z.string()).min(1), placement: z.enum(['before', 'after']).optional(), nodes: diagramNodes }).strict(),
  aidSchema,
]);
const section = z.object({
  role: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  heading: z.string().min(1).optional(),
  claims: z.array(claim).default([]),
  aids: z.array(aid).default([]),
}).strict();
const concept = z.object({
  term: z.string().min(2),
  definition: z.string().min(5),
  evidence: z.array(conceptEvidence).min(1),
  aliases: z.array(z.string().min(2).max(60)).max(8).default([]),
  sections: z.array(z.object({ role: z.enum(['how', 'pitfalls']), claims: z.array(claim).min(1) }).strict()).default([]),
  aids: z.array(aid).default([]),
  seeAlso: z.array(z.string().min(1)).max(8).default([]),
}).strict();
const unknown = z.object({
  question: z.string().regex(/^q-[a-z0-9-]+$/).optional(),
  text: z.string().min(3).max(400),
  why: z.string().max(300).optional(),
  askWho: z.string().max(200).optional(),
  looked: z.array(z.string()).max(20).default([]),
}).strict();

export const dossierV3Schema = z.object({
  version: z.literal(3),
  repo: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  note: z.enum(['overview', 'architecture', 'start', 'interfaces', 'delivery', 'codemap', 'ticket', 'other']).optional(),
  template: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  style: resolvedStyleSchema,
  /** What was read to write this note (coverage), besides the cited ranges. */
  read: z.array(z.object({ file: z.string().min(1), lines: z.union([z.literal('all'), z.array(z.string())]).default('all') }).strict()).default([]),
  summary: z.string().default(''),
  sections: z.array(section).min(1),
  concepts: z.array(concept).default([]),
  corrections: z.array(z.object({ note: z.string().min(1), evidence: z.array(fileEvidence).min(1) }).strict()).default([]),
  openQuestions: z.array(z.string()).default([]),
  unknowns: z.array(unknown).default([]),
  /** Onboarding questions this note answers (`okb repo questions`). */
  answers: z.array(z.string().regex(/^q-[a-z0-9-]+$/)).default([]),
  related: z.array(z.object({ path: z.string().min(1), relation: z.enum(['prerequisite', 'next', 'deeper']), why: z.string().max(240).default(''), title: z.string().max(160).optional() }).strict()).default([]),
}).strict();

export type DossierV3 = z.infer<typeof dossierV3Schema>;
type FileEvidence = z.infer<typeof fileEvidence>;

export type ResolvedSources = {
  readonly docs: NormalizedDoc[];
  /** Repository-relative file → sha256, for freshness anchors. */
  readonly files: Record<string, string>;
  readonly quotes: Record<string, string[]>;
  /** Coverage to record: file → ranges or `all`. */
  readonly coverage: Record<string, 'all' | string[]>;
  readonly notes: string[];
  readonly analysis: Record<string, unknown>;
};

const OUTSIDE_SOURCE = /\.(vtt|srt|md|markdown|txt|pdf|docx|html?)$/i;
const DOCUMENT = /\.(vtt|srt|pdf|docx|html?)$/i;
const MAX_FILE = 4_000_000;

type Located = { start: number; end: number; moved: boolean };

/** Find the lines of `quote` in `lines`, preferring the declared range. */
export function locateQuote(text: string, quote: string, declared?: string): Located | null {
  const normalized = text.replace(/\r\n/g, '\n');
  const q = quote.replace(/\r\n/g, '\n');
  const lineStarts: number[] = [0];
  for (let i = 0; i < normalized.length; i++) if (normalized[i] === '\n') lineStarts.push(i + 1);
  const lineOfOffset = (offset: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const range = declared ? parseRange(declared) : null;
  if (range) {
    const from = lineStarts[Math.min(range[0], lineStarts.length) - 1] ?? 0;
    const to = range[1] < lineStarts.length ? lineStarts[range[1]]! : normalized.length;
    const at = normalized.slice(from, to).indexOf(q);
    if (at >= 0) return { start: lineOfOffset(from + at), end: lineOfOffset(from + at + q.length - 1), moved: false };
  }
  const at = normalized.indexOf(q);
  if (at < 0) return null;
  return { start: lineOfOffset(at), end: lineOfOffset(at + Math.max(0, q.length - 1)), moved: Boolean(range) };
}

/**
 * Turn the dossier's file citations into excerpt documents and a version 2
 * dossier over them.
 */
export async function resolveDossier(config: OkbConfig, raw: unknown, repo: { id: string; name: string; path: string }, extraRoots: readonly string[] = []): Promise<{ dossier: DossierV3; resolved: ResolvedSources }> {
  const parsed = dossierV3Schema.safeParse(raw);
  if (!parsed.success) throw new OkbError('E_INVALID', 'invalid repository dossier (version 3)', { detail: { issues: parsed.error.issues } });
  const dossier = parsed.data;
  if (dossier.repo !== repo.id) throw new OkbError('E_INVALID', `the dossier is for repository "${dossier.repo}", not "${repo.id}"`);

  const all: FileEvidence[] = [
    ...dossier.sections.flatMap((s) => s.claims.flatMap((c) => c.evidence)),
    ...dossier.concepts.flatMap((c) => [...c.evidence, ...c.sections.flatMap((s) => s.claims.flatMap((x) => x.evidence))]),
    ...dossier.corrections.flatMap((c) => c.evidence),
  ];
  if (!dossier.sections.some((s) => s.claims.length)) throw new OkbError('E_INVALID', 'a dossier needs at least one sourced claim');

  const notes: string[] = [];
  const byFile = new Map<string, { abs: string; inRepo: boolean; evidence: FileEvidence[] }>();
  const resolveFile = (file: string) => {
    const abs = isAbsolute(file) ? resolve(file) : resolve(repo.path, file);
    const inRepo = isInside(abs, repo.path);
    if (!inRepo) {
      const allowed = isAbsolute(file) && (OUTSIDE_SOURCE.test(abs) || extraRoots.some((r) => isInside(abs, r)));
      if (!allowed) throw new OkbError('E_FORBIDDEN_PATH', `cited file is outside the repository: ${file}`, { hint: 'Cite repository files by their relative path; outside sources (transcript, answer, ticket) by an absolute path to a .vtt, .md, .txt, .pdf, .docx or .html file.' });
    }
    if (inRepo && relative(repo.path, abs).split(sep).some((part) => part === '.git')) throw new OkbError('E_FORBIDDEN_PATH', 'Git internals cannot be cited');
    return { abs, inRepo };
  };
  for (const ev of all) {
    const { abs, inRepo } = resolveFile(ev.file);
    const key = abs;
    const entry = byFile.get(key) ?? { abs, inRepo, evidence: [] };
    entry.evidence.push(ev);
    byFile.set(key, entry);
  }

  const docs: NormalizedDoc[] = [];
  const blockOf = new Map<FileEvidence, { blockId: string }>();
  const files: Record<string, string> = {};
  const quotes: Record<string, string[]> = {};
  const coverage: Record<string, 'all' | string[]> = {};
  const cited: string[] = [];
  for (const { abs, inRepo, evidence } of byFile.values()) {
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) throw new OkbError('E_NOT_FOUND', `cited file not found: ${evidence[0]!.file}`, { key: 'repoFileMissing', params: { file: evidence[0]!.file } });
    if (info.size > MAX_FILE) throw new OkbError('E_UNSUPPORTED', `cited file is too large to excerpt: ${evidence[0]!.file}`);
    const rel = inRepo ? relative(repo.path, abs).split(sep).join('/') : null;
    if (!inRepo || DOCUMENT.test(abs)) {
      // A transcript, an answer or a document: the normal adapter, then only the blocks quoted.
      const doc = await extractSource(await acquire(abs, config), config);
      const keep = new Set<string>();
      for (const ev of evidence) {
        const block = doc.blocks.find((b) => b.text.includes(ev.quote));
        if (!block) throw new OkbError('E_INVALID', `quote not found in ${ev.file}: "${ev.quote.slice(0, 80)}"`, { key: 'repoQuoteMissing', params: { file: ev.file, quote: ev.quote.slice(0, 80) } });
        keep.add(block.id);
        blockOf.set(ev, { blockId: block.id });
      }
      const blocks = doc.blocks.filter((b) => keep.has(b.id));
      docs.push({ ...doc, blocks, outline: buildOutline(blocks), source: { ...doc.source, limitations: [...doc.source.limitations, `${blocks.length} of ${doc.blocks.length} blocks quoted`] } });
      if (rel) { files[rel] = doc.source.sha256; quotes[rel] = evidence.map((e) => e.quote); }
      continue;
    }
    const bytes = await readFile(abs);
    if (bytes.includes(0)) throw new OkbError('E_UNSUPPORTED', `cited file is binary: ${rel}`);
    const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const ranges: string[] = [];
    const located = new Map<FileEvidence, Located>();
    for (const ev of evidence) {
      const loc = locateQuote(text, ev.quote, ev.lines);
      if (!loc) throw new OkbError('E_INVALID', `quote is not in ${rel}${ev.lines ? ` (lines ${ev.lines})` : ''}: "${ev.quote.slice(0, 80)}"`, { key: 'repoQuoteMissing', params: { file: rel!, quote: ev.quote.slice(0, 80) }, hint: 'Copy the quote exactly from the current file (same spaces and punctuation); the file may have changed since it was read.' });
      if (loc.moved) notes.push(`${rel}: quote declared at lines ${ev.lines} was found at lines ${loc.start}–${loc.end}`);
      located.set(ev, loc);
      ranges.push(`${loc.start}-${loc.end}`);
    }
    // One block per overlapping group of cited lines: adjacent quotes keep their own line numbers.
    const merged = overlapping(ranges);
    const sha = sha256(bytes);
    const uri = pathToFileURL(abs).href;
    const sourceId = shortId(`${uri}:${sha}`);
    const isCode = !/\.(md|mdx|markdown|txt|rst|adoc)$/i.test(abs);
    const blocks: Block[] = merged.map(([a, b], index) => ({
      id: `${sourceId}#${index}`,
      index,
      kind: isCode ? 'code' : 'paragraph',
      text: lines.slice(a - 1, b).join('\n'),
      locator: { kind: 'line', line: a, ...(b !== a ? { endLine: b } : {}) },
    }));
    for (const [ev, loc] of located) {
      const index = merged.findIndex(([a, b]) => loc.start >= a && loc.end <= b);
      blockOf.set(ev, { blockId: blocks[index]!.id });
    }
    docs.push({
      source: {
        id: sourceId, uri, kind: isCode ? 'code' : 'markdown', adapter: 'repo-excerpt', adapterVersion: '1', sha256: sha, bytes: bytes.byteLength,
        acquiredAt: new Date().toISOString(), support: 'full', title: `${repo.name}/${rel}`,
        limitations: [],
        ...(extname(abs) ? { contentType: 'text/plain' } : {}),
      },
      blocks,
      outline: [],
    });
    files[rel!] = sha;
    quotes[rel!] = evidence.map((e) => e.quote);
    coverage[rel!] = mergeRanges(ranges);
    cited.push(`${rel} (l.${merged.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')} / ${lines.length})`);
  }
  if (cited.length) notes.unshift(`cites ${cited.join(' · ')} at the current state of the files`);
  const shas = docs.map((d) => d.source.sha256);
  const twins = shas.filter((s, i) => shas.indexOf(s) !== i);
  if (twins.length) {
    const names = docs.filter((d) => twins.includes(d.source.sha256)).map((d) => d.source.title);
    throw new OkbError('E_INVALID', `two cited files have identical content (${names.join(', ')}): cite only one of them`);
  }
  for (const r of dossier.read) {
    const { abs, inRepo } = resolveFile(r.file);
    if (!inRepo) continue;
    const rel = relative(repo.path, abs).split(sep).join('/');
    const exists = await stat(abs).then((s) => s.isFile(), () => false);
    if (!exists) { notes.push(`declared as read but not found: ${r.file}`); continue; }
    const before = coverage[rel];
    coverage[rel] = r.lines === 'all' || before === 'all' ? 'all' : mergeRanges([...(before ?? []), ...r.lines]);
  }

  await checkDiagrams(dossier, repo.path, notes);

  const toV2Evidence = (ev: FileEvidence & { displayQuote?: string }) => ({
    blockId: blockOf.get(ev)!.blockId,
    quote: ev.quote.replace(/\r\n/g, '\n'),
    ...(ev.displayQuote ? { displayQuote: ev.displayQuote } : {}),
  });
  const toV2Claim = (c: z.infer<typeof claim>) => ({ ...c, evidence: c.evidence.map(toV2Evidence) });
  const stripAid = (a: z.infer<typeof aid>) => {
    if (a.type !== 'diagram') return a;
    const { nodes: _nodes, ...rest } = a as typeof a & { nodes?: unknown };
    return rest;
  };
  const unknownLines = dossier.unknowns.map((u) => [
    u.text,
    u.askWho ? ` — ${dossier.style.language.startsWith('fr') ? 'à demander à' : 'ask'} ${u.askWho}` : '',
    u.looked.length ? ` (${dossier.style.language.startsWith('fr') ? 'cherché dans' : 'looked in'} ${u.looked.join(', ')})` : '',
  ].join(''));
  const analysis = {
    version: 2,
    ...(dossier.template ? { template: dossier.template } : {}),
    sources: docs.map((d) => d.source.sha256),
    style: dossier.style,
    reviewedBlockIds: docs.flatMap((d) => d.blocks.map((b) => b.id)),
    summary: dossier.summary,
    sections: dossier.sections.map((s) => ({ ...s, claims: s.claims.map(toV2Claim), aids: s.aids.map(stripAid) })),
    concepts: dossier.concepts.map((c) => ({ ...c, evidence: c.evidence.map(toV2Evidence), sections: c.sections.map((s) => ({ ...s, claims: s.claims.map(toV2Claim) })), aids: c.aids.map(stripAid) })),
    corrections: dossier.corrections.map((c) => ({ laterBlockId: toV2Evidence(c.evidence[0]!).blockId, ...(c.evidence[1] ? { earlierBlockId: toV2Evidence(c.evidence[1]).blockId } : {}), note: c.note })),
    openQuestions: [...dossier.openQuestions, ...unknownLines],
    related: dossier.related,
  };
  return { dossier, resolved: { docs, files, quotes, coverage, notes, analysis } };
}

function overlapping(ranges: readonly string[]): [number, number][] {
  const parsed = ranges.map(parseRange).filter((r): r is [number, number] => r !== null).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const r of parsed) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/** Node ids a Mermaid diagram draws (flowchart, sequence, ER, C4-like flowcharts). */
export function mermaidNodes(code: string): string[] {
  const text = code.trim();
  const ids = new Set<string>();
  if (/^sequenceDiagram/.test(text)) {
    for (const m of text.matchAll(/^\s*(?:participant|actor)\s+([\w.]+(?:-[\w.]+)*)/gm)) ids.add(m[1]!);
    for (const m of text.matchAll(/^\s*([\w.]+(?:-[\w.]+)*)\s*--?(?:>>|>|x|\))\s*[+-]?([\w.]+(?:-[\w.]+)*)\s*:/gm)) { ids.add(m[1]!); ids.add(m[2]!); }
  } else if (/^erDiagram/.test(text)) {
    for (const m of text.matchAll(/^\s*([\w-]+)\s*\{/gm)) ids.add(m[1]!);
    for (const m of text.matchAll(/^\s*([\w-]+)\s+[|}o][|o]?(?:--|\.\.)[|o{]?[|{o]?\s+([\w-]+)\s*:/gm)) { ids.add(m[1]!); ids.add(m[2]!); }
  } else if (/^(flowchart|graph)\b/.test(text)) {
    for (const line of text.split('\n').slice(1)) {
      let l = line.trim();
      if (!l || /^(subgraph|end\b|classDef|class\s|style\s|linkStyle|click\s|%%|direction)/.test(l)) continue;
      // Drop labels: edge texts (|x|, -- x -->, -. x .->, == x ==>) and node shapes ([x], (x), {x}, >x]).
      l = l.replace(/\|[^|]*\|/g, ' ')
        .replace(/--\s+[^\n]*?\s+(--[->ox]|-->)/g, '-->')
        .replace(/-\.\s+[^\n]*?\s+\.->/g, '-.->')
        .replace(/==\s+[^\n]*?\s+==>/g, '==>');
      let previous = '';
      while (previous !== l) {
        previous = l;
        l = l.replace(/(\[\[|\[\(|\(\(|\(\[|\{\{|\[\/|\[\\|\[|\(|\{|>)(?:[^\[\](){}"]|"[^"]*")*?(\]\]|\)\]|\)\)|\]\)|\}\}|\/\]|\\\]|\]|\)|\})/g, '');
      }
      for (const token of l.split(/\s*(?:<?(?:-{2,}|={2,}|-\.+-?|~~~)(?:>|x|o)?|&)\s*/)) {
        const id = token.trim().replace(/:::[\w-]+$/, '');
        if (/^[A-Za-z_][\w-]*$/.test(id)) ids.add(id);
      }
    }
  }
  return [...ids];
}

async function checkDiagrams(dossier: DossierV3, root: string, notes: string[]): Promise<void> {
  const diagrams = [
    ...dossier.sections.flatMap((s) => s.aids.map((a) => ({ a, where: s.role ?? s.heading ?? 'section' }))),
    ...dossier.concepts.flatMap((c) => c.aids.map((a) => ({ a, where: c.term }))),
  ].filter((x) => x.a.type === 'diagram') as { a: { type: 'diagram'; mermaid: string; nodes?: Record<string, string> }; where: string }[];
  for (const { a, where } of diagrams) {
    const drawn = mermaidNodes(a.mermaid);
    if (!a.nodes) {
      if (drawn.length) notes.push(`diagram in "${where}": its boxes are not tied to files or external systems (add "nodes")`);
      continue;
    }
    for (const [node, target] of Object.entries(a.nodes)) {
      if (!drawn.includes(node)) throw new OkbError('E_INVALID', `diagram in "${where}": "nodes" names "${node}", which the diagram does not draw`);
      if (/^external:.+/.test(target)) continue;
      const abs = resolve(root, target.replace(/\/$/, ''));
      if (!isInside(abs, root) || !(await stat(abs).then(() => true, () => false))) {
        throw new OkbError('E_INVALID', `diagram in "${where}": node "${node}" points to "${target}", which is not in the repository`, { key: 'repoDiagramNode', params: { node, target } });
      }
    }
    const loose = drawn.filter((n) => !(n in a.nodes!));
    if (loose.length) throw new OkbError('E_INVALID', `diagram in "${where}": node(s) ${loose.join(', ')} are drawn but not tied to a path or an external system in "nodes"`, { key: 'repoDiagramLoose', params: { nodes: loose.join(', ') } });
  }
}

