// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupTab } from '../../web-app/src/pages/Upkeep.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(status: Record<string, unknown>, drill: Record<string, unknown> = { ok: true, date: '2027-03-01', notes: 46, documents: 1, projects: 3, actions: 2, entries: 5, problems: [] }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    const body = u.startsWith('/api/backup/status') ? status : u.startsWith('/api/backup/drill') ? drill
      : u.startsWith('/api/storage') ? { findings: [], backups: status.last ? [{ date: (status.last as { date: string }).date, files: 52 }] : [] } : { items: [] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BackupTab /></QueryClientProvider>);
  return calls;
}

describe('the backups on the health page (F2.0-14)', () => {
  it('says where the backup stands and that a restore was never tried', async () => {
    mount({ state: 'ok', where: '/disque/sauvegardes', last: { date: '2027-03-01', at: '2027-03-01T09:00:00Z', files: 52 }, verifiedAt: null, drilledAt: null, drillOk: null });
    expect(await screen.findByText('app.backup.drillNever')).toBeTruthy();
    expect(screen.getByText('/disque/sauvegardes')).toBeTruthy();
  });

  it('tries a restore on demand and says what came back', async () => {
    const calls = mount({ state: 'ok', where: '/d', last: { date: '2027-03-01', at: '2027-03-01T09:00:00Z', files: 52 }, verifiedAt: null, drilledAt: null, drillOk: null });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'app.backup.drill' })); });
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/backup/drill'))).toBe(true));
    expect((await screen.findByRole('status')).textContent).toContain('backup.drilled');
  });

  it('a restore that failed is said as a problem, with what is wrong', async () => {
    mount({ state: 'ok', where: '/d', last: { date: '2027-03-01', at: '2027-03-01T09:00:00Z', files: 52 }, verifiedAt: null, drilledAt: '2027-03-01T10:00:00Z', drillOk: false },
      { ok: false, date: '2027-03-01', notes: 45, documents: 1, projects: 3, actions: 2, entries: 5, problems: ['kb/Accueil.md: changed since the snapshot'] });
    expect(await screen.findByText('app.backup.drillFailed')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'app.backup.drill' })); });
    expect((await screen.findByRole('alert')).textContent).toContain('kb/Accueil.md');
  });

  it('a late backup, or none, is a warning with the button to take one now', async () => {
    mount({ state: 'late', where: '/d', last: { date: '2027-02-20', at: '2027-02-20T09:00:00Z', files: 52 }, verifiedAt: null, drilledAt: null, drillOk: null });
    expect(await screen.findByText('app.backup.late')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'web.storage.backupNow' })).toBeTruthy();
  });
});
