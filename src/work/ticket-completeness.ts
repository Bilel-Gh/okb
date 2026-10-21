import type { FieldName, FieldValue, NaTarget } from './ticket-fields.js';

/**
 * « Context filled: N % » (F2.4-12, D70): how much we know about a ticket to pick
 * it up, never how far the work went. Ten rubrics of equal weight; a rubric the
 * person declared not applicable leaves the count. Pure and deterministic.
 */
export const RUBRICS = ['title', 'summary', 'description', 'criteria', 'sourceStatus', 'teamProduct', 'done', 'next', 'blocker', 'repo'] as const;
export type Rubric = (typeof RUBRICS)[number];
export type Completeness = { readonly percent: number; readonly present: Rubric[]; readonly missing: Rubric[]; readonly notApplicable: Rubric[] };

export type CompletenessInput = {
  readonly fields: Partial<Record<FieldName, FieldValue>>;
  readonly notApplicable: Partial<Record<NaTarget, string>>;
  readonly criteria: readonly { readonly text: string }[];
  readonly hasNext: boolean;
  readonly repos: number;
};

export function completeness(input: CompletenessInput): Completeness {
  const has = (f: FieldName) => Boolean(input.fields[f]?.value.trim());
  const na = (t: NaTarget) => Boolean(input.notApplicable[t]);
  const present: Rubric[] = [], missing: Rubric[] = [], notApplicable: Rubric[] = [];
  for (const r of RUBRICS) {
    const skip = r === 'teamProduct' ? na('team') && na('product') : r === 'next' || r === 'blocker' || r === 'repo' ? false : na(r as NaTarget);
    if (skip) { notApplicable.push(r); continue; }
    const ok = r === 'teamProduct' ? has('team') || has('product')
      : r === 'criteria' ? input.criteria.some((c) => c.text.trim())
        : r === 'next' ? input.hasNext
          : r === 'repo' ? input.repos > 0
            : has(r);
    (ok ? present : missing).push(r);
  }
  const applicable = present.length + missing.length;
  return { percent: applicable ? Math.round((present.length * 100) / applicable) : 0, present, missing, notApplicable };
}
