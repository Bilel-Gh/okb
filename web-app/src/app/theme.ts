import { LOGO_COLORS, LOGOS, markSvg, type LogoId, type LogoStyle } from '../ui/Logo';

/**
 * Two themes to choose from (identity 1.5): Atelier, a developer's tool, and
 * Classique, the interface of the first versions; each light, dark or as the
 * system says. Remembered on this browser; the light/dark key is the classic
 * pages' own, so both stay in step.
 */
export type Look = 'atelier' | 'classique';
export type Mode = 'auto' | 'light' | 'dark';
export type Rail = 'expanded' | 'collapsed';
export const LOOKS: readonly Look[] = ['atelier', 'classique'];

/** The logo shown until the person picks another (docs/design/logos/README.md). */
export const DEFAULT_LOGO: LogoId = 'linked';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

export function readLook(): Look {
  return read('okb-look') === 'classique' ? 'classique' : 'atelier';
}

/** Light unless the person chose dark or « as the system says ». */
export function readMode(): Mode {
  const v = read('okb-theme');
  return v === 'dark' || v === 'auto' ? v : 'light';
}

export function schemeOf(mode: Mode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function readLogo(): LogoId {
  const v = read('okb-logo');
  return (LOGOS as readonly string[]).includes(v ?? '') ? (v as LogoId) : DEFAULT_LOGO;
}

export function readLogoStyle(): LogoStyle {
  return read('okb-logo-style') === 'flat' ? 'flat' : 'gradient';
}

/** Put a theme on the page (`data-theme`, `data-mode`), remember it with the logo, and paint the tab icon to match. */
export function applyLook({ look, mode, logo = readLogo(), logoStyle = readLogoStyle() }: { look: Look; mode: Mode; logo?: LogoId; logoStyle?: LogoStyle }): 'light' | 'dark' {
  const scheme = schemeOf(mode);
  const root = document.documentElement;
  root.dataset.theme = look;
  root.dataset.mode = scheme;
  write('okb-look', look);
  write('okb-theme', mode);
  write('okb-logo', logo);
  write('okb-logo-style', logoStyle);
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(markSvg(logo, LOGO_COLORS[look], logoStyle))}`);
  return scheme;
}

/** Folded to its icons or unfolded to its words: the person's choice, else Atelier folded and Classique unfolded. */
export function readRail(look: Look): Rail {
  const v = read('okb-rail');
  return v === 'expanded' || v === 'collapsed' ? v : look === 'atelier' ? 'collapsed' : 'expanded';
}

export function saveRail(rail: Rail): void {
  write('okb-rail', rail);
}
