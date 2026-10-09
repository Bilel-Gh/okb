// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConceptBubbles } from '../../web-app/src/reader/Bubble.js';

const TERMS = [
  { term: 'SLA', path: 'c/SLA.md', aliases: [], oneLiner: 'Un contrat qui fixe le niveau de service promis.' },
  { term: 'Idempotence', path: 'c/Idem.md', aliases: [], oneLiner: 'Refaire la même action ne change rien de plus.' },
];

function Page() {
  const root = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={root}>
        <p>Le <a className="term" data-term="0" href="#/note/c%2FSLA.md">SLA</a> et l’<a className="term" data-term="1" href="#/note/c%2FIdem.md">idempotence</a>.</p>
      </div>
      <ConceptBubbles root={root} terms={TERMS} />
    </>
  );
}

const over = (el: Element) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
const out = (el: Element, to: Element | null = document.body) => el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: to }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

function setup() {
  const client = new QueryClient();
  client.setQueryData(['categories'], { categories: [] });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
  return { sla: screen.getByText('SLA'), idem: screen.getByText('idempotence') };
}

describe('the bubble of a concept', () => {
  it('opens after a short pause on the word, with the term, its sentence and the way to the card', () => {
    const { sla } = setup();
    act(() => { over(sla); });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    const bubble = screen.getByRole('dialog', { name: 'SLA' });
    expect(bubble.textContent).toContain('Un contrat qui fixe le niveau de service promis.');
    expect(bubble.querySelector('a')!.getAttribute('href')).toBe('#/note/c%2FSLA.md');
    expect(sla.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not open when the pointer only passes over the word', () => {
    const { sla } = setup();
    act(() => { over(sla); vi.advanceTimersByTime(50); out(sla); vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open while the pointer travels from the word into the bubble, and closes after leaving both', () => {
    const { sla } = setup();
    act(() => { over(sla); vi.advanceTimersByTime(200); });
    const bubble = screen.getByRole('dialog');
    act(() => { out(sla, bubble); bubble.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); vi.advanceTimersByTime(600); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => { bubble.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })); vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes straight to the next word when one is already open', () => {
    const { sla, idem } = setup();
    act(() => { over(sla); vi.advanceTimersByTime(200); out(sla, idem); over(idem); });
    expect(screen.getByRole('dialog', { name: 'Idempotence' })).toBeTruthy();
  });

  it('opens at once on keyboard focus and closes on Escape', () => {
    const { sla } = setup();
    act(() => { sla.focus(); });
    expect(screen.getByRole('dialog', { name: 'SLA' })).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on a touch screen, the first tap opens the bubble instead of leaving the note', () => {
    const { sla } = setup();
    let followed = true;
    act(() => {
      sla.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      sla.dispatchEvent(click);
      followed = !click.defaultPrevented;
    });
    expect(followed).toBe(false);
    expect(screen.getByRole('dialog', { name: 'SLA' })).toBeTruthy();
  });
});
