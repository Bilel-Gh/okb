import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invoke } from '../src/engine/registry.js';
import { mcpHandler } from '../src/engine/mcp.js';
import { setModule } from '../src/modules/catalog.js';
import { serve } from '../src/web/server.js';
import { demoBrain } from './helpers/brain.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const BIN = resolve(TEST_ROOT, '..', 'dist', 'cli', 'index.js');
const servers: { close: () => void }[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

/** The person in a terminal, or Claude: what tells them apart is the environment. */
const asPerson = (env: NodeJS.ProcessEnv) => {
  const out = { ...env };
  for (const k of ['OKB_VIA_CLAUDE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete out[k];
  return out;
};
const asClaude = (env: NodeJS.ProcessEnv) => ({ ...asPerson(env), OKB_VIA_CLAUDE: '1' });

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? 0, stdout, stderr }));
    if (input !== undefined) { child.stdin!.write(input); child.stdin!.end(); }
  });
}

async function web(env: NodeJS.ProcessEnv, config: Parameters<typeof serve>[0]) {
  const started = await serve(config, { port: 0, env });
  servers.push({ close: () => { started.server.closeAllConnections(); started.server.close(); } });
  return async (path: string) => {
    const r = await fetch(started.url + path);
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
}

const shape = (r: { best: { path: string } | null; hits: { path: string; score: number; stars: number | null }[] }) => ({ best: r.best?.path ?? null, hits: r.hits.map((h) => [h.path, h.score, h.stars]) });

async function brainWithSecret() {
  const b = await demoBrain({ tickets: 12 });
  await mkdir(dirname(resolve(b.kb, '2 Produits/Coffre.md')), { recursive: true });
  await writeFile(resolve(b.kb, '2 Produits/Coffre.md'), '---\ntype: Guide\ntitle: Coffre export\ndescription: Le coffre.\nx_okb:\n  confidentiality: secret\n---\n\n# Coffre export\n\nRien.\n');
  return b;
}

describe('one engine, three ways to call it (F2.0-17)', () => {
  it('a search gives the same answer through the web, the CLI and MCP; an agent never sees a 🔒 note', async () => {
    const { config, env } = await brainWithSecret();
    const person = await invoke('notes.find', { query: 'export', limit: 30 }, { config, env, actor: 'person' });
    expect(person.hits.map((h) => h.path)).toContain('2 Produits/Coffre.md');

    const get = await web(asPerson(env), config);
    const viaWeb = await get('/api/find?q=export');
    expect(viaWeb.status).toBe(200);
    expect(shape(viaWeb.body as never)).toEqual(shape(person));

    const agent = await invoke('notes.find', { query: 'export' }, { config, env, actor: 'agent' });
    expect(agent.hits.map((h) => h.path)).not.toContain('2 Produits/Coffre.md');
    const handle = mcpHandler({ env });
    const viaMcp = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'notes_find', arguments: { query: 'export' } } });
    expect(shape((viaMcp!.result as { structuredContent: never }).structuredContent)).toEqual(shape(agent));

    const viaClaude = await cli(['find', 'export', '--json'], asClaude(env));
    expect(viaClaude.code, viaClaude.stderr).toBe(0);
    expect(shape(JSON.parse(viaClaude.stdout))).toEqual(shape(agent));
    const viaTerminal = await cli(['find', 'export', '--limit', '30', '--json'], asPerson(env));
    expect(shape(JSON.parse(viaTerminal.stdout)).hits.map(([p]) => p)).toContain('2 Produits/Coffre.md');
  });

  it('an invalid input is refused the same way everywhere', async () => {
    const { config, env } = await demoBrain();
    const get = await web(asPerson(env), config);
    const viaWeb = await get(`/api/find?q=${'x'.repeat(301)}`);
    expect(viaWeb.status).toBe(400);
    expect(viaWeb.body).toMatchObject({ error: 'E_INVALID', key: 'invalidInput' });
    const handle = mcpHandler({ env });
    const viaMcp = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'notes_find', arguments: { query: 'x'.repeat(301) } } });
    expect(viaMcp!.result).toMatchObject({ isError: true });
    expect(JSON.stringify(viaMcp!.result)).toContain('invalidInput');
    const viaCli = await cli(['find', 'x'.repeat(301), '--json'], asPerson(env));
    expect(viaCli.code).not.toBe(0);
    expect(JSON.parse(viaCli.stdout).error).toMatchObject({ code: 'E_INVALID', key: 'invalidInput' });
  });
});

describe('okb mcp, the assistants’ door', () => {
  it('answers the handshake, lists the operations of the modules in use, and hides a module turned off', async () => {
    const { env } = await demoBrain();
    const handle = mcpHandler({ env });
    const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(init!.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'okb' } });
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const tools = ((await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))!.result as { tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['notes_find', 'notes_read', 'kb_status', 'suggestions_list', 'suggestions_add', 'repos_list']));
    expect(tools.find((t) => t.name === 'notes_find')!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'suggestions_add')!.annotations.readOnlyHint).toBe(false);
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
    await setModule('dev', false, env);
    const after = ((await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(after).not.toContain('repos_list');
    expect(await handle({ jsonrpc: '2.0', id: 4, method: 'nope' })).toMatchObject({ error: { code: -32601 } });
    expect(await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'apply', arguments: {} } })).toMatchObject({ error: { code: -32602 } });
  });

  it('runs over stdio, one message per line', async () => {
    const { env } = await demoBrain();
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kb_status', arguments: { light: true } } },
    ].map((m) => JSON.stringify(m)).join('\n');
    const run = await cli(['mcp'], asPerson(env), `${lines}\n`);
    expect(run.code, run.stderr).toBe(0);
    const replies = run.stdout.trim().split('\n').map((l) => JSON.parse(l) as { id: number; result: { structuredContent?: { notes: number } } });
    expect(replies.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(replies.find((r) => r.id === 2)!.result.structuredContent!.notes).toBeGreaterThan(0);
  });
});
