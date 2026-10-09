import { useId } from 'react';

/**
 * The OKB mark. Every proposal of both series stays available (the person is
 * still choosing; docs/design/logos/ keeps the pages): the linked note `o—•` is
 * the default. Each can be drawn in gradient — the theme's tile with a light from
 * above — or flat. The colours are the theme's; light or dark does not change them.
 */
export const LOGOS = [
  'linked', 'linked-dark', 'branches',
  'constellation', 'diamond', 'ring',
  'prompt', 'typing', 'prompt-color',
  's1-graph', 's1-brackets', 's1-prompt', 's1-linked', 's1-cards',
] as const;
export type LogoId = typeof LOGOS[number];
export type LogoStyle = 'gradient' | 'flat';

/** Each theme's logo colours: the tile (a → b, or `flat`), the deep tile, the linked note, a soft tint. */
export type LogoColors = { readonly a: string; readonly b: string; readonly flat: string; readonly darkA: string; readonly darkB: string; readonly nodeA: string; readonly nodeB: string; readonly soft: string };
export const LOGO_COLORS: Readonly<Record<'atelier' | 'classique', LogoColors>> = {
  atelier: { a: '#9a8bff', b: '#4b3ad4', flat: '#5b4be0', darkA: '#2c2655', darkB: '#121119', nodeA: '#b9afff', nodeB: '#7c6cf6', soft: '#c9c1ff' },
  classique: { a: '#19c991', b: '#0b6f86', flat: '#0e9f6e', darkA: '#123a2e', darkB: '#0a0e13', nodeA: '#8af0c7', nodeB: '#14b886', soft: '#b4f5db' },
};

/** Second series: a soft rounded square, like an app icon. First series: a plain rounded square. */
const SQUIRCLE = 'M16 1C27.4 1 31 4.6 31 16S27.4 31 16 31 1 27.4 1 16 4.6 1 16 1Z';
const SQUARE = 'M9 1h14a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H9a8 8 0 0 1-8-8V9a8 8 0 0 1 8-8Z';
const W = '#fff';

type Paint = { tile: string; deep: string; node: string; soft: string; line: string; sheen: string; sheenDeep: string };

