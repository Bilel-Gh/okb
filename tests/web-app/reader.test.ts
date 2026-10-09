// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { dropCrumbLine, markTerms, outline } from '../../web-app/src/reader/enhance.js';

function article(html: string): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML = html;
  return el;
}

const TERMS = [
  { term: 'SLA', path: 'c/SLA.md', aliases: ['accord de service'], oneLiner: 'Un contrat qui fixe le niveau de service promis.' },
  { term: 'OData', path: 'c/OData.md', aliases: [], oneLiner: null },
];

describe('words that have a concept card', () => {
  it('marks the first occurrence of a term with a sentence, for the bubble', () => {
    const a = article('<h2>SLA</h2><p>Le SLA du service. Encore le SLA.</p>');
    markTerms(a, TERMS);
    const marked = a.querySelectorAll('a.term');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toBe('SLA');
    expect(marked[0]!.getAttribute('href')).toBe('#/note/c%2FSLA.md');
    expect(marked[0]!.getAttribute('data-term')).toBe('0');
    // Never inside a heading.
    expect(a.querySelector('h2 a')).toBeNull();
  });

  it('a term without a sentence stays a plain link, never a vague bubble', () => {
    const a = article('<p>On appelle OData ici.</p>');
    markTerms(a, TERMS);
    const link = a.querySelector('a')!;
    expect(link.className).toBe('');
    expect(link.getAttribute('href')).toBe('#/note/c%2FOData.md');
  });

  it('a link the note already makes to a concept card gets the bubble, whatever its words', () => {
    const a = article('<p>Voir <a href="#/note/c%2FSLA.md">notre engagement</a>, puis le SLA et <a href="#/note/c%2FSLA.md::Exemple">son exemple</a>.</p>');
    markTerms(a, TERMS);
    const marked = [...a.querySelectorAll('a.term')];
    // Both links to the card, and no extra link on the plain word: the card is already linked.
    expect(marked.map((m) => m.textContent)).toEqual(['notre engagement', 'son exemple']);
    expect(marked.every((m) => m.getAttribute('data-term') === '0')).toBe(true);
    expect(a.querySelectorAll('a')).toHaveLength(2);
  });

  it('a link to a card without a sentence stays a plain link', () => {
    const a = article('<p><a href="#/note/c%2FOData.md">OData</a></p>');
    markTerms(a, TERMS);
    expect(a.querySelector('a')!.className).toBe('');
  });

  it('finds aliases, whole words only, and never inside code or links', () => {
    const a = article('<p><code>SLA</code> <a href="x">SLA</a> les SLAs et l’accord de service.</p>');
    markTerms(a, TERMS);
    const marked = a.querySelectorAll('a.term');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toBe('accord de service');
  });
});

describe('the reader', () => {
  it('drops the breadcrumb line written in the note: the app draws the line itself', () => {
    const a = article('<p>🧭 <a href="#/note/x">Démo</a> › Produits</p><h1>Titre</h1>');
    dropCrumbLine(a);
    expect(a.querySelector('p')).toBeNull();
  });

  it('builds an outline of the h2 and h3, with ids', () => {
    const a = article('<h1>T</h1><h2>Un</h2><h3>Deux</h3><h2>Trois</h2>');
    expect(outline(a)).toEqual([{ id: 's-0', text: 'Un', level: 2 }, { id: 's-1', text: 'Deux', level: 3 }, { id: 's-2', text: 'Trois', level: 2 }]);
    expect(a.querySelector('h3')!.id).toBe('s-1');
  });
});
