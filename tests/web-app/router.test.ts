import { describe, expect, it } from 'vitest';
import { screenOf, screenTabs } from '../../web-app/src/app/nav.js';
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
    expect(parseRoute('#/share')).toEqual({ name: 'tools', tab: 'share' });
    expect(parseRoute('#/packs')).toEqual({ name: 'tools', tab: 'share' });
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
      { name: 'learn', tab: 'career' }, { name: 'learn', tab: 'progress' }, { name: 'tools', tab: 'templates' }, { name: 'tools', tab: 'share' }, { name: 'tools' }, { name: 'upkeep', tab: 'usage' }, { name: 'upkeep' },
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

describe('the five screens of the 2.0 (F2.0-01)', () => {
  it('each screen has its address, and the projects have theirs', () => {
    expect(parseRoute('#/projects')).toEqual({ name: 'projects' });
    expect(parseRoute('#/documents')).toEqual({ name: 'documents' });
    expect(hrefFor({ name: 'documents' })).toBe('#/documents');
    expect(parseRoute('#/project/P-1a2b3c')).toEqual({ name: 'projects', id: 'P-1a2b3c' });
    expect(parseRoute('#/memory')).toEqual({ name: 'brain', query: {} });
    expect(parseRoute('#/assistant')).toEqual({ name: 'ask' });
    expect(parseRoute('#/progress')).toEqual({ name: 'learn' });
    expect(hrefFor({ name: 'projects' })).toBe('#/projects');
    expect(hrefFor({ name: 'projects', id: 'P-1a2b3c' })).toBe('#/project/P-1a2b3c');
  });

  it('every page belongs to one screen, to « À valider » or to the « Plus » menu; old addresses land in the right screen', () => {
    const screen = (hash: string) => screenOf(parseRoute(hash));
    expect(screen('#/')).toBe('today');
    expect(screen('#/weekly')).toBe('today');
    expect(screen('#/projects')).toBe('projects');
    expect(screen('#/documents')).toBe('memory');
    expect(screen('#/repos')).toBe('projects');
    expect(screen('#/repo/orders-service')).toBe('projects');
    expect(screen('#/repos/architecture')).toBe('projects');
    expect(screen('#/notes')).toBe('memory');
    expect(screen('#/note/a%2Fb.md')).toBe('memory');
    expect(screen('#/graph')).toBe('memory');
    expect(screen('#/ask')).toBe('assistant');
    expect(screen('#/claude')).toBe('assistant');
    expect(screen('#/learn')).toBe('progress');
    expect(screen('#/career')).toBe('progress');
    for (const other of ['#/review', '#/suggestions', '#/inbox', '#/tools', '#/health', '#/modules', '#/settings', '#/help']) expect(screen(other), other).toBeNull();
  });

  it('the screens with several pages show them as tabs; the developer pages only with the module', () => {
    const labels = (hash: string, dev: boolean) => screenTabs(parseRoute(hash), dev).map((t) => [t.label, t.current]);
    expect(labels('#/graph', true)).toEqual([['app.memory.notes', false], ['app.memory.graph', true], ['app.memory.documents', false]]);
    expect(labels('#/ask', true)).toEqual([['app.assistant.ask', true], ['app.assistant.terminal', false]]);
    expect(labels('#/repos/architecture', true)).toEqual([['app.projects.all', false], ['app.projects.repos', false], ['app.projects.arch', true]]);
    expect(labels('#/projects', false)).toEqual([]);
    expect(labels('#/', true)).toEqual([]);
  });
});
