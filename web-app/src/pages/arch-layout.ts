/**
 * The system map laid out like a metro map: the ways in on the left, each
 * repository one column after those that call it, its databases right under
 * it, shared libraries on a line of their own at the bottom, outside systems
 * at the far right. Lines use corridors between columns; return calls and calls spanning a
 * column use separate lanes above the stations. Full names wrap, with row
 * spacing derived from their height.
 */
export type MapBox = { readonly id: string; readonly kind: 'repo' | 'datastore' | 'external' | 'system'; readonly name: string; readonly tech: string };
export type MapArrow = { readonly id: string; readonly from: string; readonly to: string; readonly kind: 'http' | 'event' | 'package' | 'service' | 'data' | 'external' };
export type Station = MapBox & { readonly x: number; readonly y: number; readonly nameLines: readonly string[]; readonly techLines: readonly string[]; readonly labelHeight: number };
export type MapEdge = { readonly id: string; readonly from: string; readonly to: string; readonly kind: MapArrow['kind']; readonly d: string; readonly lx: number; readonly ly: number; readonly back: boolean };
export type MapLayout = { readonly stations: Station[]; readonly edges: MapEdge[]; readonly width: number; readonly height: number };

export const COL = 232;
export const ROW = 128;
const PAD_X = 132;
const PAD_Y = 48;
/** Room under the lowest station for its two-line label. */
const LABEL_ROOM = 64;

/** Wrap all words without losing characters, including long technical identifiers. */
export function labelLines(text: string, size = 28): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + word.length + 1 > size) { lines.push(line); line = ''; }
    let rest = word;
    while (rest.length > size) { if (line) { lines.push(line); line = ''; } lines.push(rest.slice(0, size)); rest = rest.slice(size); }
    line += `${line ? ' ' : ''}${rest}`;
  }
  if (line) lines.push(line);
  return lines;
}
const FLOW = new Set<MapArrow['kind']>(['http', 'event', 'service']);

type Point = readonly [number, number];

