#!/usr/bin/env node
// The screenshots of the guides, taken from a running OKB app on a FICTITIOUS brain
// (never a real one: the pictures are public). Usage:
//   okb serve --no-open --kb <demo brain> --port 4317     # in another terminal
//   node scripts/screenshots.mjs --url http://127.0.0.1:4317 --kb <demo brain> [--out docs/images] [--note "<a note's path>"]
// Needs a Chromium: Playwright's, or the Chrome or Edge of the machine (OKB_JOURNEY_BROWSER picks one).
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url');
const kb = arg('kb');
const out = resolve(arg('out', 'docs/images'));
if (!url || !kb) { console.error('usage: node scripts/screenshots.mjs --url <app url> --kb <fictitious brain> [--out docs/images] [--note <path>]'); process.exit(2); }

async function launch() {
  const wanted = process.env.OKB_JOURNEY_BROWSER;
  const tries = wanted ? [wanted.includes('/') ? { executablePath: wanted } : { channel: wanted }] : [{}, { channel: 'chrome' }, { channel: 'msedge' }];
  for (const how of tries) { try { return await chromium.launch({ headless: true, ...how }); } catch { /* the next one */ } }
  throw new Error('No browser found: install Playwright’s Chromium, Chrome or Edge, or set OKB_JOURNEY_BROWSER.');
}

const browser = await launch();
await mkdir(out, { recursive: true });
const api = async (path) => (await fetch(`${url}${path}${path.includes('?') ? '&' : '?'}kb=${encodeURIComponent(kb)}`)).json();
const notes = (await api('/api/notes')).notes ?? [];
const note = arg('note') ?? (notes.find((n) => /Méthodes\/|Methods\//.test(n.path)) ?? notes[0])?.path;
const change = ((await api('/api/proposals')).proposals ?? []).find((p) => p.status === 'prepared')?.id;

/** One picture: a look, a mode, an address, and what must be on the page before the shot. */
async function shot(file, { hash, look = 'atelier', mode = 'light', wait, before }) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: 'fr-FR', colorScheme: mode });
  await context.addInitScript(([l, m, k]) => { localStorage.setItem('okb-look', l); localStorage.setItem('okb-theme', m); localStorage.setItem('okb-kb', k); localStorage.setItem('okb-tour', 'done'); }, [look, mode, kb]);
  const page = await context.newPage();
  await page.goto(`${url}/${hash}`);
  await page.waitForFunction(() => document.title.includes('OKB') && document.title.length > 4);
  if (wait) await page.locator(wait).first().waitFor({ timeout: 15_000 }).catch(() => console.warn(`  ${file}: « ${wait} » did not show`));
  if (before) await before(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(out, file) });
  await context.close();
  console.log(`✓ ${file}`);
}

await shot('web-home.png', { hash: '#/', wait: '#todo' });
await shot('web-home-dark.png', { hash: '#/', mode: 'dark', wait: '#todo' });
await shot('web-classique.png', { hash: '#/', look: 'classique', wait: '#todo' });
if (note) {
  await shot('web-atelier.png', { hash: `#/note/${encodeURIComponent(note)}`, wait: 'article h1' });
  await shot('web-note.png', { hash: `#/note/${encodeURIComponent(note)}`, wait: 'article h1', before: async (page) => { await page.locator('.note-sources, article').first().scrollIntoViewIfNeeded().catch(() => undefined); } });
}
const project = ((await api('/api/projects')).projects ?? []).find((p) => p.kind === 'subject')?.id;
if (project) await shot('web-project.png', { hash: `#/project/${encodeURIComponent(project)}`, wait: '#left-off, .panel' });
await shot('web-documents.png', { hash: '#/documents', wait: '.doc-rows, .panel' });
await shot('web-validate.png', { hash: '#/review', wait: '.evening, .panel' });
await shot('web-health.png', { hash: '#/health', wait: '.indicators' });
await shot('web-review.png', { hash: change ? `#/review/${encodeURIComponent(change)}` : '#/review', wait: '.panel' });
await shot('web-settings.png', { hash: '#/settings', wait: '.segmented' });
await shot('web-graph.png', { hash: '#/graph', wait: 'canvas, svg' });
await shot('web-architecture.png', { hash: '#/repos/architecture', wait: 'svg, .panel' });
await browser.close();
