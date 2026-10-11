import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mcpHandler } from '../src/engine/mcp.js';
import { addDocument } from '../src/documents/documents.js';
import { setupSharing } from '../src/share/drawers.js';
import { closeDbs } from '../src/state/db.js';
import { sha256 } from '../src/util/hash.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => { closeDbs(); await Promise.all(boxes.splice(0).map((b) => b.cleanup())); });
const TOKEN = 'AKIA' + 'Q3J7Z2M5K8W1R4T6';
const note = (title: string, text: string) => `---\ntype: Concept\ntitle: ${title}\ndescription: ${text}\nstatus: stable\nx_okb:\n  brain:\n    type: concept\n---\n\n# ${title}\n\n${text}\n`;
async function fixture() { const box = await makeSandbox({ profileId: 'mcp-secrets' }); boxes.push(box); return { box, config: await box.config() }; }
function call(box: Sandbox, name: string, args: unknown, policy = 'assistant') {
  return mcpHandler({ env: { ...box.env, OKB_MCP_POLICY: policy } })({ id: 1, method: 'tools/call', params: { name, arguments: args } });
}
function refused(reply: unknown) {
  expect(reply).toMatchObject({ result: { isError: true, content: [{ type: 'text', text: expect.stringContaining('E_SECRET') }] } });
  expect(JSON.stringify(reply)).not.toContain(TOKEN); expect(JSON.stringify(reply)).not.toContain('AKIA');
  expect((reply as { result: Record<string, unknown> }).result).not.toHaveProperty('structuredContent');
}

describe('MCP result boundary: no credential-shaped content leaves reading tools', () => {
  it.each(['notes_read', 'notes_find', 'shared_glossary'])('refuses an unmarked note through %s, including title and glossary', async (tool) => {
    const { box } = await fixture(); const path = '3 Boîte à outils/Concepts/Solaire.md';
    await writeFixture(resolve(box.vault, path), note(`Cache solaire ${TOKEN}`, `Une lecture solaire contient ${TOKEN}.`));
    refused(await call(box, tool, tool === 'notes_read' ? { path } : tool === 'notes_find' ? { query: 'solaire' } : {}));
  });
  it('refuses a document excerpt through the real documents_list protocol operation', async () => {
    const { box, config } = await fixture();
    await addDocument(config, { name: 'Solaire.txt', bytes: Buffer.from(`Le cache solaire emploie ${TOKEN}.`) });
    refused(await call(box, 'documents_list', { query: 'solaire' }));
  });
  it.each(['shared_find', 'shared_read'])('refuses credential-shaped attribution from an untrusted drawer through %s', async (tool) => {
    const { box, config } = await fixture(); const folder = resolve(box.dir, 'shared');
    await mkdir(folder); await setupSharing(config, box.env, { folder, drawer: 'mine', allowed: true });
    const path = '3 Boîte à outils/Concepts/Solaire.md'; const text = note('Route solaire', 'Une route solaire est une route choisie.');
    await writeFixture(resolve(folder, 'colleague', path), text);
    await writeFixture(resolve(folder, 'colleague', 'drawer.json'), JSON.stringify({ kind: 'okb-drawer', v: 1, person: { id: 'p-0123456789' }, name: `Colleague ${TOKEN}`, updatedAt: '2026-10-11T09:00:00.000Z', notes: [{ path, title: 'Route solaire', sha256: sha256(text) }] }));
    refused(await call(box, tool, tool === 'shared_find' ? { query: 'solaire' } : { drawer: 'colleague', path }));
  });
  it('retains ordinary structured reading results and applies the same boundary to external-agent MCP', async () => {
    const { box } = await fixture(); const path = 'safe.md';
    await writeFixture(resolve(box.vault, path), note('Cache sûr', 'Le cache expire après dix minutes.'));
    expect(await call(box, 'notes_read', { path })).toMatchObject({ result: { structuredContent: expect.anything() } });
    await writeFixture(resolve(box.vault, path), note('Cache sûr', `Le cache contient ${TOKEN}.`));
    refused(await call(box, 'notes_read', { path }, 'external'));
  });
});