/** The drawing of each logo, on its tile (`tile` or `deep`), in the paint it is given. */
const DRAW: Readonly<Record<LogoId, (p: Paint) => string>> = {
  linked: (p) => `${ground(SQUIRCLE, p)}<circle cx="12" cy="16" r="5.4" fill="none" stroke="${W}" stroke-width="2.8"/><path d="M17.4 16h3.2" stroke="${W}" stroke-width="2.8" stroke-linecap="round"/><circle cx="23.6" cy="16" r="3.2" fill="${W}"/>`,
  'linked-dark': (p) => `${deep(SQUIRCLE, p)}<circle cx="12" cy="16" r="5.4" fill="none" stroke="${W}" stroke-width="2.8"/><path d="M17.4 16h3.2" stroke="${W}" stroke-width="2.8" stroke-linecap="round" opacity=".85"/><circle cx="23.6" cy="16" r="3.3" fill="${p.node}"/>`,
  branches: (p) => `${ground(SQUIRCLE, p)}<circle cx="11.6" cy="16" r="5.2" fill="none" stroke="${W}" stroke-width="2.7"/><path d="M16.3 13.8 21.4 10.6M16.3 18.2 21.4 21.4" stroke="${W}" stroke-width="2.3" stroke-linecap="round" opacity=".9"/><circle cx="23.8" cy="9.4" r="2.8" fill="${W}"/><circle cx="23.8" cy="22.6" r="2.8" fill="${p.soft}"/>`,
  constellation: (p) => `${ground(SQUIRCLE, p)}<g stroke="${W}" stroke-width="1.7" stroke-linecap="round" opacity=".62"><path d="M15.2 17.2 8.6 10"/><path d="M15.2 17.2 23 9.4"/><path d="M15.2 17.2 23.8 22"/><path d="M15.2 17.2 9.4 23.6"/><path d="M23 9.4 23.8 22"/></g><circle cx="8.6" cy="10" r="2.2" fill="${W}"/><circle cx="23" cy="9.4" r="2.7" fill="${W}"/><circle cx="23.8" cy="22" r="2" fill="${W}"/><circle cx="9.4" cy="23.6" r="2.4" fill="${W}"/><circle cx="15.2" cy="17.2" r="3.6" fill="${W}"/>`,
  diamond: (p) => `${ground(SQUIRCLE, p)}<path d="M16 7.6 24.4 16 16 24.4 7.6 16Z" fill="none" stroke="${W}" stroke-width="1.8" stroke-linejoin="round" opacity=".55"/><path d="M16 7.6V24.4M7.6 16h16.8" stroke="${W}" stroke-width="1.2" opacity=".28"/><circle cx="24.4" cy="16" r="2.3" fill="${W}"/><circle cx="16" cy="24.4" r="2.3" fill="${W}"/><circle cx="7.6" cy="16" r="2.3" fill="${W}"/><circle cx="16" cy="16" r="2" fill="${W}" opacity=".8"/><circle cx="16" cy="7.6" r="3.3" fill="${p.soft}" stroke="${W}" stroke-width="1.6"/>`,
  ring: (p) => `${ground(SQUIRCLE, p)}<circle cx="16" cy="16" r="8.4" fill="none" stroke="${W}" stroke-width="1.8" opacity=".5"/>${[0, 1, 2, 3, 4, 5].map((k) => {
    const a = ((-90 + k * 60) * Math.PI) / 180;
    const x = (16 + 8.4 * Math.cos(a)).toFixed(2);
    const y = (16 + 8.4 * Math.sin(a)).toFixed(2);
    return k === 1 ? `<circle cx="${x}" cy="${y}" r="3.1" fill="${p.soft}" stroke="${W}" stroke-width="1.5"/>` : `<circle cx="${x}" cy="${y}" r="2.15" fill="${W}"/>`;
  }).join('')}`,
  prompt: (p) => `${deep(SQUIRCLE, p)}<circle cx="13.1" cy="16.4" r="5.3" fill="none" stroke="${W}" stroke-width="2.9"/><rect x="20.2" y="20.3" width="6.4" height="3.1" rx="1.55" fill="${p.node}"/>`,
  typing: (p) => `${deep(SQUIRCLE, p)}<path d="M19.09 19.82A6.2 6.2 0 1 1 19.09 12.18" fill="none" stroke="${W}" stroke-width="2.9" stroke-linecap="round"/><rect x="20.6" y="9.4" width="3" height="13.2" rx="1.5" fill="${p.node}"/>`,
  'prompt-color': (p) => `${ground(SQUIRCLE, p)}<circle cx="13.1" cy="16.4" r="5.3" fill="none" stroke="${W}" stroke-width="2.9"/><rect x="20.2" y="20.3" width="6.4" height="3.1" rx="1.55" fill="${W}" opacity=".78"/>`,
  's1-graph': (p) => `${ground(SQUARE, p)}<path d="M16 7.5 24.5 16 16 24.5 7.5 16Z" fill="none" stroke="${W}" stroke-width="1.8" stroke-linejoin="round" opacity=".85"/><circle cx="16" cy="7.5" r="2.4" fill="${W}"/><circle cx="24.5" cy="16" r="2.4" fill="${W}"/><circle cx="16" cy="24.5" r="2.4" fill="${W}"/><circle cx="7.5" cy="16" r="2.4" fill="${W}"/><circle cx="16" cy="16" r="2.8" fill="${W}"/>`,
  's1-brackets': (p) => `${ground(SQUARE, p)}<path d="M12.5 8.5H9v15h3.5M19.5 8.5H23v15h-3.5" fill="none" stroke="${W}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="3.2" fill="${W}"/>`,
  's1-prompt': (p) => `${deep(SQUARE, p)}<circle cx="13" cy="15.5" r="5.2" fill="none" stroke="${W}" stroke-width="2.8"/><rect x="20" y="19.2" width="6" height="3" rx="1.2" fill="${p.node}"/>`,
  's1-linked': (p) => `${ground(SQUARE, p)}<circle cx="12.2" cy="16" r="5.8" fill="none" stroke="${W}" stroke-width="2.7"/><path d="M18 16h3.4" stroke="${W}" stroke-width="2.4" stroke-linecap="round"/><circle cx="24" cy="16" r="2.7" fill="${W}"/>`,
  's1-cards': (p) => `${ground(SQUARE, p)}<rect x="10.5" y="7" width="13" height="15" rx="2.2" fill="none" stroke="${W}" stroke-width="2" opacity=".75"/><rect x="7.5" y="10" width="13" height="15" rx="2.2" fill="${W}"/><path d="M10.5 15h7M10.5 18.5h7M10.5 22h4" stroke="${p.line}" stroke-width="1.6" stroke-linecap="round"/>`,
};

function ground(shape: string, p: Paint): string {
  return `<path d="${shape}" fill="${p.tile}"/>${p.sheen ? `<path d="${shape}" fill="${p.sheen}"/>` : ''}`;
}
function deep(shape: string, p: Paint): string {
  return `<path d="${shape}" fill="${p.deep}"/>${p.sheenDeep ? `<path d="${shape}" fill="${p.sheenDeep}"/>` : ''}<path d="${shape}" fill="none" stroke="${W}" stroke-opacity=".1"/>`;
}

/** The logo as a standalone SVG: the tab icon, and the marks in the page. `id` keeps gradients apart. */
export function markSvg(logo: LogoId, c: LogoColors, style: LogoStyle = 'gradient', id = 'm'): string {
  const flat = style === 'flat';
  const defs = flat ? '' : `<defs>`
    + `<linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient>`
    + `<linearGradient id="${id}d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.darkA}"/><stop offset="1" stop-color="${c.darkB}"/></linearGradient>`
    + `<linearGradient id="${id}n" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.nodeA}"/><stop offset="1" stop-color="${c.nodeB}"/></linearGradient>`
    + `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `</defs>`;
  const paint: Paint = flat
    ? { tile: c.flat, deep: c.darkB, node: c.nodeB, soft: c.soft, line: c.flat, sheen: '', sheenDeep: '' }
    : { tile: `url(#${id}t)`, deep: `url(#${id}d)`, node: `url(#${id}n)`, soft: c.soft, line: c.b, sheen: `url(#${id}s)`, sheenDeep: `url(#${id}e)` };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${defs}${DRAW[logo](paint)}</svg>`;
}

/** The logo in the page, in the colours of the theme. */
export function LogoMark({ logo, look, style = 'gradient', size = 28 }: { logo: LogoId; look: 'atelier' | 'classique'; style?: LogoStyle; size?: number }) {
  const id = `logo${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markSvg(logo, LOGO_COLORS[look], style, id) }} />;
}
