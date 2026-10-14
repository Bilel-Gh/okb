import type { MapArrow, MapBox } from './arch-layout';

export const INITIAL_BOXES = 8;

/** Prefer a way in; cycles fall back to a stable repository name. */
export function initialFocus(boxes: readonly MapBox[], arrows: readonly MapArrow[]): string {
  const repos = boxes.filter((b) => b.kind === 'repo').sort((a, b) => a.name.localeCompare(b.name));
  return (repos.find((b) => arrows.some((a) => a.from === b.id) && !arrows.some((a) => a.to === b.id && a.kind === 'http')) ?? repos[0] ?? boxes[0])?.id ?? '';
}

/** The selected repository and its immediate neighbours, with every omission explicit. */
export function exploreMap<B extends MapBox, A extends MapArrow>(view: { boxes: readonly B[]; arrows: readonly A[] }, options: { focus?: string; expanded?: readonly string[]; limit?: number } = {}) {
  const known = new Map(view.boxes.map((b) => [b.id, b]));
  const focus = options.focus && known.has(options.focus) ? options.focus : '';
  const neighbours = view.arrows.filter((a) => a.from === focus || a.to === focus).flatMap((a) => [a.from, a.to]);
  const ordered = focus ? [...new Set([focus, ...neighbours])] : view.boxes.map((b) => b.id);
  const visible = new Set([...ordered.slice(0, options.limit ?? INITIAL_BOXES), ...(options.expanded ?? [])]);
  const boxes = view.boxes.filter((b) => visible.has(b.id));
  const arrows = view.arrows.filter((a) => visible.has(a.from) && visible.has(a.to));
  const hidden = view.boxes.filter((b) => !visible.has(b.id));
  const groups = (['repo', 'datastore', 'external', 'system'] as const).map((kind) => ({ kind, members: hidden.filter((b) => b.kind === kind) })).filter((g) => g.members.length);
  return { boxes, arrows, hidden, groups, hiddenRelations: view.arrows.length - arrows.length, hiddenNeighbours: [...new Set(neighbours)].filter((id) => !visible.has(id)).length };
}
