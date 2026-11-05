import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

const note = (type: string, title: string, body: string, extra = '') => `---\ntype: ${type}\ntitle: "${title}"\ndescription: ${title}.\nstatus: draft\n${extra}---\n\n# ${title}\n\n${body}\n`;

describe('formations in Progresser (chantier 5)', () => {
  it('shows a formation with its goal, deadline, progress and next step', async () => {
    app = await openApp(browser); const { page, url, config } = app;
    const put = async (p: string, t: string) => { await mkdir(dirname(resolve(config.kb.root, p)), { recursive: true }); await writeFile(resolve(config.kb.root, p), t); };
    await put('guides/devises-fictives.md', note('Guide', 'Les devises fictives', 'Q : Quelle devise ? — R : L’euro.'));
    await put('formations/prix.md', note('Formation', 'Comprendre les prix', '1. [[Les devises fictives]]\n', 'goal: certification\nby: "2099-01-31"\n'));
    await page.goto(`${url}/#/learn/formations`);
    await page.getByRole('link', { name: 'Comprendre les prix' }).waitFor();
    await page.getByText('Certification').waitFor();
    await page.getByRole('link', { name: /Étape suivante : Les devises fictives/ }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-formations.png'), fullPage: true });
  }, 60_000);
});
