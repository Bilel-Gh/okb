#!/usr/bin/env node
/**
 * Speed bench (F2.0-21, F2.0-22): fictitious brains of growing size, no AI,
 * no personal KB, zero tokens. It measures what a person waits for: loading
 * the notes, a search over HTTP (cold, then warm with p95), and the six
 * requests the home page sends at once.
 *
 *   npm run build && node scripts/perf.mjs [--sizes 200,1000,4500] [--out perf.json]
 *
 * Target of the 2.0 (docs/dev/specs/2026-10-10-2.0-socle.md): a warm search
 * under 200 ms at p95 with 5,000 notes.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const sizes = opt('sizes', '200,1000,4500').split(',').map(Number);
const out = opt('out');
const load = path => import(pathToFileURL(resolve(ROOT, 'dist', path)).href);
const { demoNotes, writeDemo } = await load('brain/demo.js');
const { runSetup } = await load('setup/setup.js');
const { loadConfig } = await load('config/load.js');
const { loadBundleFor } = await load('kb/bundle.js');
const { serve } = await load('web/server.js');

const timed = async fn => {
  const start = performance.now();
  const result = await fn();
  return { ms: Math.round(performance.now() - start), result };
};
const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const QUERIES = ['export', 'pourquoi export csv lent', 'réunion', 'déploiement', 'erreur', 'client', 'budget', 'test'];
const rows = [];

for (const tickets of sizes) {
  const folder = await mkdtemp(resolve(tmpdir(), 'okb-perf-'));
  let server;
  try {
    const env = { ...process.env, OKB_HOME: resolve(folder, 'home'), HOME: folder, OKB_LANG: 'fr', OKB_NO_INTERACTIVE: '1', OKB_NO_EVENTS: '1' };
    for (const key of ['OKB_KB_ROOT', 'OKB_PROFILE', 'OKB_ORG_CONFIG', 'OKB_TEAM_CONFIG', 'OKB_STATE_HOME', 'OKB_APPLY_MODE', 'OKB_AI']) delete env[key];
    const kb = resolve(folder, 'kb');
    await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 3, repos: 8, tickets, meetings: 100, concepts: 40 }));
    await runSetup({ profileId: 'perf', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:perf', answerLanguage: 'fr', displayName: 'Bench', brain: { preset: 'work', names: 'fr' } }, { env });
    const { config } = await loadConfig({ env, profileId: 'perf' });

    const loads = [];
    let notes = 0;
    for (let i = 0; i < 3; i++) {
      const t = await timed(() => loadBundleFor(config));
      loads.push(t.ms);
      notes = t.result.entries.length;
    }

    const started = await serve(config, { port: 0, env });
    server = started.server;
    const api = async path => {
      const response = await fetch(started.url + path);
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    };
    const cold = await timed(() => api('/api/find?kb=perf&q=export'));
    const warm = [];
    for (let i = 0; i < 20; i++) warm.push((await timed(() => api(`/api/find?kb=perf&q=${encodeURIComponent(QUERIES[i % QUERIES.length])}`))).ms);
    const home = await timed(() => Promise.all(['/api/status', '/api/brain', '/api/proposals', '/api/suggestions', '/api/learn', '/api/progress'].map(p => api(`${p}?kb=perf`))));
    // F2.4-26: every page's own requests, cold (first open) then warm (coming back), slowest first.
    const ROUTES = ['/api/today', '/api/status', '/api/review', '/api/notes', '/api/brain', '/api/brain/graph', '/api/categories', '/api/tickets', '/api/projects', '/api/actions', '/api/repos', '/api/arch/map', '/api/evening', '/api/inbox', '/api/indicators', '/api/health', '/api/journal', '/api/day', '/api/weekly', '/api/understanding/overview', '/api/learn', '/api/progress', '/api/documents', '/api/settings'];
    const pages = [];
    for (const path of ROUTES) {
      const sep = '?kb=perf';
      try {
        const c = await timed(() => api(path + sep));
        const w = await timed(() => api(path + sep));
        pages.push({ path, coldMs: c.ms, warmMs: w.ms });
      } catch (e) { pages.push({ path, error: String(e.message ?? e).slice(0, 80) }); }
    }
    pages.sort((x, y) => (y.coldMs ?? 0) - (x.coldMs ?? 0));
    // One note changes (as after an approval): the next search reads it again and updates the index.
    const edited = (await loadBundleFor(config)).entries.find(e => !e.reserved && e.path.includes('/'));
    const file = resolve(kb, edited.path);
    await writeFile(file, `${await readFile(file, 'utf8')}\nUne ligne ajoutée.\n`);
    const afterEdit = await timed(() => api('/api/find?kb=perf&q=export'));

    const row = {
      notes,
      loadMs: loads,
      findColdMs: cold.ms,
      findWarmMedianMs: pct(warm, 50),
      findWarmP95Ms: pct(warm, 95),
      homeSixRequestsMs: home.ms,
      findAfterEditMs: afterEdit.ms,
      pages,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    await rm(folder, { recursive: true, force: true });
  }
}
if (out) await writeFile(resolve(out), JSON.stringify({ node: process.version, platform: process.platform, synthetic: true, rows }, null, 2));
