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
    expect(parseRoute('#/repos/architecture')).toEqual({ name: 'repos', tab: 'architecture' });
    expect(parseRoute('#/repos/architecture?view=flow&from=shop-web&call=POST%20%2Forders')).toEqual({ name: 'repos', tab: 'architecture', view: 'flow', from: 'shop-web', call: 'POST /orders' });
    expect(hrefFor({ name: 'repos', tab: 'architecture', view: 'context' })).toBe('#/repos/architecture?view=context');
    expect(hrefFor({ name: 'repos', tab: 'architecture' })).toBe('#/repos/architecture');
    expect(parseRoute('#/modules')).toMatchObject({ name: 'modules' });
    expect(parseRoute('#/claude')).toMatchObject({ name: 'claude' });
    expect(parseRoute('#/learn')).toMatchObject({ name: 'learn' });
    expect(parseRoute('#/ask?q=facturer%20un%20client')).toMatchObject({ name: 'ask', q: 'facturer un client' });
    expect(parseRoute('#/suggestions')).toMatchObject({ name: 'inbox' });
    expect(parseRoute('#/review')).toMatchObject({ name: 'inbox' });
  });

  it('gives every page of the first versions a place in the new destinations', () => {
    expect(parseRoute('#/home')).toEqual({ name: 'today' });
    expect(parseRoute('#/focus')).toEqual({ name: 'today', tab: 'focus' });
    expect(parseRoute('#/focus?done=1')).toEqual({ name: 'today', tab: 'focus', done: true });
    expect(parseRoute('#/weekly?step=health')).toEqual({ name: 'today', tab: 'week', step: 'health' });
    expect(parseRoute('#/graph?focus=x.md')).toEqual({ name: 'graph', focus: 'x.md' });
    expect(parseRoute('#/graph?brain=1')).toEqual({ name: 'graph', brain: true });
    expect(parseRoute('#/versions/a%2Fb.md')).toEqual({ name: 'brain', path: 'a/b.md', history: true });
    expect(parseRoute('#/inbox?new=1')).toEqual({ name: 'inbox', tab: 'captures', compose: true });
    expect(parseRoute('#/inbox?all=1')).toEqual({ name: 'inbox', tab: 'captures', all: true });
    expect(parseRoute('#/history')).toEqual({ name: 'inbox', tab: 'history' });
    expect(parseRoute('#/proposal/p-1')).toEqual({ name: 'inbox', tab: 'proposals', id: 'p-1' });
    expect(parseRoute('#/career')).toEqual({ name: 'learn', tab: 'career' });
    expect(parseRoute('#/learn/progress')).toEqual({ name: 'learn', tab: 'progress' });
    expect(parseRoute('#/source')).toEqual({ name: 'tools', tab: 'source' });
    expect(parseRoute('#/skills')).toEqual({ name: 'tools', tab: 'skills' });
    expect(parseRoute('#/templates')).toEqual({ name: 'tools', tab: 'templates' });
    expect(parseRoute('#/categories')).toEqual({ name: 'tools', tab: 'categories' });
    expect(parseRoute('#/health')).toEqual({ name: 'upkeep', tab: 'health' });
    expect(parseRoute('#/doctor')).toEqual({ name: 'upkeep', tab: 'doctor' });
    expect(parseRoute('#/usage')).toEqual({ name: 'upkeep', tab: 'usage' });
    expect(parseRoute('#/backup')).toEqual({ name: 'upkeep', tab: 'backup' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/settings/appearance')).toEqual({ name: 'settings', tab: 'appearance' });
    expect(parseRoute('#/kbs')).toEqual({ name: 'settings', tab: 'brains' });
    expect(parseRoute('#/newkb')).toEqual({ name: 'settings', tab: 'new' });
    expect(parseRoute('#/help')).toEqual({ name: 'help' });
  });

  it('opens Today for an address it does not know', () => {
    expect(parseRoute('#/nowhere/at/all')).toEqual({ name: 'today' });
  });

  it('writes each destination and its tabs back, so a page can be bookmarked', () => {
    const routes = [
      { name: 'today', tab: 'focus' }, { name: 'today', tab: 'week', step: 'health' }, { name: 'graph', focus: 'x.md' }, { name: 'graph', brain: true },
      { name: 'brain', path: 'a/b.md', history: true }, { name: 'inbox', tab: 'captures' }, { name: 'inbox', tab: 'history' }, { name: 'inbox', tab: 'proposals', id: 'p-1' },
      { name: 'learn', tab: 'career' }, { name: 'learn', tab: 'progress' }, { name: 'tools', tab: 'templates' }, { name: 'tools' }, { name: 'upkeep', tab: 'usage' }, { name: 'upkeep' },
      { name: 'settings', tab: 'brains' }, { name: 'settings', tab: 'new' }, { name: 'settings', tab: 'appearance' }, { name: 'help' },
    ] as const;
    for (const r of routes) expect(parseRoute(hrefFor(r))).toEqual(r);
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
