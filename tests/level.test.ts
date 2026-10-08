import { describe, expect, it } from 'vitest';
import { levelFromFacts, repoLevel, tierOf, type LevelFacts } from '../src/knowledge/level.js';
import { brainRepos } from '../src/knowledge/brain-repos.js';
import { demoBrain } from './helpers/brain.js';

const KINDS = ['repo-hub', 'repo-start', 'repo-architecture', 'repo-interfaces', 'repo-delivery', 'repo-codemap', 'repo-test', 'repo-debug'];
const pages = (state: 'fresh' | 'changed' | 'stale' | 'missing', override: Record<string, 'fresh' | 'changed' | 'stale' | 'missing'> = {}) => KINDS.map((kind) => ({ kind, state: override[kind] ?? state }));

const EMPTY: LevelFacts = { questions: { answered: 0, half: 0, total: 25 }, pages: pages('missing'), coverage: { read: 0, readTotal: 20, skim: 0, skimTotal: 10 }, work: 0, quality: null };
const FULL: LevelFacts = { questions: { answered: 25, half: 0, total: 25 }, pages: pages('fresh'), coverage: { read: 20, readTotal: 20, skim: 10, skimTotal: 10 }, work: 6, quality: 100 };

describe('the tiers', () => {
  it('cuts at 20, 45, 70 and 90', () => {
    expect(tierOf(0)).toBe('discovery');
    expect(tierOf(19)).toBe('discovery');
    expect(tierOf(20)).toBe('usable');
    expect(tierOf(44)).toBe('usable');
    expect(tierOf(45)).toBe('solid');
    expect(tierOf(70)).toBe('expert');
    expect(tierOf(89)).toBe('expert');
    expect(tierOf(90)).toBe('reference');
    expect(tierOf(100)).toBe('reference');
  });
});

describe('the knowledge level, without AI', () => {
  it('is 0 when nothing is known, with three things to do first', () => {
    const level = levelFromFacts(EMPTY);
    expect(level.percent).toBe(0);
    expect(level.tier).toBe('discovery');
    expect(level.partial).toBe(false);
    expect(level.next).toHaveLength(3);
  });

  it('is 100 when everything is answered, written, read, fresh and good', () => {
    const level = levelFromFacts(FULL);
    expect(level.percent).toBe(100);
    expect(level.tier).toBe('reference');
    expect(level.next).toEqual([]);
  });

  it('weighs the parts 30, 25, 20, 15 and 10', () => {
    expect(levelFromFacts(FULL).parts.map((p) => [p.id, p.weight])).toEqual([['questions', 30], ['notes', 25], ['coverage', 20], ['work', 15], ['quality', 10]]);
    expect(levelFromFacts({ ...EMPTY, questions: { answered: 25, half: 0, total: 25 } }).percent).toBe(30);
    expect(levelFromFacts({ ...EMPTY, work: 6 }).percent).toBe(15);
  });

  it('ages: a changed page counts less than a fresh one, a stale page even less', () => {
    const fresh = levelFromFacts(FULL).percent;
    const changed = levelFromFacts({ ...FULL, pages: pages('fresh', { 'repo-start': 'changed', 'repo-codemap': 'changed' }) }).percent;
    const stale = levelFromFacts({ ...FULL, pages: pages('fresh', { 'repo-start': 'stale', 'repo-codemap': 'stale' }) }).percent;
    expect(changed).toBeLessThan(fresh);
    expect(stale).toBeLessThan(changed);
  });

  it('counts a found or received answer as half', () => {
    expect(levelFromFacts({ ...EMPTY, questions: { answered: 0, half: 25, total: 25 } }).percent).toBe(15);
  });

  it('measures an unlinked repository on its notes only, and says so', () => {
    const level = levelFromFacts({ ...FULL, questions: null, coverage: null });
    expect(level.partial).toBe(true);
    expect(level.percent).toBe(100);
    expect(level.parts.filter((p) => !p.measured).map((p) => p.id)).toEqual(['questions', 'coverage']);
    const half = levelFromFacts({ questions: null, coverage: null, pages: pages('fresh'), work: 0, quality: 0 });
    expect(half.percent).toBe(50);
  });

  it('never says more than « solid » while the code is not linked: nobody read it', () => {
    const level = levelFromFacts({ ...FULL, questions: null, coverage: null });
    expect(level.percent).toBe(100);
    expect(level.tier).toBe('solid');
  });

  it('lists the next steps by the points they bring, the biggest first', () => {
    const level = levelFromFacts({ ...FULL, pages: pages('fresh', { 'repo-start': 'missing' }), work: 3, quality: 60 });
    const points = level.next.map((g) => g.points);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
    expect(level.next.length).toBeLessThanOrEqual(3);
    expect(level.next.some((g) => g.key === 'knowledge.gap.page' && g.params.kind === 'repo-start')).toBe(true);
  });
});

describe('the knowledge level of a real brain', () => {
  it('measures an unlinked repository of the demo on its pages', async () => {
    const { config, env } = await demoBrain();
    const [repo] = await brainRepos(config, env);
    const level = await repoLevel(config, repo!, { env });
    expect(level.partial).toBe(true);
    expect(level.percent).toBeGreaterThan(0);
    expect(level.percent).toBeLessThan(100);
    // The demo repository has its page, Démarrer, Tester, Déboguer and its code map: three pages are missing.
    expect(level.next.some((g) => g.key === 'knowledge.gap.page')).toBe(true);
  }, 60_000);
});

describe('the knowledge level, shown', () => {
  it('okb repo level lists every repository of the brain with its level and next steps', async () => {
    const { json } = await import('./helpers/team.js');
    const { env, dir } = await demoBrain();
    const r = await json(['repo', 'level'], env, dir);
    expect(r.ok).toBe(true);
    expect(r.repos).toHaveLength(2);
    for (const x of r.repos) {
      expect(x).toMatchObject({ linked: false, partial: true });
      expect(x.percent).toBeGreaterThan(0);
      expect(['discovery', 'usable', 'solid', 'expert', 'reference']).toContain(x.tier);
    }
  }, 60_000);

  it('the web app gives the level of unlinked repositories', async () => {
    const { serve } = await import('../src/web/serve.js');
    const { config, env } = await demoBrain();
    const { server, url } = await serve(config, { port: 0, env });
    try {
      const list = (await (await fetch(`${url}/api/repos`)).json()) as { unlinked: { level: { percent: number; tier: string; next: unknown[] } }[] };
      expect(list.unlinked[0]!.level.percent).toBeGreaterThan(0);
      expect(list.unlinked[0]!.level.next.length).toBeGreaterThan(0);
    } finally {
      server.closeAllConnections(); server.close();
    }
  }, 60_000);
});

describe('answers age with their notes (review I5)', () => {
  it('an answered question whose note went stale counts as half', async () => {
    const { questionCounts } = await import('../src/knowledge/level.js');
    const verdict = new Map([['a.md', 'stale'], ['b.md', 'fresh'], ['c.md', 'changed']]);
    const counts = questionCounts([
      { state: 'answered', note: 'a.md' }, { state: 'answered', note: 'b.md' }, { state: 'answered', note: 'c.md' },
      { state: 'found' }, { state: 'open' },
    ], verdict);
    expect(counts).toEqual({ answered: 2, half: 2 });
  });
});
