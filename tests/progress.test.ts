import { describe, expect, it } from 'vitest';
import { badgesOf, levelOf, xpOf, type Activity } from '../src/progress/progress.js';

const day = (d: number, h = 9) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
const reads = (d: number, paths: string[]): Activity[] => paths.map((path, i) => ({ kind: 'read', at: day(d, 8 + (i % 10)), key: path }));
const reviews = (d: number, n: number): Activity[] => Array.from({ length: n }, (_, i) => ({ kind: 'review', at: day(d, 8 + (i % 10)), key: `c-${d}-${i}` }));

describe('experience points, personal and local (roadmap §5.2)', () => {
  it('gives less for the fiftieth review of the day than for the first ones', () => {
    const ten = xpOf(reviews(1, 10)).total;
    const fifty = xpOf(reviews(1, 50)).total;
    expect(fifty).toBeGreaterThan(ten);
    expect(fifty).toBeLessThan(ten * 2.5);
    // Spread over five days, the same fifty reviews are worth more.
    const spread = xpOf([1, 2, 3, 4, 5].flatMap((d) => reviews(d, 10))).total;
    expect(spread).toBeGreaterThan(fifty * 1.8);
  });

  it('counts a note read twice the same day once', () => {
    expect(xpOf(reads(1, ['a.md', 'a.md', 'a.md'])).total).toBe(xpOf(reads(1, ['a.md'])).total);
    expect(xpOf([...reads(1, ['a.md']), ...reads(2, ['a.md'])]).total).toBe(xpOf(reads(1, ['a.md'])).total * 2);
  });

  it('levels: 0 → 1, 50 → 2, 150 → 3, 300 → 4', () => {
    expect(levelOf(0)).toMatchObject({ level: 1, from: 0, to: 50 });
    expect(levelOf(49).level).toBe(1);
    expect(levelOf(50)).toMatchObject({ level: 2, from: 50, to: 150 });
    expect(levelOf(300).level).toBe(4);
  });
});

describe('badges, bronze then silver then gold', () => {
  it('reader: distinct notes read, 10, 50, 200', () => {
    const reader = (n: number) => badgesOf(reads(1, Array.from({ length: n }, (_, i) => `n${i}.md`)), new Date(day(1, 20))).find((b) => b.id === 'reader')!;
    expect(reader(9)).toMatchObject({ tier: 'none', count: 9, next: 10 });
    expect(reader(10)).toMatchObject({ tier: 'bronze', next: 50 });
    expect(reader(60)).toMatchObject({ tier: 'silver', next: 200 });
  });

  it('streak: consecutive days with something done, up to today', () => {
    const acts = [1, 2, 3, 5, 6].flatMap((d) => reviews(d, 1));
    const s = badgesOf(acts, new Date(day(6, 20))).find((b) => b.id === 'streak')!;
    // Best run is 3 days (1, 2, 3): bronze; the current run is 2 (5, 6).
    expect(s).toMatchObject({ tier: 'bronze', count: 3 });
    expect(xpOf(acts, new Date(day(6, 20))).streak).toEqual({ current: 2, best: 3 });
  });
});

describe('progress read from what OKB already records', () => {
  it('a fresh brain is level 1; two notes opened give 2 XP and show in okb progress', async () => {
    const { demoBrain } = await import('./helpers/brain.js');
    const { progress } = await import('../src/progress/progress.js');
    const { appendLine } = await import('../src/util/fsx.js');
    const { statePaths } = await import('../src/state/paths.js');
    const { resolve } = await import('node:path');
    const { json } = await import('./helpers/team.js');
    const { config, env, dir } = await demoBrain();
    expect((await progress(config)).level.level).toBe(1);
    const file = resolve(statePaths(config).root, 'usage', 'notes.jsonl');
    const at = new Date().toISOString();
    for (const path of ['a.md', 'b.md', 'a.md']) await appendLine(file, JSON.stringify({ at, path, kind: 'open' }));
    const p = await progress(config);
    expect(p.xp).toBe(2);
    // The second read of the day is worth a little less (0.93).
    expect(p.today).toBeCloseTo(1.9, 1);
    const cli = await json(['progress'], env, dir);
    expect(cli).toMatchObject({ ok: true, xp: 2, level: { level: 1 } });
  }, 60_000);
});
