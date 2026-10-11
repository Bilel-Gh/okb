// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeepInBaggage } from '../../web-app/src/reader/Baggage.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const DRAFT = { title: 'Isoler chaque appel', description: '', type: 'method', text: '# Isoler chaque appel\n\nSur un produit, rejouer chaque appel seul.\n', removed: [{ line: 3, text: 'Atlas', kind: 'product' }, { line: 5, text: 'ABC-101', kind: 'ticket' }, { line: 5, text: 'Atlas', kind: 'product' }] };

function mount(answers: { draft?: () => Response; keep?: () => Response } = {}) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    if (u.startsWith('/api/baggage/draft')) return answers.draft?.() ?? json(DRAFT);
    if (u.startsWith('/api/baggage/keep')) return answers.keep?.() ?? json({ proposal: 'p-1', kb: 'bagage', target: 'Méthodes/Isoler chaque appel.md', title: 'Isoler chaque appel', removed: 2 });
    return json({ ok: true });
  }));
  const closed = vi.fn();
  render(<KeepInBaggage path="3 Boîte à outils/Méthodes/Isoler.md" open onOpenChange={closed} />);
  return { calls, closed, json };
}

describe('« Garder dans mon bagage » on a note (F2.0-12)', () => {
  it('shows the version without the workplace and what was taken out, each mention once', async () => {
    mount();
    const text = (await screen.findByLabelText('app.baggage.text')) as HTMLTextAreaElement;
    expect(text.value).toContain('Sur un produit, rejouer chaque appel seul.');
    expect((screen.getByLabelText('app.baggage.title') as HTMLInputElement).value).toBe('Isoler chaque appel');
    const removed = screen.getByRole('list', { name: 'app.baggage.removed' });
    expect([...removed.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Atlas', 'ABC-101']);
  });

  it('sends what the person reread, and says where it waits for their yes', async () => {
    const { calls, closed } = mount();
    const text = await screen.findByLabelText('app.baggage.text');
    fireEvent.change(text, { target: { value: '# Isoler chaque appel\n\nRejouer chaque appel seul.\n' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.baggage.keep' })); });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/baggage/keep')).toBe(true));
    expect(calls.find((c) => c.url === '/api/baggage/keep')!.body).toMatchObject({ path: '3 Boîte à outils/Méthodes/Isoler.md', title: 'Isoler chaque appel', text: '# Isoler chaque appel\n\nRejouer chaque appel seul.\n' });
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
  });

  it('keeps the window open and says what still names the workplace', async () => {
    const { closed } = mount({ keep: () => new Response(JSON.stringify({ error: 'x', key: 'baggageDetails', title: 'Il reste des détails du travail', message: 'Il reste : Atlas, ABC-101.', fix: 'Retire-les.' }), { status: 400, headers: { 'content-type': 'application/json' } }) });
    await screen.findByLabelText('app.baggage.text');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.baggage.keep' })); });
    expect((await screen.findByRole('alert')).textContent).toContain('Il reste : Atlas, ABC-101.');
    expect(closed).not.toHaveBeenCalled();
  });

  it('without a baggage, explains how to make one instead of an empty form', async () => {
    mount({ draft: () => new Response(JSON.stringify({ error: 'x', key: 'baggageNone', title: 'Pas encore de bagage', message: 'Tu n’as pas encore de bagage.', fix: 'Crée-le.' }), { status: 404, headers: { 'content-type': 'application/json' } }) });
    expect((await screen.findByRole('alert')).textContent).toContain('Tu n’as pas encore de bagage.');
    expect(screen.queryByLabelText('app.baggage.text')).toBeNull();
    expect(screen.getByRole('link', { name: 'app.baggage.make' }).getAttribute('href')).toBe('#/kbs');
  });
});
