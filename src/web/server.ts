import { randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OkbConfig } from '../config/schema.js';
import { loadConfig } from '../config/load.js';
import { listKbs } from '../kb/registry.js';
import { has, t } from '../i18n/index.js';
import { OkbError } from '../util/errors.js';
import { MUTATING, routeFor, type ApiContext } from './api.js';
import { loadBundleFor } from '../kb/bundle.js';
import { backupDue, runBackup } from '../brain/backup.js';

/**
 * The OKB web app: every terminal workflow in the browser, on this computer only.
 *
 * - Loopback only, exact Host header (no DNS rebinding), same-origin requests only.
 * - Reads are GET; every change is a POST carrying the session token the page got
 *   from a same-origin request, so another site cannot act (CSRF).
 * - Approvals additionally need the person's confirmation on screen (presence.ts).
 * - Notes are rendered through a sanitizer; the page loads nothing from outside.
 */
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const TYPES: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

/** When OKB was built: this file is rewritten by every build, so its date tells one build from the next. */
export function buildStamp(): string {
  try { return String(Math.round(statSync(fileURLToPath(import.meta.url)).mtimeMs)); } catch { return 'unknown'; }
}

/**
 * The page's files, read once when the server starts: after an update, a running
 * server keeps serving the page that matches its own code (and tells the page it
 * is outdated) instead of a new page talking to an old API. OKB_WEB_LIVE=1 reads
 * from disk on every request, for development.
 */
async function snapshotWeb(): Promise<Map<string, Buffer> | null> {
  if (process.env.OKB_WEB_LIVE === '1') return null;
  const out = new Map<string, Buffer>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(resolve(dir, entry.name), rel);
      else if (entry.isFile() && TYPES[extname(entry.name)]) out.set(rel, await readFile(resolve(dir, entry.name)));
    }
  };
  try { await walk(WEB_ROOT, ''); } catch { return null; }
  return out;
}

