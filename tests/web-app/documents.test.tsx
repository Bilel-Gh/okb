// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Documents from '../../web-app/src/pages/Documents.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const DOC = { id: 'D-abc123', path: '_Documents/2027/Devis.pdf', title: 'Devis transporteur', mime: 'application/pdf', size: 48_200, projectId: 'P-1a2b3c', notePath: null, secret: false, textRead: true, addedAt: '2027-05-02T09:00:00.000Z', snippet: 'Le car coûte 480 euros.' };
const PHOTO = { ...DOC, id: 'D-def456', title: 'photo du tableau', mime: 'image/png', projectId: null, textRead: false, snippet: '' };

function mount(docs = [DOC, PHOTO]) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    const body = u.startsWith('/api/projects') ? { projects: [{ id: 'P-1a2b3c', title: 'Sortie de juin' }] }
      : u.startsWith('/api/documents') && !init?.method ? { documents: u.includes('query=quokka') ? [] : docs }
      : u.startsWith('/api/document/open') ? { ok: false, file: '/somewhere/Devis.pdf' } : { ok: true };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Documents /></QueryClientProvider>);
  return calls;
}

describe('the Documents page (F2.0-10)', () => {
  it('lists the files with their project, their size and what the search read in them', async () => {
    mount();
    const title = await screen.findByRole('button', { name: 'Devis transporteur' });
    const row = title.closest('li')!;
    expect(row.textContent).toContain('Sortie de juin');
    expect(row.textContent).toContain('48 ko');
    expect(row.textContent).toContain('Le car coûte 480 euros.');
    // A photo has no text to read: the row says so instead of looking searchable.
    expect(screen.getByRole('button', { name: 'photo du tableau' }).closest('li')!.textContent).toContain('app.docs.noText');
  });

  it('searches as the person types, and says so when nothing matches', async () => {
    const calls = mount();
    await screen.findByRole('button', { name: 'Devis transporteur' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'quokka' } });
    await waitFor(() => expect(calls.some((c) => c.url.includes('query=quokka'))).toBe(true));
    expect(await screen.findByText('app.docs.noneFound')).toBeTruthy();
  });

  it('keeps the chosen file as it is: its name and its exact bytes', async () => {
    const calls = mount([]);
    await screen.findByText('app.docs.emptyTitle');
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['Décision : on garde PostgreSQL.'], 'compte rendu.txt', { type: 'text/plain' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/documents')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST' && c.url === '/api/documents')!.body!;
    expect(sent.name).toBe('compte rendu.txt');
    expect(Buffer.from(String(sent.data), 'base64').toString('utf8')).toBe('Décision : on garde PostgreSQL.');
  });

  it('hides a document from assistants in one click, and moves it to a project', async () => {
    const calls = mount();
    await screen.findByRole('button', { name: 'Devis transporteur' });
    fireEvent.click(screen.getAllByRole('button', { name: 'app.docs.lock' })[0]!);
    await waitFor(() => expect(calls.find((c) => c.url === '/api/document/update')?.body).toMatchObject({ id: 'D-abc123', secret: true }));
    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: 'P-1a2b3c' } });
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/document/update').at(-1)!.body).toMatchObject({ id: 'D-def456', project: 'P-1a2b3c' }));
  });

  it('opens the file itself, and says where it is when the computer could not open it', async () => {
    const calls = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Devis transporteur' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/document/open')?.body).toMatchObject({ id: 'D-abc123' }));
    expect((await screen.findByRole('status')).textContent).toBe('app.docs.openFailed /somewhere/Devis.pdf');
  });
});
