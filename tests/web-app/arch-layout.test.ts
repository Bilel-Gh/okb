import { describe, expect, it } from 'vitest';
import { layoutMap, type MapBox, type MapArrow } from '../../web-app/src/pages/arch-layout.js';

const box = (id: string, kind: MapBox['kind'] = 'repo'): MapBox => ({ id, kind, name: id, tech: id });
const arrow = (from: string, to: string, kind: MapArrow['kind'] = 'http'): MapArrow => ({ id: `${kind}:${from}>${to}`, from, to, kind });

/** The fictitious shop: web → orders → payments; orders ⇢ shipping (event) → orders (back); both APIs use a library; orders stores data; web calls an outside host. */
const SHOP = {
  boxes: [box('web'), box('orders'), box('payments'), box('shipping'), box('money'), box('db', 'datastore'), box('geo', 'external')],
  arrows: [
    arrow('web', 'orders'), arrow('orders', 'payments'), arrow('orders', 'shipping', 'event'), arrow('shipping', 'orders'),
    arrow('orders', 'money', 'package'), arrow('payments', 'money', 'package'), arrow('orders', 'db', 'data'), arrow('web', 'geo', 'external'),
  ],
};

describe('the system map is laid out like a metro map', () => {
  it('reads left to right from the way in, libraries on a line below, outside systems after their caller', () => {
    const map = layoutMap(SHOP);
    const at = (id: string) => map.stations.find((s) => s.id === id)!;
    expect(at('web').x).toBeLessThan(at('orders').x);
    expect(at('orders').x).toBeLessThan(at('payments').x);
    expect(at('orders').x).toBeLessThan(at('shipping').x);
    expect(at('money').y).toBeGreaterThan(Math.max(at('orders').y, at('payments').y, at('shipping').y));
    expect(at('db').x).toBe(at('orders').x);
    expect(at('db').y).toBeGreaterThan(at('orders').y);
    // Next to what calls it, not across the whole map (its line used to cross everything).
    expect(at('geo').x).toBeGreaterThan(at('web').x);
  });

  it('never puts two stations on the same spot, and the drawing holds them all', () => {
    const map = layoutMap(SHOP);
    const spots = map.stations.map((s) => `${s.x},${s.y}`);
    expect(new Set(spots).size).toBe(spots.length);
    for (const s of map.stations) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(map.width);
      expect(s.y).toBeLessThan(map.height);
    }
  });

  it('draws lines with horizontal, vertical and 45° segments only, and sends a call back on a lane of its own', () => {
    const map = layoutMap(SHOP);
    for (const e of map.edges) {
      const points = [...e.d.matchAll(/[ML] ?(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      expect(points.length, e.id).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < points.length; i++) {
        const dx = Math.abs(points[i]![0] - points[i - 1]![0]);
        const dy = Math.abs(points[i]![1] - points[i - 1]![1]);
        expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 0.01, `${e.id} segment ${i}`).toBe(true);
        expect(dx + dy, `${e.id} segment ${i} has a length`).toBeGreaterThan(0);
      }
    }
    const back = map.edges.find((e) => e.id === 'http:shipping>orders')!;
    expect(back.back).toBe(true);
    // On a lane of its own, half a row away from the stations (above or below, whichever crosses nothing).
    expect(Math.abs(back.ly - map.stations.find((s) => s.id === 'orders')!.y)).toBeGreaterThanOrEqual(60);
  });

  it('never runs a line through a station it does not join, and puts an outside system next to its caller', () => {
    const map = layoutMap(SHOP);
    for (const e of map.edges) {
      const points = [...e.d.matchAll(/[ML] ?(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      for (const s of map.stations.filter((x) => x.id !== e.from && x.id !== e.to)) {
        for (let i = 1; i < points.length; i++) {
          const [ax, ay] = points[i - 1]!;
          const [bx, by] = points[i]!;
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const u = Math.max(0, Math.min(1, ((s.x - ax) * (bx - ax) + (s.y - ay) * (by - ay)) / (len * len)));
          expect(Math.hypot(ax + u * (bx - ax) - s.x, ay + u * (by - ay) - s.y), `${e.id} crosses ${s.id}`).toBeGreaterThan(16);
        }
      }
    }
    const at = (id: string) => map.stations.find((s) => s.id === id)!;
    expect(at('geo').x - at('web').x).toBeLessThanOrEqual(232);
  });

  it('copes with a lone repository and with a loop of calls', () => {
    expect(layoutMap({ boxes: [box('solo')], arrows: [] }).stations).toHaveLength(1);
    const loop = layoutMap({ boxes: [box('a'), box('b')], arrows: [arrow('a', 'b'), arrow('b', 'a')] });
    expect(loop.stations.map((s) => s.x)).toEqual([...new Set(loop.stations.map((s) => s.x))]);
  });
});

describe('architecture labels and shared infrastructure', () => {
  it('allocates room for a full long name and keeps shared and orphan databases distinct', () => {
    const boxes = [box('front'), { ...box('api'), name: 'Service de gestion des commandes internationales et des remboursements auprès des fournisseurs partenaires' }, box('db', 'datastore'), box('orphan1', 'datastore'), box('orphan2', 'datastore')];
    const map = layoutMap({ boxes, arrows: [arrow('front', 'api'), arrow('front', 'db', 'data'), arrow('api', 'db', 'data')] });
    expect(new Set(map.stations.map((s) => `${s.x},${s.y}`)).size).toBe(boxes.length);
    expect(map.stations.find((s) => s.id === 'api')?.nameLines.join(' ')).toBe(boxes[1]!.name);
    for (const s of map.stations) expect(s.y + s.labelHeight).toBeLessThan(map.height);
  });
  it('preserves a self-call, and returns finite bounds for an empty map', () => {
    const map = layoutMap({ boxes: [box('api')], arrows: [arrow('api', 'api')] });
    expect(map.edges).toHaveLength(1);
    const empty = layoutMap({ boxes: [], arrows: [] });
    expect(Number.isFinite(empty.width) && Number.isFinite(empty.height)).toBe(true);
  });
});

describe('return corridors remain inside the drawing', () => {
  it('holds a cycle returning to the first column, including its outside routing lanes', () => {
    const map = layoutMap({ boxes: [box('a'), box('b'), box('c')], arrows: [arrow('a', 'b'), arrow('b', 'c'), arrow('c', 'a')] });
    for (const e of map.edges) {
      const points = [...e.d.matchAll(/[ML] ?(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      for (const [x, y] of points) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(map.width); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(map.height); }
    }
  });
});
