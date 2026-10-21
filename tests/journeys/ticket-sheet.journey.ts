import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addRepo } from '../../src/repo/registry.js';
import { setField } from '../../src/work/ticket-fields.js';
import { startTicket } from '../../src/work/tickets.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

async function seed() {
  const { dir, config, env, kb } = app!;
  const path = resolve(dir, 'panier-web'); await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'README.md'), '# panier-web\nA fictitious repository.\n');
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: path });
  const { repo } = await addRepo({ path, kb: config.profile.id }, env);
  await startTicket(config, { repo, ref: 'DEMO-42', title: 'Le panier perd les remises' });
  await setField(config, 'DEMO-42', { field: 'sourceStatus', value: 'In review', origin: 'person' });
  await setField(config, 'DEMO-42', { field: 'sourceStatus', value: 'In progress', origin: 'jira', url: 'https://jira.example.com/browse/DEMO-42' });
  await mkdir(resolve(kb, 'methodo'), { recursive: true });
  await writeFile(resolve(kb, 'methodo/arrondis.md'), '---\ntitle: Arrondis vus sur DEMO-42\ntype: note\ndescription: Un cas résolu.\n---\n\nTexte.\n');
}

describe('the ticket sheet (F2.4-08..14, D70)', () => {
  it('edits on the spot, settles a conflict, asks the agent, links a note, moves the next step and stops following', async () => {
    app = await openApp(browser); const { page, url } = app; await seed();
    await page.goto(`${url}/#/ticket/DEMO-42`);
    await page.getByRole('heading', { name: 'En 30 secondes' }).waitFor();
    expect(await page.locator('.tk-title').textContent()).toContain('Le panier perd les remises');

    // Edit the problem where it is read: it becomes the person's value.
    await page.locator('.tk-q').filter({ hasText: 'Le problème' }).getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByLabel('Le problème', { exact: true }).fill('Les remises disparaissent après conversion. Objectif : les garder.');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('.tk-q').filter({ hasText: 'Les remises disparaissent' }).getByText('toi').waitFor();

    // A source said otherwise: the person takes Jira's value.
    await page.getByRole('group', { name: 'Écart à arbitrer' }).getByRole('button', { name: /In progress/ }).click();
    await page.getByRole('group', { name: 'Écart à arbitrer' }).waitFor({ state: 'detached' });
    await page.locator('.tk-prop').filter({ hasText: 'Statut source' }).getByText('In progress').waitFor();

    // Ask the agent for the team: one pending request is shown.
    await page.locator('.tk-prop').filter({ hasText: 'Équipe' }).getByRole('button', { name: /Demander à l’agent/ }).click();
    await page.getByText('Demande à l’agent en attente').waitFor();

    // A mention is only a suggestion until the person links it.
    await page.locator('.tk-tray').filter({ hasText: 'Arrondis vus sur DEMO-42' }).getByRole('button', { name: 'Lier' }).click();
    await page.locator('.tk-notes').getByRole('link', { name: 'Arrondis vus sur DEMO-42' }).waitFor();

    // The next step is the first todo; finishing it lets the next one rise.
    const add = page.getByLabel('Ajouter une todo à ce ticket');
    await add.fill('Ouvrir la PR'); await add.press('Enter');
    await page.locator('.tk-next').getByText('Ouvrir la PR').waitFor();
    await add.fill('!Vérifier la page de confirmation'); await add.press('Enter');
    await page.locator('.tk-next').getByText('Vérifier la page de confirmation').waitFor();
    // The tools of a todo appear on keyboard focus too.
    const edit = page.locator('.tk-todos').getByRole('button', { name: 'Modifier : Ouvrir la PR' });
    await edit.focus(); await expect.poll(() => edit.evaluate((e) => getComputedStyle(e.parentElement!).opacity)).toBe('1');
    await page.getByRole('button', { name: /Terminer la prochaine étape/ }).click();
    await page.locator('.tk-next').getByText('Ouvrir la PR').waitFor();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-ticket-sheet-light.png'), fullPage: true });

    // Stop following: confirmed, the notes stay.
    await page.getByRole('button', { name: 'Plus d’actions' }).click();
    await page.getByRole('menuitem', { name: /Arrêter de suivre/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Arrêter de suivre' }).click();
    await page.waitForURL(/#\/tickets$/);
  }, 60_000);
});
