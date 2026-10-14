// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Assistant from '../../web-app/src/pages/Assistant.js';
import { AssistantPanel } from '../../web-app/src/ui/AssistantPanel.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const empty = { id: 'conversation-1', title: 'Reprise', messages: [], usage: { input: null, output: null } };
const reply = { ...empty, messages: [{ id: 'user-1', role: 'user', text: 'Comment reprendre ?' }, { id: 'reply-1', role: 'assistant', text: 'Reprise', answer: { provider: 'fake', usage: { input: null, output: null }, statements: [{ text: 'La note indique de garder le même identifiant.', kind: 'notes', evidence: [{ source: 'S1', quote: 'La demande garde son identifiant.' }] }, { text: 'Une explication générale.', kind: 'general', evidence: [] }, { text: 'Je ne connais pas le délai.', kind: 'unknown', evidence: [] }], sources: [{ id: 'S1', path: 'Retry.md', title: 'Retry de Sam', kind: 'shared', author: 'Sam', drawer: 'sam', quote: 'La demande garde son identifiant.', hash: 'source-1' }], actions: [{ kind: 'action', text: 'Vérifier le délai de conservation.' }, { kind: 'note', text: 'Garder la décision sur le délai.', title: 'Délai' }, { kind: 'explain', text: 'Explique les doubles effets avec un exemple.' }] } }] };
function mount(options: { missing?: boolean; fail?: boolean; slow?: boolean; panel?: boolean; contextual?: boolean } = {}) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let finish: ((v: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url).split('?')[0]!;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url: u, body });
    if (u === '/api/assistant/ask' && options.fail) return new Response(JSON.stringify({ message: 'Agent indisponible', title: 'Hors ligne' }), { status: 503 });
    if (u === '/api/assistant/ask' && options.slow) return new Promise<Response>((r) => { finish = r; });
    const data = u === '/api/assistant/status' ? { agents: [{ id: 'claude-code', installed: !options.missing, version: options.missing ? null : '2.0', ready: !options.missing }, { id: 'codex', installed: true, version: '1.0', ready: false, reason: 'experimental' }], selected: 'claude-code', privacy: 'local-agent', terms: [] }
      : u === '/api/assistant/conversations' ? { conversations: [] }
      : u === '/api/assistant/start' ? { conversation: empty, busy: false }
      : u === '/api/assistant/ask' ? { conversation: reply, busy: false }
      : u === '/api/assistant/conversation' ? { conversation: options.fail ? { ...empty, usageSummary: { calls: 1, failed: 1, total: null, knownTotal: 40 } } : empty, busy: !!options.slow }
      : u === '/api/assistant/action' ? body?.index === 0 ? { action: { id: 'todo-1', text: 'Vérifier le délai' } } : { id: 'suggestion-1', status: 'pending' }
      : { cancelled: true };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{options.panel ? <AssistantPanel context="Retry" /> : <Assistant route={options.contextual ? { name: 'assistant', workKind: 'ticket', workRef: 'ABC-42', prompt: 'Où j’en étais sur ABC-42 ?', mode: 'resume' } : { name: 'assistant' }} />}</QueryClientProvider>);
  return { calls, finish: () => finish?.(new Response(JSON.stringify({ conversation: reply, busy: false }))) };
}
async function ask() { fireEvent.change(await screen.findByLabelText('Mon message à l’assistant'), { target: { value: 'Comment reprendre ?' } }); fireEvent.click(screen.getByRole('button', { name: 'Envoyer à mon agent' })); }
describe('assistant on the person’s local agent (F2.3)', () => {
  it('offers notes without AI when no supported agent is installed, and never starts a model itself', async () => {
    const { calls } = mount({ missing: true });
    await screen.findByText('Claude Code est absent de cette machine.');
    expect(screen.getByRole('link', { name: 'Chercher dans mes notes sans IA' }).getAttribute('href')).toBe('#/ask');
    expect(screen.getByRole('button', { name: 'Envoyer à mon agent' }).hasAttribute('disabled')).toBe(true);
    expect(calls.some((x) => x.body)).toBe(false);
    expect(screen.getByRole('option', { name: /Codex.*expérimental/ }).hasAttribute('disabled')).toBe(true);
  });
  it('shows statement evidence, colleague attribution, general knowledge and unknown usage separately', async () => {
    const { calls } = mount(); await ask();
    await screen.findByText('La note indique de garder le même identifiant.');
    expect(screen.getByText('Ceci ne vient pas de vos notes')).toBeTruthy();
    expect(screen.getByText('Je ne sais pas')).toBeTruthy();
    expect(screen.getByText('La demande garde son identifiant.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retry de Sam · Partagée par Sam' }).getAttribute('href')).toBe('#/shared/sam/Retry.md');
    expect(screen.getAllByText('Tokens non communiqués').length).toBeGreaterThan(0);
    expect(calls.find((x) => x.url.endsWith('/ask'))?.body).toMatchObject({ question: 'Comment reprendre ?', conversation: 'conversation-1', mode: 'ask' });
    expect(calls.some((x) => x.url.endsWith('/action'))).toBe(false);
  });
  it('only creates an action or capture card after the person’s button, and prefills other actions without sending', async () => {
    const { calls } = mount(); await ask();
    await screen.findByText('La note indique de garder le même identifiant.');
    fireEvent.click(screen.getByRole('button', { name: 'Créer cette action' }));
    await screen.findByText('Action créée.');
    expect(calls.find((x) => x.url.endsWith('/action'))?.body).toMatchObject({ conversation: 'conversation-1', message: 'reply-1', index: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Garder cette information' }));
    await screen.findByRole('link', { name: 'Voir la carte à valider' });
    fireEvent.click(screen.getByRole('button', { name: 'Explique autrement' }));
    expect((screen.getByLabelText('Mon message à l’assistant') as HTMLTextAreaElement).value).toBe('Explique les doubles effets avec un exemple.');
    expect(calls.filter((x) => x.url.endsWith('/ask'))).toHaveLength(1);
    expect(calls.some((x) => /approve|apply/.test(x.url))).toBe(false);
  });
  it('preserves a failed prompt and can stop even the first reply using its allocated conversation', async () => {
    const { calls, finish } = mount({ slow: true }); await ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Arrêter la réponse' }));
    await waitFor(() => expect(calls.find((x) => x.url.endsWith('/cancel'))?.body).toMatchObject({ conversation: 'conversation-1' }));
    finish();
  });
  it('keeps the person’s text when the local agent fails', async () => {
    mount({ fail: true }); await ask();
    await screen.findByText('Agent indisponible');
    expect((screen.getByLabelText('Mon message à l’assistant') as HTMLTextAreaElement).value).toBe('Comment reprendre ?');
    await screen.findByText('Tokens non communiqués · 1 appels · 1 échoués ou arrêtés · part mesurée : 40');
    expect(screen.queryByText('0 tokens')).toBeNull();
    expect(screen.getByRole('link', { name: 'Continuer sans IA' }).getAttribute('href')).toBe('#/ask?q=Comment+reprendre+%3F');
  });
  it('starts a contextual question only after its submit and carries the selected work in the request', async () => {
    const { calls } = mount({ contextual: true });
    await screen.findByRole('link', { name: 'ABC-42' });
    expect((screen.getByLabelText('Mon message à l’assistant') as HTMLTextAreaElement).value).toContain('ABC-42');
    expect(screen.queryByText('Parlez à votre cerveau')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Mon message à l’assistant'));
    expect(calls.some((c) => c.body)).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer à mon agent' }));
    await screen.findByText('La note indique de garder le même identifiant.');
    expect(calls.find((c) => c.url.endsWith('/ask'))?.body).toMatchObject({ question: 'Où j’en étais sur ABC-42 ?', work: { kind: 'ticket', ref: 'ABC-42' }, mode: 'resume' });
  });
  it('keeps the panel’s conversation when opening its full screen', async () => {
    mount({ panel: true });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le panneau Assistant' }));
    await ask(); await screen.findByText('La note indique de garder le même identifiant.');
    expect(screen.getByRole('link', { name: 'Ouvrir l’écran' }).getAttribute('href')).toBe('#/assistant?id=conversation-1');
  });
});