export function layoutMap(view: { readonly boxes: readonly MapBox[]; readonly arrows: readonly MapArrow[] }): MapLayout {
  if (!view.boxes.length) return { stations: [], edges: [], width: COL, height: ROW };
  const names = new Map(view.boxes.map((b) => [b.id, labelLines(b.name)]));
  const techs = new Map(view.boxes.map((b) => [b.id, b.tech !== b.name ? labelLines(b.tech, 32) : []]));
  const labelHeight = (id: string) => 30 + names.get(id)!.length * 17 + techs.get(id)!.length * 15;
  const rowGap = Math.max(ROW, ...view.boxes.map((b) => labelHeight(b.id) + 36));
  const known = new Set(view.boxes.map((b) => b.id));
  const arrows = view.arrows.filter((a) => known.has(a.from) && known.has(a.to));
  const flow = arrows.filter((a) => FLOW.has(a.kind) && a.from !== a.to);
  const byName = (a: MapBox, b: MapBox) => a.name.localeCompare(b.name);

  const core = view.boxes.filter((b) => b.kind === 'repo' || b.kind === 'system');
  const linked = new Set(arrows.flatMap((a) => [a.from, a.to]));
  const inFlow = new Set(flow.flatMap((a) => [a.from, a.to]));
  // Libraries (only used, never called) and loose repositories go on the bottom line.
  const bottom = core.length > 1 ? core.filter((b) => !inFlow.has(b.id) && (!linked.has(b.id) || arrows.some((a) => a.kind === 'package' && a.to === b.id))) : [];
  const main = core.filter((b) => !bottom.includes(b));
  const isMain = new Set(main.map((b) => b.id));

  // Break loops of calls: a depth-first walk from the ways in marks the arrows going back.
  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const a of flow.filter((x) => x.from === id && isMain.has(x.to))) {
      const s = state.get(a.to);
      if (s === 'open') back.add(a.id);
      else if (!s) visit(a.to);
    }
    state.set(id, 'done');
  };
  const called = new Set(flow.map((a) => a.to));
  for (const b of [...main.filter((x) => !called.has(x.id)).sort(byName), ...[...main].sort(byName)]) if (!state.has(b.id)) visit(b.id);

  // Columns: the longest chain of calls leading to each repository.
  const col = new Map(main.map((b) => [b.id, 0]));
  for (let pass = 0; pass <= main.length; pass++) {
    let changed = false;
    for (const a of flow) {
      if (back.has(a.id) || !col.has(a.from) || !col.has(a.to)) continue;
      const c = col.get(a.from)! + 1;
      if (c > col.get(a.to)!) { col.set(a.to, c); changed = true; }
    }
    if (!changed) break;
  }
  const lastCol = Math.max(0, ...col.values());

  // Rows: column by column, near the callers (barycentre), each repository followed by its databases.
  const row = new Map<string, number>();
  const stores = (id: string) => view.boxes.filter((b) => b.kind === 'datastore' && arrows.some((a) => a.from === id && a.to === b.id)).sort(byName);
  const callers = (id: string) => flow.filter((a) => a.to === id && !back.has(a.id) && row.has(a.from)).map((a) => row.get(a.from)!);
  const centre = (id: string) => { const c = callers(id); return c.length ? c.reduce((n, r) => n + r, 0) / c.length : Number.POSITIVE_INFINITY; };
  let lowest = -1;
  for (let c = 0; c <= lastCol; c++) {
    // A repository that calls back to the left goes first, so its call climbs to a lane with nothing in the way.
    const callsBack = (id: string) => (flow.some((a) => a.from === id && back.has(a.id)) ? 0 : 1);
    const here = main.filter((b) => col.get(b.id) === c).sort((a, b) => centre(a.id) - centre(b.id) || callsBack(a.id) - callsBack(b.id) || byName(a, b));
    let r = 0;
    for (const b of here) {
      // Start level with the callers when there is room, so lines stay straight.
      const want = Number.isFinite(centre(b.id)) ? Math.round(centre(b.id)) : r;
      r = Math.max(r, want);
      row.set(b.id, r);
      for (const s of stores(b.id).filter((s) => !row.has(s.id))) { r += 1; col.set(s.id, c); row.set(s.id, r); }
      lowest = Math.max(lowest, r);
      r += 1;
    }
  }
  // Outside systems in the column after their callers, on the first free spot level with them or below.
  const taken = new Set([...row.keys()].map((id) => `${col.get(id)},${row.get(id)}`));
  const outside = view.boxes.filter((b) => b.kind === 'external').sort((a, b) => {
    const at = (id: string) => Math.min(Number.POSITIVE_INFINITY, ...arrows.filter((x) => x.to === id && row.has(x.from)).map((x) => row.get(x.from)!));
    return at(a.id) - at(b.id) || byName(a, b);
  });
  for (const e of outside) {
    const from = arrows.filter((x) => x.to === e.id && row.has(x.from)).map((x) => x.from);
    const c = from.length ? Math.max(...from.map((id) => col.get(id)!)) + 1 : (main.length ? lastCol + 1 : 0);
    let r = from.length ? Math.min(...from.map((id) => row.get(id)!)) : 0;
    while (taken.has(`${c},${r}`)) r += 1;
    taken.add(`${c},${r}`);
    col.set(e.id, c);
    row.set(e.id, r);
    lowest = Math.max(lowest, r);
  }

  // The bottom line: each library under the repositories that use it, never two on one spot.
  const bottomRow = lowest + 1;
  for (const b of [...bottom].sort(byName)) {
    const users = arrows.filter((a) => a.to === b.id && col.has(a.from)).map((a) => col.get(a.from)!);
    let c = users.length ? Math.round(users.reduce((n, v) => n + v, 0) / users.length) : 0;
    while (taken.has(`${c},${bottomRow}`)) c += 1;
    taken.add(`${c},${bottomRow}`);
    col.set(b.id, c);
    row.set(b.id, bottomRow);
  }
  for (const b of view.boxes.filter((x) => !row.has(x.id))) { // a database of a bottom-line repository
    col.set(b.id, col.get(arrows.find((a) => a.to === b.id)?.from ?? '') ?? 0);
    let r = bottomRow + 1;
    const c = col.get(b.id)!;
    while (taken.has(`${c},${r}`)) r += 1;
    taken.add(`${c},${r}`);
    row.set(b.id, r);
  }

  // A call going back runs on a lane of its own, above or below the stations it spans: the side whose
  // climb from either end crosses no other station (above when both are clear).
  const place = (id: string): Point => [PAD_X + col.get(id)! * COL, row.get(id)! * rowGap];
  const lanePlan = new Map<string, number>();
  // Return calls and calls spanning a column use separate lanes above the map.
  // A corridor between columns keeps the vertical segment out of every label.
  for (const a of arrows.filter((x) => x.from !== x.to && (back.has(x.id) || col.get(x.to)! < col.get(x.from)! || Math.abs(col.get(x.to)! - col.get(x.from)!) > 1))) {
    lanePlan.set(a.id, -rowGap / 2 - lanePlan.size * 12);
  }
  const top = PAD_Y + Math.max(0, ...[...lanePlan.values()].map((y) => 24 - y));

  const stations: Station[] = view.boxes.map((b) => { const [x, y] = place(b.id); return { ...b, x, y: y + top, nameLines: names.get(b.id)!, techLines: techs.get(b.id)!, labelHeight: labelHeight(b.id) }; });
  const at = new Map(stations.map((s) => [s.id, s]));
  const maxX = Math.max(...stations.map((s) => s.x));
  const maxY = Math.max(...stations.map((s) => s.y));

  // Lines. Two lines between the same stations are drawn side by side.
  const twins = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const a of arrows) { const pair = [a.from, a.to].sort().join('|'); pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1); }
  const edges: MapEdge[] = arrows.map((a) => {
    const s = at.get(a.from)!;
    const t = at.get(a.to)!;
    const pair = [a.from, a.to].sort().join('|');
    const n = twins.get(pair) ?? 0;
    twins.set(pair, n + 1);
    const shift = (n - (pairCount.get(pair)! - 1) / 2) * 6;
    const planned = lanePlan.get(a.id);
    let points: Point[];
    let label: Point;
    if (a.from === a.to) {
      points = [[s.x - 8, s.y], [s.x - 32, s.y - 24], [s.x - 32, s.y - 36], [s.x + 32, s.y - 36], [s.x + 32, s.y - 24], [s.x + 8, s.y]];
      label = [s.x, s.y - 36];
    } else if (planned !== undefined) {
      const lane = planned + top;
      const fromLane = s.x + COL / 2;
      const toLane = t.x - COL / 2;
      points = [[s.x, s.y], [fromLane, s.y], [fromLane, lane], [toLane, lane], [toLane, t.y], [t.x, t.y]];
      label = [(fromLane + toLane) / 2, lane];
    } else {
      const corridor = s.x === t.x ? s.x + COL / 2 + shift : (s.x + t.x) / 2 + shift;
      points = s.y === t.y ? [[s.x, s.y + shift], [t.x, t.y + shift]] : [[s.x, s.y + shift], [corridor, s.y + shift], [corridor, t.y + shift], [t.x, t.y + shift]];
      label = [corridor, (s.y + t.y) / 2];
    }
    return { id: a.id, from: a.from, to: a.to, kind: a.kind, d: path(trim(points, 12, 16)), lx: label[0], ly: label[1], back: planned !== undefined };
  });
  return { stations, edges, width: maxX + PAD_X, height: Math.max(maxY + LABEL_ROOM, ...stations.map((s) => s.y + s.labelHeight + 20)) };
}

/** Shorten the first and last segments so a line stops at a station's ring and its arrow shows. */
function trim(points: Point[], start: number, end: number): Point[] {
  // A segment of no length has no direction: drop it first.
  const out = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
  const cut = (from: Point, to: Point, by: number): Point => {
    const dx = Math.sign(to[0] - from[0]);
    const dy = Math.sign(to[1] - from[1]);
    // On a diagonal both axes move by the same amount, so it stays at 45°; never past the segment's other end.
    const room = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) - 1;
    const k = Math.max(0, Math.min(room, dx && dy ? Math.round(by / Math.SQRT2) : by));
    return [from[0] + dx * k, from[1] + dy * k];
  };
  out[0] = cut(out[0]!, out[1]!, start);
  out[out.length - 1] = cut(out[out.length - 1]!, out[out.length - 2]!, end);
  return out;
}

const path = (points: readonly Point[]) => points.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