function mermaidPath(): string | null {
  try { return createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js'); } catch { return null; }
}

async function readBody(req: IncomingMessage, max = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new OkbError('E_INVALID', 'request too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    throw new OkbError('E_INVALID', 'invalid JSON body');
  }
}

export async function serve(config: OkbConfig | null, options: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ server: Server; url: string; shutdown: () => Promise<void>; /** A one-time link that gives the opened browser its session key (D71). */ openUrl: () => string }> {
  const port = options.port ?? 4317;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new OkbError('E_INVALID', 'port must be between 0 and 65535');
  const boot = buildStamp();
  let stopServer: () => void = () => {};
  const ctx: ApiContext = { env: options.env ?? process.env, defaultConfig: config, token: randomBytes(24).toString('hex'), build: { boot, now: buildStamp }, stop: () => stopServer() };
  const assets = await snapshotWeb();
  const mermaid = mermaidPath();
  let origin = '';
  // D71: the browser OKB opens gets a session key, through a link usable once; never written or printed.
  const presenceKey = randomBytes(24).toString('hex');
  // D71: the page OKB opens trades a one-time link (valid one minute, one at a time) for the key and keeps it in
  // its tab (sessionStorage, per port). Never a cookie: a browser sends cookies to every port of 127.0.0.1.
  let oneTime: { k: string; until: number } | null = null;
  const openUrl = (): string => { const k = randomBytes(16).toString('hex'); oneTime = { k, until: Date.now() + 60_000 }; return `${origin}/?k=${k}`; };
  const claim = (k: string): string | null => {
    const live = oneTime; oneTime = null;
    return live && Date.now() <= live.until && k.length === live.k.length && timingSafeEqual(Buffer.from(k), Buffer.from(live.k)) ? presenceKey : null;
  };
  const present = (req: IncomingMessage) => { const h = String(req.headers['x-okb-presence'] ?? ''); return h.length === presenceKey.length && timingSafeEqual(Buffer.from(h), Buffer.from(presenceKey)); };
  let stopping = false;
  const jobs = new Set<Promise<void>>();
  const readingBodies = new Set<IncomingMessage>();
  let soon: ReturnType<typeof setTimeout> | undefined;
  let hourly: ReturnType<typeof setInterval> | undefined;
  let backupRunning = false;
  const track = (work: Promise<void>) => {
    const tracked = work.catch(() => undefined).finally(() => jobs.delete(tracked));
    jobs.add(tracked);
  };
  const snapshot = () => {
    if (stopping || backupRunning) return;
    backupRunning = true;
    track((async () => {
      // Keep an explicitly served space covered, and follow the active space after onboarding/switching.
      const kbs = await listKbs(ctx.env);
      const active = (kbs.find((kb) => kb.active) ?? kbs[0])?.id;
      for (const profileId of new Set([config?.profile.id, active])) {
        if (!profileId || !kbs.some((kb) => kb.id === profileId && kb.exists)) continue;
        try {
          const current = (await loadConfig({ env: ctx.env, profileId })).config;
          if (await backupDue(current, ctx.env)) await runBackup(current, { env: ctx.env });
        } catch { /* A broken space must not prevent the other space's snapshot. Its status stays due. */ }
      }
    })().finally(() => { backupRunning = false; }));
  };
  const scheduleSoon = () => {
    if (stopping) return;
    clearTimeout(soon);
    soon = setTimeout(snapshot, 30_000); soon.unref();
  };
  const clearTimers = () => { clearTimeout(soon); clearInterval(hourly); };

  const server = createServer((req, res) => {
    if (stopping) { res.writeHead(503, { Connection: 'close' }); res.end(); return; }
    track(handle(req, res).catch(() => { res.destroy(); }));
  });
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (value: unknown, status = 200) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    // Exact Host prevents DNS rebinding; cross-site reads and writes are refused.
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      json({ error: 'This app accepts same-origin loopback requests only.' }, 403); return;
    }
    if ((req.url?.length ?? 0) > 8192) { json({ error: 'Request too long.' }, 414); return; }
    const url = new URL(req.url ?? '/', origin);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); json({ error: 'Method not allowed.' }, 405); return; }
        const handler = routeFor(req.method, url.pathname);
        if (!handler) {
          if (routeFor(req.method === 'GET' ? 'POST' : 'GET', url.pathname)) { json({ error: 'Method not allowed.' }, 405); return; }
          json({ error: 'Not found.' }, 404); return;
        }
        let body: Record<string, unknown> = {};
        if (MUTATING.has(`${req.method} ${url.pathname}`)) {
          if (req.headers['x-okb-token'] !== ctx.token) { json({ error: 'Missing or wrong session token.' }, 403); return; }
          if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { json({ error: 'JSON only.' }, 415); return; }
          // A pack carries a whole subject's notes: a larger body than any other request.
          // A pack or a document to keep is a whole file: they get more room than a form.
          readingBodies.add(req);
          try { body = await readBody(req, url.pathname.startsWith('/api/packs/') || url.pathname === '/api/documents' ? 30_000_000 : 1_000_000); }
          finally { readingBodies.delete(req); }
        }
        // A body read interrupted by shutdown never starts an operation.
        if (stopping) { json({ error: 'The app is stopping.' }, 503); return; }
        const result = await handler({ ...ctx, present: present(req), claim }, url.searchParams, body);
        if (req.method === 'POST' && url.pathname === '/api/onboarding') scheduleSoon();
        json(result);
        return;
      }
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json({ error: 'GET only.' }, 405); return; }
      if (url.pathname === '/vendor/mermaid.js' && mermaid) {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400' });
        res.end(await readFile(mermaid));
        return;
      }
      // The first versions' interface is gone (F2.0-26): its address leads to the app, with the page asked for.
      if (url.pathname === '/classic') { res.writeHead(302, { Location: '/' }); res.end(); return; }
      const rel = url.pathname === '/' ? 'app/index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = resolve(WEB_ROOT, rel);
      if (!file.startsWith(WEB_ROOT + sep) || rel.includes('\0')) { json({ error: 'Not found.' }, 404); return; }
      const content = assets ? assets.get(rel.split(sep).join('/')) ?? null : await readFile(file).catch(() => null);
      if (!content) { json({ error: 'Not found.' }, 404); return; }
      // F2.4-26: a versioned file of the app (its name changes with its content) stays in the browser, compiled;
      // the page itself is always asked again, so an update is seen at once.
      const versioned = /^app\/assets\/[^/]+-[\w-]{6,}\.[a-z0-9]+$/.test(rel.split(sep).join('/'));
      res.writeHead(200, { 'Content-Type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, ...(versioned ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}) });
      res.end(content);
    } catch (error) {
      // Never leak a stack or a private path to the page: code, and a message for people.
      const err = error instanceof OkbError ? error : null;
      const code = err?.code ?? 'E_INTERNAL';
      const key = err?.key && has(`err.${err.key}.title`) ? err.key : null;
      const params = { ...(err?.params ?? {}), message: '' };
      const status = code === 'E_NOT_FOUND' ? 404 : code === 'E_STALE' ? 409 : code === 'E_INTERNAL' || code === 'E_IO' ? 500 : 400;
      json({
        error: code,
        // The page reacts to some errors (a 🔒 note to confirm, a module turned off): their key, never a path.
        ...(key ? { key } : {}),
        title: key ? t(`err.${key}.title`, params) : t(`code.${code}.title`),
        message: key && has(`err.${key}.why`) ? t(`err.${key}.why`, params) : code === 'E_INTERNAL' ? t('err.internal.why') : t(`code.${code}.explain`),
        fix: key && has(`err.${key}.fix`) ? t(`err.${key}.fix`, params) : has(`code.${code}.fix`) ? t(`code.${code}.fix`) : '',
        // OKB's own messages are precise ("notes/x.md: missing title"); absolute paths are cut out.
        detail: err && !key ? err.message.replace(/(?:\/[^\s/:'"]+)+\/?/g, (m) => (m.includes('/') && m.split('/').length > 3 ? '…/' + m.split('/').slice(-2).join('/') : m)) : undefined,
      }, status);
    }
  }
  server.requestTimeout = 180_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((done, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE'
      ? new OkbError('E_CONFLICT', `port ${port} is already in use`, { key: 'portInUse', params: { port, next: port + 1 } })
      : e));
    server.listen(port, '127.0.0.1', () => { server.removeAllListeners('error'); done(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new OkbError('E_IO', 'cannot determine local reader address');
  origin = `http://127.0.0.1:${address.port}`;
  let shuttingDown: Promise<void> | undefined;
  const shutdown = (): Promise<void> => shuttingDown ??= (async () => {
    stopping = true;
    clearTimers();
    const closed = new Promise<void>((done, reject) => server.close((error?: NodeJS.ErrnoException) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : done()));
    // Incomplete JSON has not started any state operation. Do not wait three minutes for a stalled sender.
    for (const req of readingBodies) req.destroy();
    while (jobs.size) await Promise.all([...jobs]);
    server.closeAllConnections();
    await closed;
  })();
  stopServer = () => { void shutdown().catch(() => undefined); };
  // The app alone must be enough: it takes the day's snapshot too (F2.0-14), a little after it opens, then checks every hour.
  scheduleSoon();
  // F2.4-26: read the memory once now, so the first page the person opens does not wait for it.
  if (config) track(loadBundleFor(config).then(() => undefined));
  hourly = setInterval(snapshot, 3_600_000); hourly.unref();
  server.once('close', () => { stopping = true; clearTimers(); });
  return { server, url: origin, shutdown, openUrl };
}
