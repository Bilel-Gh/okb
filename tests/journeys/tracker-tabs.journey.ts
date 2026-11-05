import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addRepo } from '../../src/repo/registry.js';
import { setField } from '../../src/work/ticket-fields.js';
import { addAttempt, setTicketState } from '../../src/work/ticket-state.js';
import { addJournal, startTicket } from '../../src/work/tickets.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

/** Fictitious tickets: Jira for the team's work, ServiceNow for what customers raise. */
async function tickets(jira: number, snow: number) {
  const { dir, config, env } = app!;
  const path = resolve(dir, 'panier-web'); await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'README.md'), '# panier-web\n');
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: path });
  const { repo } = await addRepo({ path, kb: config.profile.id }, env);
  for (let i = 1; i <= jira; i++) await startTicket(config, { repo, ref: `DEMO-${i}`, title: `Ticket fictif ${i}` });
  for (let i = 1; i <= snow; i++) await startTicket(config, { repo, ref: `INC00${10000 + i}`, title: `Incident client ${i}` });
  return config;
}

describe('the return screen sorts the tickets by source (chantier 4)', () => {
  it('home shows the five latest per tab, the Tickets page pages them', async () => {
    app = await openApp(browser); const { page, url } = app;
    await tickets(23, 3);
    await page.goto(`${url}/#/`); await page.reload();
    const home = page.locator('section[aria-labelledby="home-tickets-h"]');
    await home.locator('.tt-row').first().waitFor();
    expect(await home.locator('.tt-row').count()).toBe(5);
    await home.getByRole('tab', { name: /ServiceNow 3/ }).click();
    expect(await home.locator('.tt-row').count()).toBe(3);
    expect(await home.locator('.tt-src').first().textContent()).toBe('ServiceNow');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-home-tickets.png'), fullPage: true });
    await page.goto(`${url}/#/tickets`);
    await page.locator('.tt-row').first().waitFor();
    expect(await page.locator('.tt-row').count()).toBe(20);
    await page.getByText('1 / 2').waitFor();
    await page.getByRole('button', { name: 'Page suivante' }).click();
    expect(await page.locator('.tt-row').count()).toBe(6);
    await page.getByRole('tab', { name: /Jira 23/ }).click();
    expect(await page.locator('.tt-row').count()).toBe(20);
  }, 90_000);

  it('tells how a bumpy ticket was solved, as a timeline', async () => {
    app = await openApp(browser); const { page, url } = app;
    const config = await tickets(1, 0);
    await setField(config, 'DEMO-1', { field: 'done', value: 'La conversion passe avant la remise, test ajouté.', origin: 'agent' });
    await addJournal(config, 'DEMO-1', { kind: 'note', text: 'La remise est calculée avant la conversion.' });
    await addAttempt(config, 'DEMO-1', { approach: 'Arrondir à la fin', conditions: 'USD', result: 'faux de 1 centime', next: 'Convertir avant la remise' });
    await setTicketState(config, 'DEMO-1', { dimension: 'pr', status: 'changes-requested', detail: 'Mauvais composant de bouton' }, 'person');
    await page.goto(`${url}/#/ticket/DEMO-1`);
    await page.getByRole('tab', { name: 'Comment je l’ai résolu' }).click();
    await page.locator('.story li').first().waitFor();
    for (const text of ['La remise est calculée avant la conversion.', 'Arrondir à la fin : faux de 1 centime', 'Convertir avant la remise', 'Mauvais composant de bouton']) await page.locator('.story').getByText(text).waitFor();
    await page.getByText('La conversion passe avant la remise, test ajouté.').waitFor();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-ticket-story.png'), fullPage: true });
  }, 60_000);
});
