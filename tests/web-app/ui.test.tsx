// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Breadcrumb } from '../../web-app/src/ui/Breadcrumb.js';
import { CatMark } from '../../web-app/src/ui/CatMark.js';
import { LevelBar } from '../../web-app/src/ui/LevelBar.js';

afterEach(cleanup);

const TIERS = { discovery: 'Découverte', usable: 'Utilisable', solid: 'Solide', expert: 'Expert', reference: 'Référence' };

describe('where a note sits', () => {
  it('shows each step, links the steps that have a page, and marks the note itself', () => {
    render(<Breadcrumb label="Où est cette note" stops={[{ title: 'Démo', href: '#/note/Accueil.md' }, { title: 'Produits' }, { title: 'Atlas', href: '#/note/Atlas.md' }, { title: 'Export CSV' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Où est cette note' });
    expect(nav.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Démo' }).getAttribute('href')).toBe('#/note/Accueil.md');
    expect(screen.queryByRole('link', { name: 'Produits' })).toBeNull();
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toContain('Export CSV');
  });
});

describe('the knowledge level of a repository', () => {
  it('fills the bar to the level, marks the tiers passed and names the current one', () => {
    const { container } = render(<LevelBar percent={52} tier="solid" tiers={TIERS} color="#2563eb" label="atlas-api : 52 %, Solide" />);
    const meter = screen.getByRole('meter', { name: 'atlas-api : 52 %, Solide' });
    expect(meter.getAttribute('aria-valuenow')).toBe('52');
    expect((container.querySelector('.level-fill') as HTMLElement).style.width).toBe('52%');
    expect(container.querySelectorAll('.level-tick')).toHaveLength(4);
    expect(container.querySelectorAll('.level-tick.passed')).toHaveLength(2);
    expect(container.querySelector('.level-labels .on')?.textContent).toBe('Solide');
  });

  it('stays within the bar at 0 and 100', () => {
    const { container, rerender } = render(<LevelBar percent={-5} tier="discovery" tiers={TIERS} color="#2563eb" label="x" />);
    expect((container.querySelector('.level-fill') as HTMLElement).style.width).toBe('0%');
    rerender(<LevelBar percent={140} tier="reference" tiers={TIERS} color="#2563eb" label="x" />);
    expect((container.querySelector('.level-fill') as HTMLElement).style.width).toBe('100%');
  });
});

describe('a note type', () => {
  it('shows the icon of a built-in type in a square tinted with its colour', () => {
    const { container } = render(<CatMark id="concept" color="#7c3aed" emoji="💡" label="Concepts" />);
    const mark = container.querySelector('.cat') as HTMLElement;
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(mark.textContent).not.toContain('💡');
    expect(mark.style.getPropertyValue('--c')).toBe('#7c3aed');
    expect(mark.getAttribute('title')).toBe('Concepts');
  });

  it('draws every built-in type with its own icon', () => {
    const ids = ['concept', 'guide', 'howto', 'process', 'case', 'ticket', 'decision', 'source', 'path', 'other'];
    const drawn = ids.map((id) => render(<CatMark id={id} color="#000000" emoji="x" label={id} />).container.querySelector('svg')!.innerHTML);
    expect(new Set(drawn).size).toBe(ids.length);
  });

  it('keeps the emoji of a type the KB added itself', () => {
    const { container } = render(<CatMark id="recipe" color="#123456" emoji="🍰" label="Recettes" />);
    expect(container.querySelector('.cat svg')).toBeNull();
    expect(container.querySelector('.cat')?.textContent).toBe('🍰');
  });
});
