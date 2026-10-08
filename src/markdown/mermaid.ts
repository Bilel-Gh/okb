/**
 * Every Mermaid diagram is checked before a note is proposed: a diagram that
 * does not parse is a broken picture in the reader, Obsidian and GitHub alike.
 * The official parser runs without a browser for the common types (flowchart,
 * sequence, entity-relation, state, class, journey, pie, gantt…); a type it
 * cannot check outside a browser is let through as « unchecked », never
 * refused by mistake.
 */
export type MermaidCheck = { readonly ok: true; readonly type: string } | { readonly ok: false; readonly error: string } | { readonly ok: 'unchecked'; readonly reason: string };

type Parser = (src: string) => Promise<{ diagramType?: string }>;
let parser: Parser | null | undefined;

async function load(): Promise<Parser | null> {
  if (parser !== undefined) return parser;
  try {
    const m = (await import('mermaid')) as unknown as { default: { parse: Parser } };
    parser = (src) => m.default.parse(src);
  } catch {
    parser = null;
  }
  return parser;
}

const BROWSER_ONLY = /DOMPurify|document is not defined|window is not defined|navigator is not defined/i;

export async function checkMermaid(source: string): Promise<MermaidCheck> {
  const parse = await load();
  if (!parse) return { ok: 'unchecked', reason: 'parser unavailable' };
  try {
    const r = await parse(source.trim());
    return { ok: true, type: r?.diagramType ?? 'unknown' };
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    if (BROWSER_ONLY.test(message)) return { ok: 'unchecked', reason: 'needs a browser to check' };
    return { ok: false, error: message.split('\n').slice(0, 4).join(' ').slice(0, 300) };
  }
}

/** The ```mermaid blocks of a Markdown text. */
export function mermaidBlocks(markdown: string): { source: string; line: number }[] {
  const out: { source: string; line: number }[] = [];
  const re = /^```mermaid[^\n]*\n([\s\S]*?)^```/gm;
  for (const m of markdown.matchAll(re)) out.push({ source: m[1]!, line: markdown.slice(0, m.index).split('\n').length });
  return out;
}

/** Problems of every diagram of a text: empty when all parse (or cannot be checked here). */
export async function diagramProblems(markdown: string): Promise<{ line: number; error: string }[]> {
  const blocks = mermaidBlocks(markdown);
  const out: { line: number; error: string }[] = [];
  for (const b of blocks) {
    const r = await checkMermaid(b.source);
    if (r.ok === false) out.push({ line: b.line, error: r.error });
  }
  return out;
}
