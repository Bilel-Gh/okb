import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load.js';
import { loadBundleFor } from '../../src/kb/bundle.js';
import { proposeFiles } from '../../src/proposal/files.js';
import { saveProposal } from '../../src/proposal/store.js';
import { keepProposal } from '../../src/review/keep.js';
import { reviewOf, setReview } from '../../src/review/state.js';
import { writeSetting } from '../../src/settings/settings.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

const note = (title: string, body = 'Texte de la note.') => `---\ntype: Guide\ntitle: "${title}"\ndescription: Une note.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n---\n\n# ${title}\n\n${body}\n`;

describe('sorting what the agent filed (F2.0-55/56/57, D71)', () => {
  it('validates, removes and moves notes in the app, without a dialog, and shows the share', async () => {
    app = await openApp(browser); const { page, env } = app;
    await writeSetting(app.config.profile.id, 'changes.agentWrites', 'review-later', env);
    const config = (await loadConfig({ env, profileId: app.config.profile.id })).config;
    const p = proposeFiles(config, await loadBundleFor(config), new Map([['Cas/remises.md', note('Les remises disparaissent')], ['Cas/doublon.md', note('Un doublon')], ['Cas/deplacer.md', note('À déplacer')]]), 'agent');
    await saveProposal(config, p); await keepProposal(config, p.id, env);
    await page.goto(app.openUrl());
    await page.waitForFunction(() => sessionStorage.getItem('okb-presence'));
    await page.goto(`${app.url}/#/a-relire`);
    await page.locator('.rv-list').getByText('Les remises disparaissent').click();
    await page.getByRole('button', { name: 'Oui, je la garde' }).click();
    await expect.poll(() => reviewOf(config, 'Cas/remises.md')?.state).toBe('validated');
    await page.locator('.rv-list').getByText('Un doublon').click();
    await page.getByRole('button', { name: 'Non, la retirer' }).click();
    await page.locator('.rv-list').getByText('Un doublon').waitFor({ state: 'detached' });
    await page.locator('.rv-list').getByText('À déplacer').click();
    await page.getByRole('button', { name: 'Changer l’emplacement' }).click();
    await page.getByRole('option').first().click();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-review-light.png'), fullPage: true });
    await page.goto(`${app.url}/#/`);
    await page.locator('.hello-line').getByText(/mémoire validée à \d+ %/).waitFor();
    await page.locator('.statusbar').getByText(/\d+ % validées/).waitFor();
  }, 90_000);

  it('applies a change waiting on a validated note; « Oui à tout » then leaves « Tout est trié »', async () => {
    app = await openApp(browser); const { page, env } = app;
    await writeSetting(app.config.profile.id, 'changes.agentWrites', 'review-later', env);
    const config = (await loadConfig({ env, profileId: app.config.profile.id })).config;
    const first = proposeFiles(config, await loadBundleFor(config), new Map([['Cas/v.md', note('Validée', 'Version validée.')]]), 'agent');
    await saveProposal(config, first); await keepProposal(config, first.id, env);
    setReview(config, 'Cas/v.md', 'validated', config.profile.humanActor);
    const change = proposeFiles(config, await loadBundleFor(config), new Map([['Cas/v.md', note('Validée', 'Complétée par l’agent.')]]), 'agent');
    await saveProposal(config, change); await keepProposal(config, change.id, env);
    await page.goto(app.openUrl());
    await page.waitForFunction(() => sessionStorage.getItem('okb-presence'));
    await page.goto(`${app.url}/#/a-relire`);
    await page.getByRole('button', { name: /^Modifications/ }).click();
    await page.getByRole('button', { name: 'Oui, appliquer' }).click();
    await expect.poll(() => reviewOf(config, 'Cas/v.md')?.state).toBe('validated');
    await page.getByRole('button', { name: /^Tout/ }).click();
    await page.getByRole('button', { name: 'Oui à tout, sauf…' }).click();
    await page.getByRole('button', { name: 'Oui à tout', exact: true }).click();
    await page.getByText('Tout est trié').waitFor();
    await page.locator('.statusbar').getByText('100 % validées').waitFor();
    await page.evaluate(() => localStorage.setItem('okb-theme', 'dark')); await page.reload();
    await page.getByText('Tout est trié').waitFor();
    expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe('dark');
    await page.screenshot({ path: resolve(tmpdir(), 'okb-review-dark.png'), fullPage: true });
  }, 90_000);
});
