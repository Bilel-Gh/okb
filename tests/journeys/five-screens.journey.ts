import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invoke } from '../../src/engine/registry.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser;
let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => {
  const errors = app?.errors ?? [];
  await app?.close();
  app = null;
  expect(errors, 'the page logged an error').toEqual([]);
});

const screen = (name: RegExp) => app!.page.getByRole('navigation', { name: 'Écrans' }).getByRole('link', { name });

describe('the five screens, as a person uses them (F2.0-20)', () => {
  it('Aujourd’hui: a line kept with ⌘J becomes an action for its day, and ticking it writes the journal', async () => {
    app = await openApp(browser);
    const { page } = app;
    await expect.poll(() => page.title()).toContain('Aujourd');
    await page.keyboard.press('Meta+j');
    await page.getByPlaceholder('Une info, une idée, une chose à faire…').fill('réserver le car avant le 15 mai');
    await page.getByText('Créer aussi l’action').waitFor();
    await page.getByRole('button', { name: 'Garder', exact: true }).click();
    const todo = page.locator('#todo');
    await todo.getByText('Réserver le car').waitFor();
    await todo.getByRole('checkbox', { name: /Réserver le car/ }).click();
    await expect.poll(async () => ((await (await fetch(`${app!.url}/api/entries?limit=10`)).json()) as { entries: { kind: string; text: string }[] }).entries.some((e) => e.kind === 'done' && e.text.includes('Réserver le car'))).toBe(true);
  });

  it('« Ce que j’ai fait mardi »: a day typed in the search opens that day of the journal, in a few seconds', async () => {
    app = await openApp(browser);
    const { page, config, env } = app;
    await invoke('journal.add', { text: 'Devis du transporteur reçu' }, { config, env, actor: 'person' });
    const started = Date.now();
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder('Chercher une note, une page…').fill('aujourd’hui');
    await page.getByRole('option', { name: /Ce que j’ai fait/ }).click();
    await page.getByText('Devis du transporteur reçu').waitFor();
    // The gate of the 2.0 says ten seconds for a person; the machine's part must be a small share of it.
    expect(Date.now() - started).toBeLessThan(5000);
    await page.getByRole('link', { name: 'Jour précédent' }).click();
    await page.getByText('Rien de noté ce jour-là.').waitFor();
  });

  it('Projets: a project is created, says where it stands, gets an action, and is left with « Où j’en étais »', async () => {
    app = await openApp(browser);
    const { page } = app;
    await screen(/Projets/).click();
    await page.getByRole('button', { name: /Nouveau projet/ }).first().click();
    await page.getByPlaceholder('Un cours, une mission, la sortie de juin…').fill('Sortie de juin');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Sortie de juin' }).first().waitFor();
    await page.getByLabel('Où on en est').fill('Le devis du car est arrivé');
    await page.getByLabel('Où on en est').blur();
    await page.getByPlaceholder(/Une chose à faire/).first().fill('Envoyer le programme aux parents');
    await page.keyboard.press('Enter');
    await page.getByText('Envoyer le programme aux parents').waitFor();
    await page.getByRole('button', { name: 'Je quitte le projet' }).click();
    await page.getByText(/Où j’en étais/).first().waitFor();
    // Back on Today, the project is the one to pick up.
    await screen(/Aujourd/).click();
    await page.getByRole('link', { name: /Sortie de juin/ }).first().waitFor();
  });

  it('Mémoire: a note is found with ⌘K and says where it comes from; a file is kept and found by a word of its text', async () => {
    app = await openApp(browser);
    const { page, dir } = app;
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder('Chercher une note, une page…').fill('Enquêter sur une lenteur');
    await page.getByRole('option', { name: /Enquêter sur une lenteur/ }).first().click();
    await page.locator('article').getByRole('heading', { name: 'Enquêter sur une lenteur', level: 1 }).waitFor();
    await page.getByText('Sources et validité').waitFor();
    await page.getByRole('navigation', { name: 'Mémoire' }).getByRole('link', { name: 'Documents' }).click();
    const file = resolve(dir, 'Devis transporteur.txt');
    await writeFile(file, 'Le car de 55 places coûte 480 euros. Réservation trois semaines avant.');
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.getByRole('button', { name: 'Devis transporteur', exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Chercher dans les documents' }).fill('reservation');
    await page.getByText(/Réservation trois semaines avant/).waitFor();
    await page.getByRole('navigation', { name: 'Mémoire' }).getByRole('link', { name: 'Graphe' }).click();
    await page.locator('canvas, svg.graph, .graph-stage').first().waitFor();
  });

  it('Assistant: the conversation with the person’s agent, and one link away a question answered by the notes’ passages, without spending anything', async () => {
    app = await openApp(browser);
    const { page } = app;
    await screen(/Assistant/).click();
    // The screen is the conversation (2.3); nothing is sent by opening it.
    await page.getByRole('button', { name: /Envoyer à mon agent/ }).waitFor();
    await page.getByRole('link', { name: /Chercher dans mes notes sans IA/ }).first().click();
    await page.getByRole('searchbox').first().fill('Comment enquêter sur une lenteur ?');
    await page.keyboard.press('Enter');
    await page.getByText(/Enquêter sur une lenteur/).first().waitFor();
  });

  it('Progresser: a card is revealed, graded, and the day’s count moves', async () => {
    app = await openApp(browser);
    const { page } = app;
    await screen(/Progresser/).click();
    await page.getByRole('button', { name: /Révéler/ }).click();
    await page.getByRole('button', { name: /Bien/ }).click();
    await expect.poll(async () => ((await (await fetch(`${app!.url}/api/learn`)).json()) as { counts: { reviewedToday: number } }).counts.reviewedToday).toBe(1);
  });

  it('À valider: everything that waits is ticked; one thing is left out, the rest gets a yes', async () => {
    app = await openApp(browser);
    const { page, config, env } = app;
    // An assistant proposed two notes during the day.
    for (const title of ['Idempotence', 'Percentile']) await invoke('suggestions.add', { type: 'concept', title, why: 'tu as demandé ce que c’est', signal: 'asked' }, { config, env, actor: 'agent' });
    await page.reload();
    await page.getByRole('link', { name: /À valider/ }).first().click();
    await page.getByRole('checkbox', { name: 'Percentile' }).uncheck();
    await page.getByRole('button', { name: 'Oui à 1 chose' }).click();
    await page.getByText(/1 note acceptée/).waitFor();
    await page.getByRole('checkbox', { name: 'Percentile' }).waitFor();
    // The list is read again after the yes: what was accepted leaves it, a moment later.
    await expect.poll(() => page.getByRole('checkbox', { name: 'Idempotence' }).count()).toBe(0);
  });

  it('Les espaces: the person sees their two spaces, and a work note goes to their baggage without the workplace', async () => {
    app = await openApp(browser, { baggage: true });
    const { page, url } = app;
    await page.getByRole('button', { name: /Changer de cerveau/ }).click();
    await page.getByText('Mon bagage', { exact: true }).waitFor();
    await page.getByRole('menuitemradio', { name: 'Mes acquis' }).waitFor();
    await page.keyboard.press('Escape');
    await page.goto(`${url}/#/note/${encodeURIComponent('3 Boîte à outils/Méthodes/Enquêter sur une lenteur.md')}`);
    await page.getByRole('button', { name: 'Plus d’actions' }).click();
    await page.getByRole('button', { name: 'Garder dans mon bagage' }).click();
    await page.getByLabel('Texte').waitFor();
    await page.getByRole('button', { name: 'Proposer à mon bagage' }).click();
    await page.getByText(/La note attend ton oui dans Mon bagage/).first().waitFor();
    await expect.poll(async () => ((await (await fetch(`${url}/api/evening?kb=bagage`)).json()) as { changes: { title: string }[] }).changes.some((c) => c.title.startsWith('Enquêter sur une lenteur'))).toBe(true);
  });

  it('On a phone: the five screens are at the bottom, and « Garde ça » still keeps a line', async () => {
    app = await openApp(browser, { width: 390, height: 780 });
    const { page } = app;
    const tabs = page.locator('.tabbar');
    await tabs.getByRole('link', { name: /Projets/ }).click();
    await expect.poll(() => page.title()).toContain('Projets');
    await page.getByRole('button', { name: 'Garde ça' }).click();
    await page.getByPlaceholder('Une info, une idée, une chose à faire…').fill('Le quota passe à 500 lundi');
    await page.getByRole('button', { name: 'Garder', exact: true }).click();
    await expect.poll(async () => ((await (await fetch(`${app!.url}/api/inbox`)).json()) as { items: { text: string }[] }).items.some((i) => i.text.includes('quota'))).toBe(true);
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
