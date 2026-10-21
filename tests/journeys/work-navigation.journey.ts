import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addRepo } from '../../src/repo/registry.js';
import { startTicket } from '../../src/work/tickets.js';
import { setTicketState, updateTicketBrief } from '../../src/work/ticket-state.js';
import { listProjects, updateProject } from '../../src/projects/projects.js';
import { syncProjects } from '../../src/projects/sources.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser; let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });
async function seed() {
  const { dir, config, env } = app!;
  const path = resolve(dir, 'Technical API'); await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'README.md'), '# Technical API\nA fictitious repository for navigation tests.\n');
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: path });
  const { repo } = await addRepo({ path, kb: config.profile.id }, env);
  await startTicket(config, { repo, ref: 'DEMO-42', title: 'Retry sans double effet' });
  await updateTicketBrief(config, 'DEMO-42', { goal: 'Conserver un seul effet', lastAction: 'Test multi-instance réalisé', next: 'Relire les preuves de la recette. '.repeat(16) });
  await setTicketState(config, 'DEMO-42', { dimension: 'waiting', status: 'blocked', detail: 'Attendre la recette à deux instances. '.repeat(16) }, 'person');
  await syncProjects(config, env);
  const project = (await listProjects(config, env, { status: 'all' })).find((p) => p.ref === 'DEMO-42')!;
  updateProject(config, project.id, { where: 'Un contexte humain conservé', leftOff: { done: 'Tests exécutés', tried: 'Verrou local rejeté', waiting: 'Recette attendue', resume: 'CORRECTION-FINALE-DE-REPRISE '.repeat(12), at: new Date().toISOString(), edited: true } });
  return { repo, project };
}

describe('short work resumption, contextual assistant and repository context', () => {
  it('opens the same ticket from Today, Projects and its repository; keeps complete facts and prepares local help without AI', async () => {
    app = await openApp(browser); const { page, url } = app; const { repo, project } = await seed();
    await page.reload();
    // D70: Today's card reads the sheet — real title, its next step, short.
    const todayCard = page.locator('.tk-tcard').filter({ hasText: 'DEMO-42' });
    await todayCard.waitFor(); expect((await todayCard.textContent())!.length).toBeLessThan(400);
    expect(await todayCard.getAttribute('href')).toBe('#/ticket/DEMO-42');
    await todayCard.getByText('Retry sans double effet').waitFor();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-work-today-light.png'), fullPage: true });
    await page.goto(`${url}/#/projects`);
    await page.locator('.work-preview').filter({ hasText: 'DEMO-42' }).waitFor();
    expect(await page.locator('.project-rows').getByText('Technical API', { exact: true }).count()).toBe(0);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-work-projects-light.png'), fullPage: true });
    const ticketLink = page.locator('.work-preview').filter({ hasText: 'DEMO-42' }).getByRole('link');
    await ticketLink.focus(); expect(await ticketLink.evaluate((e) => e === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'En 30 secondes' }).waitFor();
    await page.getByText(/^Plus de détails/).click();
    await page.getByText(/CORRECTION-FINALE-DE-REPRISE/).waitFor();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-work-ticket-light.png'), fullPage: true });
    const sent: string[] = []; page.on('request', (r) => { if (/\/api\/assistant\/(ask|start)$/.test(new URL(r.url()).pathname)) sent.push(r.url()); });
    await page.getByRole('link', { name: 'Où j’en étais', exact: true }).click();
    const field = page.getByLabel('Mon message à l’assistant'); await field.waitFor(); expect(await field.inputValue()).toContain('DEMO-42');
    expect(await field.evaluate((e) => e === document.activeElement)).toBe(true);
    const composer = await field.boundingBox(); expect(composer!.y).toBeGreaterThanOrEqual(0); expect(composer!.y + composer!.height).toBeLessThanOrEqual(860);
    expect(sent).toEqual([]);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-work-assistant-light.png'), fullPage: true });
    await page.getByRole('link', { name: 'Chercher dans mes notes sans IA' }).click();
    expect(page.url()).toContain('#/ask?q=');
    await page.goto(`${url}/#/project/${project.id}`); await page.getByRole('heading', { name: 'En 30 secondes' }).waitFor(); expect(page.url()).toContain('#/ticket/DEMO-42');
    await page.goto(`${url}/#/repo/${repo.id}`);
    await page.locator('.work-preview').filter({ hasText: 'DEMO-42' }).waitFor();
    await page.getByText('/okb-dev:ticket', { exact: true }).waitFor();
    expect(await page.getByText('/okb:ticket', { exact: true }).count()).toBe(0);
    await page.getByText('Détails techniques et compréhension', { exact: true }).focus(); await page.keyboard.press('Enter');
    expect(await page.locator('details.repo-secondary').last().getAttribute('open')).not.toBeNull();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-work-repo-light.png'), fullPage: true });
    for (const mode of ['light', 'dark']) {
      await page.setViewportSize({ width: 390, height: 780 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate((m) => { localStorage.setItem('okb-theme', m); }, mode);
      await page.reload();
      await page.goto(`${url}/#/ticket/DEMO-42`); await page.getByRole('heading', { name: 'En 30 secondes' }).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(tmpdir(), `okb-work-ticket-mobile-${mode}.png`), fullPage: true, animations: 'disabled' });
      await page.screenshot({ path: resolve(tmpdir(), `okb-work-ticket-mobile-${mode}-viewport.png`), animations: 'disabled' });
    }
  });
});
