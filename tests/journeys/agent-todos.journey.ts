import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invoke } from '../../src/engine/registry.js';
import { addRepo } from '../../src/repo/registry.js';
import { startTicket } from '../../src/work/tickets.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

describe('the agent’s todos on a ticket (F2.4-21..23, D74)', () => {
  it('shows what the agent added and did, removes its todo with « Annuler », and the agent cannot bring it back', async () => {
    app = await openApp(browser); const { page, url, dir, config, env } = app;
    const path = resolve(dir, 'panier-web'); await mkdir(path, { recursive: true });
    await writeFile(resolve(path, 'README.md'), '# panier-web\n');
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: path });
    const { repo } = await addRepo({ path, kb: config.profile.id }, env);
    await startTicket(config, { repo, ref: 'DEMO-42', title: 'Le panier perd les remises' });
    const person = { config, env, actor: 'person' as const }; const agent = { config, env, actor: 'agent' as const };
    await invoke('actions.add', { text: 'Vérifier la page de confirmation', workRef: 'DEMO-42', importance: 'high', pinned: true }, person);
    const mine = await invoke('actions.add', { text: 'Ouvrir la PR', workRef: 'DEMO-42' }, person);
    await invoke('actions.update', { id: mine.id, importance: 'low' }, agent);
    await invoke('actions.add', { text: 'Ajouter un test pour le yen', workRef: 'DEMO-42', why: 'd’après les critères Jira' }, agent);

    await page.goto(`${url}/#/ticket/DEMO-42`);
    await page.getByText('ajoutée par l’agent · d’après les critères Jira').waitFor();
    await page.getByText('importance réglée par l’agent').waitFor();
    await page.getByRole('button', { name: 'Supprimer : Ajouter un test pour le yen' }).click();
    await page.getByText(/Todo retirée : « Ajouter un test pour le yen »/).waitFor();
    await page.getByText('Ajouter un test pour le yen', { exact: true }).waitFor({ state: 'detached' });
    await expect(invoke('actions.add', { text: 'ajouter un test pour le Yen', workRef: 'DEMO-42' }, agent)).rejects.toMatchObject({ code: 'E_CONFLICT' });
    await page.getByRole('button', { name: 'Annuler' }).click();
    await page.getByText('Ajouter un test pour le yen', { exact: true }).waitFor();
  }, 90_000);
});
