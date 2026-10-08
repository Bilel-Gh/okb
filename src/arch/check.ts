import type { SystemModel } from './model.js';
import { MAX_BOXES, type View } from './views.js';

/**
 * Before a diagram is shown, it checks itself (roadmap §4, step 4): every arrow
 * has its evidence and a verb, every box a name people understand, no box is
 * left alone without a reason, the view stays readable. Below 80 the gaps are
 * shown rather than a poor diagram.
 */
export type Finding = { readonly code: 'no-evidence' | 'no-verb' | 'unreadable-name' | 'isolated' | 'too-many' | 'to-confirm'; readonly target: string; readonly penalty: number };

const TECHNICAL = /^[a-z0-9]+([-_.][a-z0-9]+)+$|^[a-z]+\d+$/;

export function checkDiagram(model: SystemModel, view: View): { score: number; findings: Finding[] } {
  const findings: Finding[] = [];
  for (const a of view.arrows) {
    if (!a.evidence.length && a.id !== 'ext:others') findings.push({ code: 'no-evidence', target: a.id, penalty: 15 });
    if (!a.verb.trim()) findings.push({ code: 'no-verb', target: a.id, penalty: 8 });
    if (a.confidence !== 'sure') findings.push({ code: 'to-confirm', target: a.id, penalty: 2 });
  }
  for (const b of view.boxes) {
    if (b.kind === 'repo' && b.name === b.tech && TECHNICAL.test(b.name)) findings.push({ code: 'unreadable-name', target: b.id, penalty: 5 });
    const linked = view.arrows.some((a) => a.from === b.id || a.to === b.id);
    if (!linked && view.boxes.length > 1 && b.kind === 'repo') findings.push({ code: 'isolated', target: b.id, penalty: 5 });
  }
  if (view.boxes.length > MAX_BOXES) findings.push({ code: 'too-many', target: view.kind, penalty: 15 });
  void model;
  const score = Math.max(0, 100 - findings.reduce((n, f) => n + f.penalty, 0));
  return { score, findings };
}
