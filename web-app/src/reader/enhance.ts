/**
 * Turn the server's sanitized note HTML into a live reader: diagrams, the
 * outline, external links, and the words that have a concept card.
 */
export type Term = { term: string; path: string; aliases: readonly string[]; oneLiner: string | null };
export type OutlineItem = { id: string; text: string; level: 2 | 3 };

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The first occurrence of each term becomes a link to its card. A term with a
 * checked one-line definition gets the bubble (`a.term`, `data-term`); without
 * one it stays a plain link. Never inside a heading, a link, code or a diagram.
 */
export function markTerms(article: HTMLElement, terms: readonly Term[]): void {
  const doc = article.ownerDocument;
  const walker = doc.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, code, pre, h1, h2, h3, h4, .mermaid, svg, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  terms.forEach((term, index) => {
    const words = [term.term, ...term.aliases].filter((w) => w && w.length >= 2).sort((a, b) => b.length - a.length);
    if (!words.length) return;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(esc).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
    for (const node of nodes) {
      if (!node.parentNode) continue;
      const m = re.exec(node.nodeValue ?? '');
      if (!m) continue;
      const start = m.index + m[1]!.length;
      const after = node.splitText(start);
      after.nodeValue = (after.nodeValue ?? '').slice(m[2]!.length);
      const a = doc.createElement('a');
      a.href = `#/note/${encodeURIComponent(term.path)}`;
      a.textContent = m[2]!;
      if (term.oneLiner) { a.className = 'term'; a.dataset.term = String(index); }
      node.parentNode.insertBefore(a, after);
      nodes.push(after);
      return;
    }
  });
}

/** The « 🧭 Démo › Produits » line written at the top of brain notes: the app draws it as the note's line. */
export function dropCrumbLine(article: HTMLElement): void {
  const first = article.firstElementChild;
  if (first?.tagName === 'P' && (first.textContent ?? '').trim().startsWith('🧭')) first.remove();
}

export function outline(article: HTMLElement): OutlineItem[] {
  return [...article.querySelectorAll('h2, h3')].map((h, i) => {
    h.id = `s-${i}`;
    return { id: h.id, text: h.textContent ?? '', level: h.tagName === 'H3' ? 3 : 2 };
  });
}

/** External links open apart; footnote links scroll within the note. */
export function wireLinks(article: HTMLElement): void {
  article.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  article.querySelectorAll<HTMLAnchorElement>('a[href^="#user-content-"]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    article.querySelector(`[id="${(a.getAttribute('href') ?? '').slice(1)}"]`)?.scrollIntoView({ block: 'center' });
  }));
}

type Mermaid = { initialize: (o: object) => void; render: (id: string, text: string) => Promise<{ svg: string }> };
let mermaid: Promise<Mermaid | null> | null = null;

function loadMermaid(): Promise<Mermaid | null> {
  mermaid ??= new Promise((done) => {
    const s = document.createElement('script');
    s.src = '/vendor/mermaid.js';
    s.onload = () => {
      const m = (window as unknown as { mermaid: Mermaid }).mermaid;
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral', fontFamily: 'Fira Sans, system-ui, sans-serif' });
      done(m);
    };
    s.onerror = () => done(null);
    document.head.append(s);
  });
  return mermaid;
}

/** Mermaid code blocks become diagrams; a block that does not parse stays as code. */
export async function drawDiagrams(article: HTMLElement): Promise<void> {
  const codes = [...article.querySelectorAll('code.language-mermaid')];
  if (!codes.length) return;
  const m = await loadMermaid();
  if (!m) return;
  for (const [i, code] of codes.entries()) {
    try {
      const { svg } = await m.render(`m${Date.now()}${i}`, code.textContent ?? '');
      const box = document.createElement('div');
      box.className = 'mermaid';
      box.innerHTML = svg;
      code.parentElement?.replaceWith(box);
    } catch { /* keep the code */ }
  }
}
