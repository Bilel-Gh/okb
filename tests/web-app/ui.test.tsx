// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeLine } from '../../web-app/src/ui/KnowledgeLine.js';
import { LineStrip } from '../../web-app/src/ui/LineStrip.js';

afterEach(cleanup);

const TIERS = { discovery: 'Découverte', usable: 'Utilisable', solid: 'Solide', expert: 'Expert', reference: 'Référence' };

describe('the line of a note', () => {
  it('draws one station per step, links the steps that have a page, and marks where you are', () => {
    render(<LineStrip color="#7c3aed" label="Où est cette note" stops={[{ title: 'Démo', href: '#/note/Accueil.md' }, { title: 'Produits' }, { title: 'Atlas', href: '#/note/Atlas.md' }, { title: 'Export CSV' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Où est cette note' });
    expect(nav.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Démo' }).getAttribute('href')).toBe('#/note/Accueil.md');
    expect(screen.queryByRole('link', { name: 'Produits' })).toBeNull();
    const here = nav.querySelector('[aria-current="location"]');
    expect(here?.textContent).toContain('Export CSV');
  });
});

describe('the knowledge line of a repository', () => {
  it('puts the marker at the level and lights the tiers passed', () => {
    const { container } = render(<KnowledgeLine percent={52} tier="solid" tiers={TIERS} color="#2563eb" label="atlas-api : 52 %, Solide" />);
    const meter = screen.getByRole('meter', { name: 'atlas-api : 52 %, Solide' });
    expect(meter.getAttribute('aria-valuenow')).toBe('52');
    expect((container.querySelector('.k-here') as HTMLElement).getAttribute('style')).toContain('* 0.52)');
    expect(container.querySelectorAll('.k-stop.passed')).toHaveLength(3);
    expect(container.querySelector('.k-labels .on')?.textContent).toBe('Solide');
  });

  it('stays within the line at 0 and 100', () => {
    const { container, rerender } = render(<KnowledgeLine percent={0} tier="discovery" tiers={TIERS} color="#2563eb" label="x" />);
    expect((container.querySelector('.k-here') as HTMLElement).getAttribute('style')).toContain('* 0)');
    rerender(<KnowledgeLine percent={140} tier="reference" tiers={TIERS} color="#2563eb" label="x" />);
    expect((container.querySelector('.k-here') as HTMLElement).getAttribute('style')).toContain('* 1)');
  });
});
