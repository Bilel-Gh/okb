import { describe, expect, it } from 'vitest';
import { parseRoute, hrefFor } from '../../web-app/src/app/router.js';

describe('the new app reads the same addresses as before', () => {
  it('reads today, the explorer, a note and its anchor', () => {
    expect(parseRoute('')).toMatchObject({ name: 'today' });
    expect(parseRoute('#/')).toMatchObject({ name: 'today' });
    expect(parseRoute('#/notes?q=export&cat=concept')).toMatchObject({ name: 'brain', query: { q: 'export', cat: 'concept' } });
    expect(parseRoute('#/note/2%20Produits%2FAtlas%2FAtlas.md')).toMatchObject({ name: 'brain', path: '2 Produits/Atlas/Atlas.md' });
    expect(parseRoute('#/note/a%2Fb.md#Installer')).toMatchObject({ name: 'brain', path: 'a/b.md', anchor: 'Installer' });
  });

  it('reads the new pages', () => {
    expect(parseRoute('#/repos')).toMatchObject({ name: 'repos' });
    expect(parseRoute('#/repo/atlas-api')).toMatchObject({ name: 'repos', id: 'atlas-api' });
    expect(parseRoute('#/modules')).toMatchObject({ name: 'modules' });
    expect(parseRoute('#/claude')).toMatchObject({ name: 'claude' });
    expect(parseRoute('#/learn')).toMatchObject({ name: 'learn' });
    expect(parseRoute('#/ask?q=facturer%20un%20client')).toMatchObject({ name: 'ask', q: 'facturer un client' });
    expect(parseRoute('#/suggestions')).toMatchObject({ name: 'inbox' });
    expect(parseRoute('#/review')).toMatchObject({ name: 'inbox' });
  });

  it('sends a page not rebuilt yet to the classic app, keeping its address', () => {
    expect(parseRoute('#/graph?focus=x.md')).toEqual({ name: 'classic', href: '/classic#/graph?focus=x.md' });
    expect(parseRoute('#/weekly')).toEqual({ name: 'classic', href: '/classic#/weekly' });
  });

  it('writes addresses back', () => {
    expect(hrefFor({ name: 'brain', path: '2 Produits/Atlas/Atlas.md' })).toBe('#/note/2%20Produits%2FAtlas%2FAtlas.md');
    expect(hrefFor({ name: 'brain', query: { q: 'csv' } })).toBe('#/notes?q=csv');
    expect(hrefFor({ name: 'today' })).toBe('#/');
    // Filters stay while a note is open.
    expect(hrefFor({ name: 'brain', path: 'a.md', query: { cat: 'concept' } })).toBe('#/note/a.md?cat=concept');
    expect(parseRoute('#/note/a.md?cat=concept')).toMatchObject({ name: 'brain', path: 'a.md', query: { cat: 'concept' } });
  });
});
