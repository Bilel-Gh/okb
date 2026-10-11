// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopUpdates, ExportSpace } from '../../web-app/src/ui/DesktopControls.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(node: React.ReactNode) { const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>); }
describe('desktop maintenance without a terminal (F3.0)', () => {
  it('checks, downloads and installs an update as distinct human gestures', async () => {
    const status = vi.fn(async () => ({ state: 'idle', channel: 'stable' }));
    const check = vi.fn(async () => ({ state: 'available', channel: 'stable', version: '3.0.1' }));
    const download = vi.fn(async () => ({ state: 'downloaded', channel: 'stable', version: '3.0.1' }));
    const install = vi.fn(async () => ({ state: 'downloaded', channel: 'stable', version: '3.0.1' }));
    vi.stubGlobal('okbDesktop', { platform: 'darwin', version: '1', updates: { status, check, download, install } });
    mount(<DesktopUpdates />);
    const button = await screen.findByRole('button', { name: 'Vérifier les mises à jour' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(check).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'Télécharger la mise à jour' }));
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Installer et redémarrer' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Installer et redémarrer')!);
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  });
  it('exports the complete space only after an explicit empty destination and click', async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { calls.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, to: '/export/empty', files: 12, verified: true })); }));
    mount(<ExportSpace />);
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Dossier vide de destination'), { target: { value: '/export/empty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter mon espace complet' }));
    await screen.findByText(/Export complet vérifié/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ folder: '/export/empty' });
  });
});
