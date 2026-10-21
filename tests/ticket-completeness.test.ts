import { describe, expect, it } from 'vitest';
import { completeness, RUBRICS } from '../src/work/ticket-completeness.js';
import type { FieldValue, FieldName } from '../src/work/ticket-fields.js';

const v = (field: FieldName, value = 'une vraie valeur'): FieldValue => ({ field, value, origin: 'agent', url: null, at: '2026-10-19T00:00:00Z', manual: false });
const fields = (...names: FieldName[]) => Object.fromEntries(names.map((n) => [n, v(n)]));
const none = { fields: {}, notApplicable: {}, criteria: [], hasNext: false, repos: 0 };

describe('context completeness is what we know, not progress (F2.4-12)', () => {
  it('0 % when nothing is known', () => {
    expect(completeness(none)).toEqual({ percent: 0, present: [], missing: [...RUBRICS], notApplicable: [] });
  });

  it('10 % with only a repository', () => {
    expect(completeness({ ...none, repos: 1 }).percent).toBe(10);
  });

  it('70 % with seven rubrics, team or product counting as one', () => {
    const r = completeness({ ...none, fields: fields('title', 'summary', 'description', 'product', 'done'), hasNext: true, repos: 1 });
    expect(r.percent).toBe(70);
    expect(r.missing).toEqual(['criteria', 'sourceStatus', 'blocker']);
  });

  it('100 % when everything is there', () => {
    const r = completeness({ ...none, fields: fields('title', 'summary', 'description', 'sourceStatus', 'team', 'done', 'blocker'), criteria: [{ text: 'Les remises restent après conversion' }], hasNext: true, repos: 2 });
    expect(r.percent).toBe(100);
  });

  it('a rubric declared not applicable leaves the denominator', () => {
    const r = completeness({ ...none, fields: fields('title', 'summary', 'description', 'sourceStatus', 'team', 'done', 'blocker'), notApplicable: { criteria: 'investigation' }, hasNext: true, repos: 1 });
    expect(r).toMatchObject({ percent: 100, notApplicable: ['criteria'], missing: [] });
  });

  it('an empty criterion does not count', () => {
    expect(completeness({ ...none, criteria: [{ text: '  ' }] }).present).not.toContain('criteria');
  });

  it('is deterministic', () => {
    const input = { ...none, fields: fields('blocker', 'title'), repos: 1 };
    expect(completeness(input)).toEqual(completeness(input));
    expect(completeness(input).present).toEqual(['title', 'blocker', 'repo']);
  });
});
