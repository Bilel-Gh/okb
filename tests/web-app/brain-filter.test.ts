import { describe, expect, it } from 'vitest';
import { activeFilters, applyFilters, readFilters, sortNotes, writeFilters } from '../../web-app/src/pages/brain-filter.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const N = [
  { title: 'Bêta', category: 'concept', status: 'stable', at: '2026-10-08T10:00:00Z', stars: 4, secret: false },
  { title: 'alpha', category: 'guide', status: 'draft', at: '2026-08-01T10:00:00Z', stars: 2, secret: false },
  { title: 'Gamma', category: 'concept', status: 'stable', at: null, stars: null, secret: true },
  { title: 'Delta', category: 'decision', status: 'stable', at: '2025-01-01T10:00:00Z', stars: 5, secret: false },
];
const titles = (xs: readonly { title: string }[]) => xs.map((x) => x.title);

describe('the filters of the explorer', () => {
  it('reads and writes them in the address, the defaults left out', () => {
    const f = readFilters({ cat: 'concept,guide', status: 'draft', quality: 'weak', since: '30d', secret: 'hide', sort: 'recent', in: 'x' });
    expect(f).toEqual({ cats: ['concept', 'guide'], status: 'draft', quality: 'weak', since: '30d', secret: 'hide', sort: 'recent' });
    expect(writeFilters(f)).toEqual({ cat: 'concept,guide', status: 'draft', quality: 'weak', since: '30d', secret: 'hide', sort: 'recent' });
    expect(writeFilters(readFilters({}))).toEqual({ cat: '', status: '', quality: '', since: '', secret: '', sort: '' });
    expect(readFilters({ quality: 'nonsense', since: '2w', sort: 'size' })).toMatchObject({ quality: '', since: '', sort: 'title' });
  });

  it('combines them: types, status, quality, date, 🔒', () => {
    expect(titles(applyFilters(N, readFilters({ cat: 'concept' }), NOW))).toEqual(['Bêta', 'Gamma']);
    expect(titles(applyFilters(N, readFilters({ cat: 'concept', secret: 'hide' }), NOW))).toEqual(['Bêta']);
    expect(titles(applyFilters(N, readFilters({ secret: 'only' }), NOW))).toEqual(['Gamma']);
    expect(titles(applyFilters(N, readFilters({ quality: 'weak' }), NOW))).toEqual(['alpha']);
    expect(titles(applyFilters(N, readFilters({ quality: 'good' }), NOW))).toEqual(['Bêta', 'Delta']);
    expect(titles(applyFilters(N, readFilters({ since: '7d' }), NOW))).toEqual(['Bêta']);
    expect(titles(applyFilters(N, readFilters({ since: '1y' }), NOW))).toEqual(['Bêta', 'alpha']);
    expect(titles(applyFilters(N, readFilters({ status: 'draft' }), NOW))).toEqual(['alpha']);
  });

  it('counts the active ones, the sort aside', () => {
    expect(activeFilters(readFilters({ cat: 'a,b', secret: 'hide', sort: 'recent' }))).toBe(2);
    expect(activeFilters(readFilters({}))).toBe(0);
  });
});

describe('the order of the list', () => {
  it('by title, accents and case aside', () => {
    expect(titles(sortNotes(N, 'title'))).toEqual(['alpha', 'Bêta', 'Delta', 'Gamma']);
  });

  it('the most recent first, the undated last', () => {
    expect(titles(sortNotes(N, 'recent'))).toEqual(['Bêta', 'alpha', 'Delta', 'Gamma']);
  });

  it('the best first, the unscored last', () => {
    expect(titles(sortNotes(N, 'quality'))).toEqual(['Delta', 'Bêta', 'alpha', 'Gamma']);
  });
});
