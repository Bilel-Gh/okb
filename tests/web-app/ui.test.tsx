// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Breadcrumb } from '../../web-app/src/ui/Breadcrumb.js';
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
