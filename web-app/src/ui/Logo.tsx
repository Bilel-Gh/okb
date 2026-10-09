import { useId } from 'react';

/**
 * The OKB mark: the linked note, o—•, a note that calls another (chosen on
 * 9 October 2026; every other proposal is kept in docs/design/logos/). Two forms:
 * `linked` on the theme's gradient (the default) and `linked-dark` on a deep
 * ground with the linked note in the theme's colour. Both in gradient.
 */
export type LogoId = 'linked' | 'linked-dark';
export const LOGOS: readonly LogoId[] = ['linked', 'linked-dark'];

/** The gradients of each theme: the tile (a → b), the deep tile, the linked note. */
export type LogoColors = { readonly a: string; readonly b: string; readonly darkA: string; readonly darkB: string; readonly nodeA: string; readonly nodeB: string };
export const LOGO_COLORS: Readonly<Record<'atelier' | 'classique', LogoColors>> = {
  atelier: { a: '#9a8bff', b: '#4b3ad4', darkA: '#2c2655', darkB: '#121119', nodeA: '#b9afff', nodeB: '#7c6cf6' },
  classique: { a: '#19c991', b: '#0b6f86', darkA: '#123a2e', darkB: '#0a0e13', nodeA: '#8af0c7', nodeB: '#14b886' },
};

/** A rounded square with soft corners, like an app icon. */
const TILE = 'M16 1C27.4 1 31 4.6 31 16S27.4 31 16 31 1 27.4 1 16 4.6 1 16 1Z';

type Paint = { tileA: string; tileB: string; nodeA: string; nodeB: string };

/** The drawing, shared by the page and the tab icon; `fill` decides how a colour is written. */
function parts(logo: LogoId, id: string, paint: Paint, attr: (name: string, value: string) => string): string {
  const stop = (offset: string, color: string, opacity?: string) => `<stop offset="${offset}" ${attr('stop-color', color)}${opacity ? ` stop-opacity="${opacity}"` : ''}/>`;
  const tile = `<linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1">${stop('0', paint.tileA)}${stop('1', paint.tileB)}</linearGradient>`;
  const sheen = `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${logo === 'linked' ? '.22' : '.08'}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const node = `<linearGradient id="${id}n" x1="0" y1="0" x2="1" y2="0">${stop('0', paint.nodeA)}${stop('1', paint.nodeB)}</linearGradient>`;
  const ground = `<path d="${TILE}" fill="url(#${id}t)"/><path d="${TILE}" fill="url(#${id}s)"/>`;
  const ring = '<circle cx="12" cy="16" r="5.4" fill="none" stroke="#fff" stroke-width="2.8"/>';
  if (logo === 'linked') {
    return `<defs>${tile}${sheen}</defs>${ground}${ring}<path d="M17.4 16h3.2" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><circle cx="23.6" cy="16" r="3.2" fill="#fff"/>`;
  }
  return `<defs>${tile}${sheen}${node}</defs>${ground}<path d="${TILE}" fill="none" stroke="#fff" stroke-opacity=".1"/>${ring}<path d="M17.4 16h3.2" stroke="#fff" stroke-width="2.8" stroke-linecap="round" opacity=".85"/><circle cx="23.6" cy="16" r="3.3" fill="url(#${id}n)"/>`;
}

const paintOf = (logo: LogoId, c: LogoColors): Paint => (logo === 'linked'
  ? { tileA: c.a, tileB: c.b, nodeA: c.nodeA, nodeB: c.nodeB }
  : { tileA: c.darkA, tileB: c.darkB, nodeA: c.nodeA, nodeB: c.nodeB });

/** The mark as a standalone SVG, for the browser tab icon. */
export function markSvg(logo: LogoId, colors: LogoColors): string {
  const body = parts(logo, 'm', paintOf(logo, colors), (name, value) => `${name}="${value}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;
}

/** The mark in the page, following the theme through its CSS variables (`--logo-*`). */
export function LogoMark({ logo, size = 28 }: { logo: LogoId; size?: number }) {
  const id = `logo${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const vars: Paint = logo === 'linked'
    ? { tileA: 'var(--logo-a)', tileB: 'var(--logo-b)', nodeA: 'var(--logo-node-a)', nodeB: 'var(--logo-node-b)' }
    : { tileA: 'var(--logo-dark-a)', tileB: 'var(--logo-dark-b)', nodeA: 'var(--logo-node-a)', nodeB: 'var(--logo-node-b)' };
  const body = parts(logo, id, vars, (name, value) => `style="${name}:${value}"`);
  return <svg className="logo-mark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: body }} />;
}
