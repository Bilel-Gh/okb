import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OkbConfig } from '../config/schema.js';
import { has, t } from '../i18n/index.js';
import { OkbError } from '../util/errors.js';
import { MUTATING, routeFor, type ApiContext } from './api.js';

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
const TYPES: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

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

export async function serve(config: OkbConfig | null, options: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ server: Server; url: string }> {
  const port = options.port ?? 4317;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new OkbError('E_INVALID', 'port must be between 0 and 65535');
  const ctx: ApiContext = { env: options.env ?? process.env, defaultConfig: config, token: randomBytes(24).toString('hex') };
  const mermaid = mermaidPath();
  let origin = '';

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (value: unknown, status = 200) => {
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
          body = await readBody(req);
        }
        json(await handler(ctx, url.searchParams, body));
        return;
      }
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json({ error: 'GET only.' }, 405); return; }
      if (url.pathname === '/vendor/mermaid.js' && mermaid) {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400' });
        res.end(await readFile(mermaid));
        return;
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = resolve(WEB_ROOT, rel);
      if (!file.startsWith(WEB_ROOT + sep) || rel.includes('\0')) { json({ error: 'Not found.' }, 404); return; }
      const content = await readFile(file).catch(() => null);
      if (!content) { json({ error: 'Not found.' }, 404); return; }
      res.writeHead(200, { 'Content-Type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` });
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
        title: key ? t(`err.${key}.title`, params) : t(`code.${code}.title`),
        message: key && has(`err.${key}.why`) ? t(`err.${key}.why`, params) : code === 'E_INTERNAL' ? t('err.internal.why') : t(`code.${code}.explain`),
        fix: key && has(`err.${key}.fix`) ? t(`err.${key}.fix`, params) : has(`code.${code}.fix`) ? t(`code.${code}.fix`) : '',
        // OKB's own messages are precise ("notes/x.md: missing title"); absolute paths are cut out.
        detail: err && !key ? err.message.replace(/(?:\/[^\s/:'"]+)+\/?/g, (m) => (m.includes('/') && m.split('/').length > 3 ? '…/' + m.split('/').slice(-2).join('/') : m)) : undefined,
      }, status);
    }
  });
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
  return { server, url: origin };
}
