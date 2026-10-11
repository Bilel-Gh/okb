// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../../web-app/src/app/api.js';
import { makeT } from '../../web-app/src/app/i18n.js';
import FirstRun from '../../web-app/src/pages/FirstRun.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setSession({ token: '', ui: 'fr', version: '3.0', active: null, outdated: false, kbs: [] }, null); });
function mount() {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url).split('?')[0]!;
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined });
    const result = u === '/api/onboarding' ? { ok: true, id: 'demo', root: '/fake/notes/demo', project: { id: 'P-1', title: 'Mon examen' }, steps: [] }
      : u === '/api/session' ? { token: 'test', ui: 'fr', version: '3.0', active: 'demo', outdated: false, kbs: [{ id: 'demo', name: 'Mes cours', root: '/fake/notes/demo', active: true, writingLanguage: 'fr', exists: true, kind: 'topic', brain: 'standard', space: 'work' }] }
      : u === '/api/assistant/status' ? { selected: 'claude-code', agents: [{ id: 'claude-code', installed: false, ready: false, version: null }], terms: [] } : {};
    return new Response(JSON.stringify(result));
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><FirstRun t={makeT({}, 'fr')} /></QueryClientProvider>);
  return calls;
}
describe('profile first launch without a terminal (F3.0)', () => {
  it('creates one named space and project only after submitting, then offers continuing without AI', async () => {
    const calls = mount();
    fireEvent.click(screen.getByLabelText('Étudiant'));
    fireEvent.change(screen.getByLabelText('Le nom de mon espace'), { target: { value: 'Mes cours' } });
    fireEvent.change(screen.getByLabelText('Mon premier projet'), { target: { value: 'Mon examen' } });
    expect(calls.some((x) => x.body)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon espace et mon projet' }));
    await screen.findByText('Votre premier projet est prêt.');
    expect(calls.find((x) => x.url === '/api/onboarding')?.body).toMatchObject({ profile: 'student', name: 'Mes cours', project: 'Mon examen', language: 'fr' });
    expect(screen.getByRole('button', { name: 'Continuer sans IA' })).toBeTruthy();
    expect(calls.some((x) => /assistant|wizard\/run/.test(x.url))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon agent' }));
    await screen.findByRole('link', { name: 'Installer ou connecter Claude Code' });
    expect(calls.some((x) => x.url === '/api/assistant/ask')).toBe(false);
  });
  it('uses the native picker only on a click and submits that explicit destination', async () => {
    const chooseFolder = vi.fn(async () => '/empty/chosen-space');
    vi.stubGlobal('okbDesktop', { platform: 'darwin', version: '1', chooseFolder });
    const calls = mount();
    fireEvent.change(screen.getByLabelText('Le nom de mon espace'), { target: { value: 'Demo' } });
    fireEvent.change(screen.getByLabelText('Mon premier projet'), { target: { value: 'Premiers pas' } });
    expect(chooseFolder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Choisir où garder mes notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un dossier' }));
    await waitFor(() => expect((screen.getByLabelText('Dossier de mes notes') as HTMLInputElement).value).toBe('/empty/chosen-space'));
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon espace et mon projet' }));
    await waitFor(() => expect(calls.find((x) => x.url === '/api/onboarding')?.body).toMatchObject({ folder: '/empty/chosen-space' }));
  });
});
