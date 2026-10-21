import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addAction } from '../../src/projects/actions.js';
import { addRepo } from '../../src/repo/registry.js';
import { setTicketState } from '../../src/work/ticket-state.js';
import { startTicket } from '../../src/work/tickets.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

async function tickets(n: number) {
  const { dir, config, env } = app!;
  const path = resolve(dir, 'panier-web'); await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'README.md'), '# panier-web\n');
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: path });
  const { repo } = await addRepo({ path, kb: config.profile.id }, env);
  for (let i = 1; i <= n; i++) await startTicket(config, { repo, ref: `DEMO-${i}`, title: `Ticket fictif numéro ${i}` });
  return config;
}

describe('Today picks up the work from the sheets (F2.4-13, D70)', () => {
  it('shows nothing to pick up, then one card', async () => {
    app = await openApp(browser); const { page, url } = app;
    await page.goto(`${url}/#/`); await page.getByText('Rien à reprendre').waitFor();
    await tickets(1); await page.reload();
    await page.locator('.tk-tcard').filter({ hasText: 'DEMO-1' }).waitFor();
    expect(await page.locator('.tk-resume .segmented').count()).toBe(0);
  }, 60_000);

  it('with 12 tickets: 3 cards, 5 lines, the way to the others, and the filters', async () => {
    app = await openApp(browser); const { page, url } = app;
    const config = await tickets(12);
    await setTicketState(config, 'DEMO-3', { dimension: 'waiting', status: 'blocked', detail: 'Accès refusé au bac à sable' }, 'person');
    await page.goto(`${url}/#/`); await page.reload();
    await page.locator('.tk-cards .tk-tcard').first().waitFor();
    expect(await page.locator('.tk-cards .tk-tcard').count()).toBe(3);
    expect(await page.locator('.tk-rlist li').count()).toBe(5);
    await page.getByRole('link', { name: /Voir les 4 autres dans Tickets suivis/ }).waitFor();
    await page.getByRole('button', { name: /Bloqués 1/ }).click();
    await page.locator('.tk-tcard').filter({ hasText: 'Accès refusé au bac à sable' }).waitFor();
    expect(await page.locator('.tk-cards .tk-tcard').count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-today-12-light.png'), fullPage: true });
  }, 90_000);

  it('ties a todo with #REF and !, edits and deletes it, and shows the same next step as the sheet', async () => {
    app = await openApp(browser); const { page, url } = app;
    const config = await tickets(1);
    addAction(config, { text: 'Préparer la démo du sprint' });
    await page.goto(`${url}/#/`); await page.reload();
    const add = page.getByLabel('Ajouter une chose à faire');
    await add.fill('!Vérifier la confirmation #demo-1'); await add.press('Enter');
    const row = page.locator('.tk-todos li').filter({ hasText: 'Vérifier la confirmation' });
    await row.getByRole('link', { name: 'DEMO-1' }).waitFor();
    expect(await row.getByRole('button', { name: /Importance : haute/ }).count()).toBe(1);
    await page.locator('.tk-tcard').filter({ hasText: 'DEMO-1' }).getByText('Vérifier la confirmation').waitFor();
    await row.getByRole('button', { name: /Modifier : / }).click();
    await page.getByLabel('Texte de la todo').fill('Vérifier la page de confirmation'); await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('.tk-todos li').filter({ hasText: 'Vérifier la page de confirmation' }).waitFor();
    await page.goto(`${url}/#/ticket/DEMO-1`); await page.locator('.tk-next').getByText('Vérifier la page de confirmation').waitFor();
    await page.goto(`${url}/#/`);
    await page.locator('.tk-todos li').filter({ hasText: 'Préparer la démo du sprint' }).getByRole('button', { name: /Supprimer : / }).click();
    await page.locator('.tk-todos li').filter({ hasText: 'Préparer la démo du sprint' }).waitFor({ state: 'detached' });
  }, 60_000);
});
