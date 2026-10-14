import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { architectureFixture } from '../helpers/arch-visual.js';
import { launchBrowser, openApp, type App } from './app.js';

let browser: Browser;
let app: App | null = null;
beforeAll(async () => { browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { const errors = app?.errors ?? []; await app?.close(); app = null; expect(errors).toEqual([]); });

async function open(kind: Parameters<typeof architectureFixture>[0], width: number) {
  app = await openApp(browser, { width, height: 960 });
  const fixture = architectureFixture(kind);
  await app.page.route('**/api/repos/arch*', (route) => route.fulfill({ json: fixture }));
  await app.page.route(/\/api\/repos(?:\?|$)/, (route) => route.fulfill({ json: { repos: [], unlinked: [] } }));
  await app.page.goto(`${app.url}/#/repos/architecture`);
  await app.page.getByLabel('Repo à explorer').waitFor();
  return fixture;
}

async function checkNames() {
  const overlaps = await app!.page.locator('.arch-map').evaluate((svg) => {
    const boxes = [...svg.querySelectorAll('.arch-name')].map((el) => ({ rect: el.getBoundingClientRect(), text: el.textContent }));
    return boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.rect.left < b.rect.right && a.rect.right > b.rect.left && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top).map((b) => [a.text, b.text]));
  });
  expect(overlaps, 'full names overlap').toEqual([]);
  const crossings = await app!.page.locator('.arch-map').evaluate((svg) => {
    const labels = [...svg.querySelectorAll('.arch-name, .arch-tech')].map((el) => ({ rect: el.getBoundingClientRect(), text: el.textContent }));
    return [...svg.querySelectorAll<SVGPathElement>('.arch-line')].flatMap((path) => {
      const matrix = path.getScreenCTM();
      if (!matrix) return [];
      const hit = new Set<string>();
      for (let distance = 0; distance <= path.getTotalLength(); distance += 3) {
        const p = path.getPointAtLength(distance).matrixTransform(matrix);
        for (const label of labels) if (p.x > label.rect.left && p.x < label.rect.right && p.y > label.rect.top && p.y < label.rect.bottom) hit.add(label.text ?? '');
      }
      return [...hit];
    });
  });
  expect(crossings, 'relations cross full names or technical labels').toEqual([]);
  const overflow = await app!.page.locator('body').evaluate((el) => ({ width: window.innerWidth, scroll: el.scrollWidth, elements: [...document.querySelectorAll('body *')].filter((n) => { const r = n.getBoundingClientRect(); return r.left > -1 && r.right > window.innerWidth + 1 && !n.closest('.arch-scroll'); }).slice(0, 12).map((n) => `${n.tagName}.${n.className}`) }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  expect(await app!.page.locator('.arch-map').evaluate((el) => getComputedStyle(el).maxWidth)).toBe('none');
}

describe('architecture in a real browser with fictitious repositories', () => {
  it('dense multi-repo map stays bounded, exposes every hidden dependency, and reveals sources by keyboard', async () => {
    const fixture = await open('dense', 1440);
    const page = app!.page;
    expect(await page.locator('.arch-station').count()).toBeLessThanOrEqual(8);
    await checkNames();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-architecture-dense-wide.png'), fullPage: true });
    await page.getByRole('button', { name: /Afficher les repos masqués/ }).click();
    expect(await page.locator('.arch-station').count()).toBe(fixture.model.nodes.filter((n) => n.kind === 'repo').length);
    await page.getByRole('checkbox', { name: /Toutes les relations/ }).check();
    expect(await page.locator('.arch-relation-row').count()).toBe(fixture.model.links.length);
    const first = page.locator('.arch-relation-row').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await page.getByText('src/client.ts:3', { exact: true }).waitFor();
    await page.getByText('src/route.ts:4', { exact: true }).waitFor();
    expect(await page.locator('.arch-side').evaluate((el) => el === document.activeElement)).toBe(true);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-architecture-dense-expanded.png'), fullPage: true });
  });

  it('long labels, cycle, shared database and uncertainty remain readable on a narrow dark screen', async () => {
    await open('uncertain', 390);
    const page = app!.page;
    await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
    await page.getByLabel('Repo à explorer').selectOption('repo:orders');
    const chosen = await page.locator('.arch-station.on').boundingBox();
    expect(chosen?.x).toBeGreaterThanOrEqual(0);
    expect((chosen?.x ?? 390) + (chosen?.width ?? 0)).toBeLessThanOrEqual(390);
    await checkNames();
    expect(await page.locator('.arch-station').count()).toBe(4);
    expect(await page.locator('.arch-edge.uncertain').count()).toBe(2);
    await page.screenshot({ path: resolve(tmpdir(), 'okb-architecture-cycle-narrow-dark.png'), fullPage: true });
    await page.locator('.arch-scroll').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.screenshot({ path: resolve(tmpdir(), 'okb-architecture-cycle-narrow-right.png'), fullPage: true });
    await page.locator('.arch-relation-row').first().click();
    await page.getByText('src/route.ts:4', { exact: true }).waitFor();
  });

  it('small map and flow make static execution limits explicit', async () => {
    await open('small', 1280);
    const page = app!.page;
    await page.getByLabel('Repo à explorer').selectOption('repo:orders');
    await checkNames();
    await page.screenshot({ path: resolve(tmpdir(), 'okb-architecture-small-wide.png'), fullPage: true });
    await page.getByRole('button', { name: 'Un parcours', exact: true }).click();
    await page.getByText(/Le scan ne prouve pas leur ordre d’exécution/).waitFor();
    expect(await page.locator('.arch-flow-step').count()).toBeGreaterThan(0);
  });
});
