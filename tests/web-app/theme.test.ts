// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLook, readLogo, readLook, readMode, readRail, saveRail } from '../../web-app/src/app/theme.js';
import { LOGO_COLORS, markSvg } from '../../web-app/src/ui/Logo.js';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
  document.head.innerHTML = '<link rel="icon" href="/favicon.svg">';
});

describe('two themes to choose from, each light or dark', () => {
  it('starts on Atelier following the system, and remembers a choice', () => {
    expect(readLook()).toBe('atelier');
    expect(readMode()).toBe('auto');
    applyLook({ look: 'classique', mode: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('classique');
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(readLook()).toBe('classique');
    expect(readMode()).toBe('dark');
  });

  it('ignores a value it does not know', () => {
    localStorage.setItem('okb-look', 'metro');
    localStorage.setItem('okb-theme', 'sepia');
    expect(readLook()).toBe('atelier');
    expect(readMode()).toBe('auto');
  });

  it('shares the light or dark choice with the classic pages', () => {
    applyLook({ look: 'atelier', mode: 'light' });
    expect(localStorage.getItem('okb-theme')).toBe('light');
  });

  it('paints the browser tab icon with the logo, in the gradient of the theme', () => {
    applyLook({ look: 'classique', mode: 'light' });
    const classique = decodeURIComponent(document.querySelector('link[rel="icon"]')!.getAttribute('href')!);
    applyLook({ look: 'atelier', mode: 'light' });
    const atelier = decodeURIComponent(document.querySelector('link[rel="icon"]')!.getAttribute('href')!);
    expect(classique).toContain('linearGradient');
    expect(classique).toContain(LOGO_COLORS.classique.b);
    expect(atelier).toContain(LOGO_COLORS.atelier.b);
  });
});

describe('the side bar folds to its icons and unfolds to its words', () => {
  it('is folded in Atelier and unfolded in Classique until the person chooses, then keeps the choice', () => {
    expect(readRail('atelier')).toBe('collapsed');
    expect(readRail('classique')).toBe('expanded');
    saveRail('expanded');
    expect(readRail('atelier')).toBe('expanded');
    saveRail('collapsed');
    expect(readRail('classique')).toBe('collapsed');
  });
});

describe('the logo: the linked note, on the theme\'s gradient or on a deep ground', () => {
  it('is the linked note on the gradient until the person picks the deep one, then keeps it', () => {
    expect(readLogo()).toBe('linked');
    applyLook({ look: 'atelier', mode: 'dark', logo: 'linked-dark' });
    expect(readLogo()).toBe('linked-dark');
    const icon = decodeURIComponent(document.querySelector('link[rel="icon"]')!.getAttribute('href')!);
    expect(icon).toContain(LOGO_COLORS.atelier.darkA);
    localStorage.setItem('okb-logo', 'metro');
    expect(readLogo()).toBe('linked');
  });

  it('draws each form in the colours it is given', () => {
    const linked = markSvg('linked', LOGO_COLORS.classique);
    const deep = markSvg('linked-dark', LOGO_COLORS.classique);
    expect(linked.startsWith('<svg')).toBe(true);
    expect(linked).toContain(LOGO_COLORS.classique.a);
    expect(deep).toContain(LOGO_COLORS.classique.nodeB);
    expect(deep).not.toBe(linked);
  });
});
