import { createServer, type Server } from 'node:http';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { guardApply } from '../apply/guard.js';
import { ask } from '../pipeline/ask.js';
import { maintain } from '../maintain/maintain.js';
import { listProposals, loadProposal } from '../proposal/store.js';
import { groupChangesByPath, materializeFile } from '../proposal/materialize.js';
import { unifiedDiff } from '../proposal/diff.js';
import { renderBrief } from '../style/brief.js';
import { resolveStyle } from '../style/resolve.js';
import { asBundlePath } from '../util/paths.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import { PAGE, SCRIPT, CSS } from './ui.js';

/** A local reader. No route acquires sources, signs approvals or writes state/KB. */
export async function serve(config: OkbConfig, options: { port?: number } = {}): Promise<{ server: Server; url: string }> {
  const port = options.port ?? 4317;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new OkbError('E_INVALID', 'port must be between 0 and 65535');
  let origin = '';
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    // Exact Host prevents DNS rebinding. Browser cross-origin reads are refused
    // even for top-level navigations that might otherwise bypass CORS.
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      json({ error: 'This reader accepts same-origin loopback requests only.' }, 403); return;
    }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json({ error: 'Read-only: GET only.' }, 405); return; }
    if ((req.url?.length ?? 0) > 8192) { json({ error: 'Request too long.' }, 414); return; }
    try {
      const url = new URL(req.url ?? '/', origin);
      const asset = url.pathname === '/' ? [PAGE, 'text/html'] : url.pathname === '/app.js' ? [SCRIPT, 'text/javascript'] : url.pathname === '/style.css' ? [CSS, 'text/css'] : null;
      if (asset) { res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(asset[0]); return; }
      if (!['/api/overview', '/api/note', '/api/search', '/api/proposal', '/api/audit'].includes(url.pathname)) { json({ error: 'Not found.' }, 404); return; }
      const bundle = await loadBundleFor(config);
      if (url.pathname === '/api/overview') {
        const proposals = (await listProposals(config)).filter(p => p.profileId === config.profile.id && p.kbRoot === config.kb.root && p.status === 'prepared');
        json({ profile: config.profile.id, style: resolveStyle(config), readerDomains: config.reader.byDomain, brief: renderBrief(resolveStyle(config)),
          notes: bundle.entries.map(e => ({ path: e.path, title: e.title, description: e.description, type: e.type, status: e.status, trust: e.trust })),
          proposals: proposals.map(p => ({ id: p.id, createdAt: p.createdAt, changes: p.changes.length, files: new Set(p.changes.map(c => c.path)).size })) });
      } else if (url.pathname === '/api/note') {
        const path = asBundlePath(url.searchParams.get('path') ?? '');
        const doc = bundle.docs.get(path);
        if (!doc) { json({ error: 'Note not found in this bundle.' }, 404); return; }
        json({ path, title: bundle.byPath.get(path)?.title ?? path, body: doc.body, raw: doc.raw });
      } else if (url.pathname === '/api/search') {
        const query = (url.searchParams.get('q') ?? '').trim();
        if (!query || query.length > 500) { json({ error: 'Enter a question of 1–500 characters.' }, 400); return; }
        json(await ask(config, query, { bundle, limit: 15 }));
      } else if (url.pathname === '/api/audit') {
        json(await maintain(config, { bundle }));
      } else {
        const proposal = await loadProposal(config, url.searchParams.get('id') ?? '');
        const guard = await guardApply(config, proposal, proposal.changes);
        // Both observations must match the approved baseline. The bundle was
        // loaded before guard's disk reads and may have seen an earlier edit.
        for (const path of guard.ok ? new Set(proposal.changes.map(c => c.path)) : []) {
          const text = bundle.snapshot.files.get(path);
          if ((text === undefined ? null : sha256(text)) !== proposal.baseline[path]) {
            json({ error: 'E_STALE', message: 'The KB changed while loading the preview. Refresh or rebuild the proposal.' }, 409); return;
          }
        }
        // A stale proposal is visible, but materializing it on a newer baseline
        // would show a diff the human could never safely approve.
        const files = guard.ok ? [...groupChangesByPath(proposal.changes)].map(([path, changes]) => {
          const before = bundle.snapshot.files.get(path) ?? null;
          const after = materializeFile(path, before, changes);
          const diff = unifiedDiff(before ?? '', after, { path });
          return { path, after, diff: diff.text, stats: diff.stats };
        }) : [];
        json({ id: proposal.id, status: proposal.status, contentHash: proposal.contentHash,
          notes: proposal.notes, contradictions: proposal.contradictions, guard, files,
          evidence: proposal.evidence, changes: proposal.changes.map(c => ({ id: c.id, path: c.path, label: c.label, rationale: c.rationale, dependsOn: c.dependsOn })),
          approvalCommand: `okb review ${proposal.id} --profile ${config.profile.id} --approve`,
          applyCommand: `okb apply ${proposal.id} --profile ${config.profile.id}` });
      }
    } catch (error) {
      // Do not leak private absolute paths or stacks to a requesting page.
      const code = error instanceof OkbError ? error.code : 'E_INTERNAL';
      json({ error: code, message: 'Cannot display this item. Check it with the CLI for details.' }, code === 'E_NOT_FOUND' ? 404 : code === 'E_INTERNAL' ? 500 : 400);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new OkbError('E_IO', 'cannot determine local reader address');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: origin };
}
