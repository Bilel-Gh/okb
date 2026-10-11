import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDbs } from '../src/state/db.js';
import { serve } from '../src/web/server.js';
import { demoBrain } from './helpers/brain.js';

const servers: { close: () => void }[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); closeDbs(); });
const b64 = (text: string) => Buffer.from(text).toString('base64');

async function app() {
  const brain = await demoBrain();
  // No application is started for a file during the tests.
  const started = await serve(brain.config, { port: 0, env: { ...brain.env, OKB_NO_OPEN: '1' } });
  servers.push({ close: () => { started.server.closeAllConnections(); started.server.close(); } });
  const token = ((await (await fetch(`${started.url}/api/session`)).json()) as { token: string }).token;
  const get = async (path: string) => (await fetch(started.url + path)).json() as Promise<Record<string, never>>;
  const post = (path: string, body: unknown, headers: Record<string, string> = { 'X-OKB-Token': token }) =>
    fetch(started.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...brain, get, post };
}

describe('documents in the app (F2.0-10)', () => {
  it('keeps a dropped file, finds it by a word of its text, and hides it from assistants on demand', async () => {
    const { kb, get, post } = await app();
    const text = 'Le car coûte 480 euros pour la journée.';
    const kept = await post('/api/documents', { name: 'Devis.txt', data: b64(text) });
    expect(kept.status).toBe(200);
    const { document } = (await kept.json()) as { document: { id: string; path: string; secret: boolean } };
    expect(await readFile(resolve(kb, document.path), 'utf8')).toBe(text);

    const found = (await get('/api/documents?query=euros')) as unknown as { documents: { id: string; snippet: string }[] };
    expect(found.documents.map((d) => d.id)).toEqual([document.id]);
    expect(found.documents[0]!.snippet).toContain('euros');
    expect(((await get('/api/find?q=euros')) as unknown as { documents: { id: string }[] }).documents.map((d) => d.id)).toEqual([document.id]);

    const hidden = await post('/api/document/update', { id: document.id, secret: true });
    expect(((await hidden.json()) as { secret: boolean }).secret).toBe(true);
  });

  it('a file bigger than an ordinary request is accepted, up to the limit of a document', async () => {
    const { post } = await app();
    const big = await post('/api/documents', { name: 'gros.txt', data: Buffer.alloc(1_500_000, 97).toString('base64') });
    expect(big.status).toBe(200);
    expect(((await big.json()) as { document: { size: number } }).document.size).toBe(1_500_000);
  });

  it('keeping, changing and opening a document need the session of the page', async () => {
    const { post } = await app();
    for (const path of ['/api/documents', '/api/document/update', '/api/document/open']) {
      expect((await post(path, { name: 'x.txt', data: b64('x') }, {})).status, path).toBe(403);
    }
  });

  it('opening hands the file itself to the computer; an unknown document is refused', async () => {
    const { kb, post } = await app();
    const { document } = (await (await post('/api/documents', { name: 'plan.txt', data: b64('Le plan.') })).json()) as { document: { id: string; path: string } };
    const opened = await post('/api/document/open', { id: document.id });
    // OKB_NO_OPEN: nothing is started, and the answer says where the file is.
    expect(await opened.json()).toEqual({ ok: false, file: resolve(kb, document.path) });
    expect((await post('/api/document/open', { id: 'D-nope00' })).status).toBe(404);
  });
});
