import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { loadConfig } from '../../src/config/load.js';
import type { OkbConfig } from '../../src/config/schema.js';
import { runSetup } from '../../src/setup/setup.js';
import { closeDbs } from '../../src/state/db.js';
import { serve } from '../../src/web/server.js';
import { demoBrain } from '../helpers/brain.js';

/**
 * A Chromium to drive: Playwright's own when it is installed, else the Chrome
 * or the Edge of the machine. `OKB_JOURNEY_BROWSER` picks one (`chrome`,
 * `msedge`, or the path of a browser).
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const wanted = process.env.OKB_JOURNEY_BROWSER;
  const tries = wanted ? [wanted.includes('/') ? { executablePath: wanted } : { channel: wanted }] : [{}, { channel: 'chrome' }, { channel: 'msedge' }];
  for (const how of tries) {
    try { return await chromium.launch({ headless: true, ...how }); } catch { /* the next one */ }
  }
  throw new Error('No browser to run the journeys: install Playwright’s Chromium (npx playwright-core install chromium), or Chrome, or set OKB_JOURNEY_BROWSER.');
}

export type App = { readonly page: Page; readonly url: string; readonly kb: string; readonly dir: string; readonly config: OkbConfig; readonly env: NodeJS.ProcessEnv; readonly errors: string[]; close(): Promise<void> };

/** A fictitious work brain, served by the app as built, open in a fresh page. With `baggage`, the person also has their own space. */
export async function openApp(browser: Browser, options: { baggage?: boolean; width?: number; height?: number } = {}): Promise<App> {
  const brain = await demoBrain();
  if (options.baggage) {
    const root = resolve(brain.dir, 'bagage');
    await mkdir(root, { recursive: true });
    await runSetup({ profileId: 'bagage', kbRoot: root, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Mes acquis', brain: { preset: 'career', names: 'fr' } }, { env: brain.env });
  }
  const { config } = await loadConfig({ env: brain.env, profileId: 'travail' });
  const started = await serve(config, { port: 0, env: { ...brain.env, OKB_WEB_APPROVAL: 'off', OKB_NO_OPEN: '1' } });
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: options.height ?? 860 }, locale: 'fr-FR' });
  const page = await context.newPage();
  // Anything the page throws, or logs as an error, fails the journey.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(started.url);
  // The app is there when its screens are: a key pressed before that would go nowhere.
  await page.locator('.tabbar, nav[aria-label="Écrans"]').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.title.includes('OKB') && document.title.length > 4);
  return {
    page, url: started.url, kb: brain.kb, dir: brain.dir, config, env: brain.env, errors,
    async close() { await context.close(); started.server.closeAllConnections(); started.server.close(); closeDbs(); },
  };
}
