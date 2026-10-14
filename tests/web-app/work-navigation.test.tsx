// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Projects from '../../web-app/src/pages/Projects.js';
import { I18n, makeT } from '../../web-app/src/app/i18n.js';
import { TicketPreview } from '../../web-app/src/ui/WorkPreview.js';
import { WorkAssistant } from '../../web-app/src/ui/WorkAssistant.js';
import { parseRoute } from '../../web-app/src/app/router.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('work separate from technical context', () => {
  it('excludes repositories from ordinary project counts and opens tickets in their specialized page', async () => {
    const base = { module: 'dev', status: 'active', where: 'Un long résumé '.repeat(100), next: 'Vérifier la recette', folder: null, leftOff: null, updatedAt: '2026-10-13T10:00:00Z', createdAt: '2026-10-13T10:00:00Z' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ projects: [{ ...base, id: 'repo-project', kind: 'repo', title: 'Repo technique', ref: 'api' }, { ...base, id: 'ticket-project', kind: 'ticket', title: 'Corriger le retry', ref: 'ABC-42' }] }))));
    render(<I18n.Provider value={makeT({ 'app.projects.filter.open': 'En cours' }, 'fr')}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Projects route={{ name: 'projects' }} /></QueryClientProvider></I18n.Provider>);
    const ticket = await screen.findByRole('link', { name: /ABC-42.*Corriger le retry/ });
    expect(ticket.getAttribute('href')).toBe('#/ticket/ABC-42');
    expect(screen.queryByText('Repo technique')).toBeNull();
    expect(screen.getByRole('button', { name: /En cours/ }).textContent).toContain('1');
    expect(screen.queryByText(base.where)).toBeNull();
  });
  it('keeps the blocker distinct from the next action and makes a long preview point to its complete ticket', () => {
    const blocker = 'Attendre la recette à deux instances avec le même identifiant. '.repeat(40);
    render(<ul><TicketPreview ticket={{ ref: 'ABC-42', title: 'Retry', status: 'active', next: 'Une autre action', waiting: { status: 'blocked', detail: blocker } }} /></ul>);
    const link = screen.getByRole('link', { name: /ABC-42.*Retry/ });
    expect(link.textContent).toContain('Bloqué'); expect(link.textContent).toContain('Blocage / attente');
    expect(link.textContent).toContain('…'); expect(link.textContent).not.toContain('Une autre action'); expect(link.textContent!.length).toBeLessThan(250);
    expect(link.getAttribute('href')).toBe('#/ticket/ABC-42');
  });
  it('prepares contextual questions without starting an agent and preserves the old local-search address', () => {
    render(<WorkAssistant kind="ticket" refId="ABC-42" title="Corriger le retry" />);
    const route = parseRoute(screen.getByRole('link', { name: 'Où j’en étais' }).getAttribute('href')!);
    expect(route).toMatchObject({ name: 'assistant', workKind: 'ticket', workRef: 'ABC-42', mode: 'resume' });
    expect(route.name === 'assistant' && route.prompt).toContain('Corriger le retry');
    expect(parseRoute('#/assistant?q=retry')).toEqual({ name: 'ask', q: 'retry' });
  });
});
