import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';
import { closeDbs } from '../src/state/db.js';
import { askAssistant, getConversation, listConversations, performAction, validateAnswer } from '../src/assistant/assistant.js';
import { claudeArguments, parseClaudeResult, runProcess } from '../src/assistant/bridge.js';
import { mcpHandler } from '../src/engine/mcp.js';
import { EN_SHARE } from '../src/i18n/share.en.js';
import { FR_SHARE } from '../src/i18n/share.fr.js';
import { OkbError } from '../src/util/errors.js';

const boxes: Sandbox[] = [];
afterEach(async () => { closeDbs(); await Promise.all(boxes.splice(0).map((b) => b.cleanup())); });
async function fixture() {
  const box = await makeSandbox({ profileId: 'assistant', language: 'fr' }); boxes.push(box);
  await writeFixture(resolve(box.vault, 'cache.md'), '---\ntype: concept\ntitle: Cache solaire\ndescription: Invalidation solaire.\nstatus: stable\n---\n\nUn cache solaire expire après dix minutes.\n');
  await writeFixture(resolve(box.vault, 'locked.md'), '---\ntype: concept\ntitle: Cache solaire secret\ndescription: Cache secret.\nx_okb:\n  confidentiality: secret\n---\n\nNE-JAMAIS-ENVOYER.\n');
  return { box, config: await box.config() };
}

describe('Assistant local (F2.3)', () => {
  it('uses the CLI with the person’s configuration, no API fallback or shell/editor tools', () => {
    const args = claudeArguments({ schema: {}, mcp: '{}' });
    expect(args).toContain('-p'); expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).not.toContain('--bare'); expect(args).not.toContain('--setting-sources');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
  it('refuses invented evidence and quotes that do not occur in the provided passage', () => {
    const sources = [{ id: 'S1', title: 'Cache', path: 'cache.md', kind: 'note' as const, quote: 'expire après dix minutes', hash: 'hash' }];
    expect(() => validateAnswer({ statements: [{ text: 'Cache', kind: 'notes', evidence: [{ source: 'S2', quote: 'expire' }] }], actions: [] }, sources)).toThrow();
    expect(() => validateAnswer({ statements: [{ text: 'Cache', kind: 'notes', evidence: [{ source: 'S1', quote: 'après vingt minutes' }] }], actions: [] }, sources)).toThrow();
    expect(() => validateAnswer({ statements: [{ text: 'Cache', kind: 'notes', evidence: [] }], actions: [] }, sources)).toThrow();
    expect(validateAnswer({ statements: [{ text: 'Je ne sais pas.', kind: 'unknown', evidence: [] }], actions: [] }, [])).toBeTruthy();
  });
  it('retrieves unlocked sources, keeps sources and usage per conversation and makes no action automatically', async () => {
    const { box, config } = await fixture(); let outgoing = '';
    const result = await askAssistant(config, box.env, { question: 'cache solaire' }, { run: async (request) => {
      outgoing = request.prompt;
      const source = request.sources[0]!;
      return { answer: { statements: [{ text: 'Dix minutes.', kind: 'notes', evidence: [{ source: source.id, quote: 'expire après dix minutes' }] }], actions: [{ kind: 'action', text: 'Vérifier le cache' }] }, usage: { input: 125, output: 45 }, provider: 'claude-code' };
    } });
    expect(outgoing).toContain('expire après dix minutes'); expect(outgoing).not.toContain('NE-JAMAIS-ENVOYER');
    expect(result.conversation.messages).toHaveLength(2);
    expect(result.conversation.usage).toEqual({ input: 125, output: 45 });
    expect(listConversations(config).conversations).toHaveLength(1);
    expect(getConversation(config, result.conversation.id).conversation.messages[1]!.answer!.sources[0]!.path).toBe('cache.md');
    const { openDb } = await import('../src/state/db.js');
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) AS n FROM actions')!.n).toBe(0);
    const message = result.conversation.messages[1]!;
    await performAction(config, box.env, { conversation: result.conversation.id, message: message.id, index: 0 });
    await performAction(config, box.env, { conversation: result.conversation.id, message: message.id, index: 0 });
    expect(openDb(config).get<{ n: number }>('SELECT COUNT(*) AS n FROM actions')!.n).toBe(1);
  });
  it('checks secrets before running or storing a question', async () => {
    const { box, config } = await fixture(); let called = false;
    await expect(askAssistant(config, box.env, { question: 'password=SuperSecret123!' }, { run: async () => { called = true; throw new Error('must not run'); } })).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(called).toBe(false); expect(listConversations(config).conversations).toHaveLength(0);
  });
  it('does not invent zero tokens when the local tool reports no usage', () => {
    const parsed = parseClaudeResult(JSON.stringify({ structured_output: { statements: [{ text: 'Inconnu', kind: 'unknown', evidence: [] }], actions: [] } }));
    expect(parsed.usage).toEqual({ input: null, output: null });
    expect(() => parseClaudeResult(JSON.stringify({ is_error: true, result: 'limit reached' }))).toThrow();
    // An expired sign-in is told as such: the person can fix it, and nothing else of the agent's words is repeated.
    const signedOut = (() => { try { parseClaudeResult(JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed', usage: { input_tokens: 0, output_tokens: 0 } })); return null; } catch (e) { return e as OkbError; } })();
    expect(signedOut).toMatchObject({ code: 'E_CONFIG', key: 'agentNotSignedIn' });
    expect(signedOut!.message).not.toMatch(/OAuth/);
    expect((signedOut!.detail.usage as { provider: string }).provider).toBe('claude-code');
    const limit = (() => { try { parseClaudeResult(JSON.stringify({ is_error: true, result: 'limit reached' })); return null; } catch (e) { return e as OkbError; } })();
    expect(limit).toMatchObject({ code: 'E_IO' });
    expect(limit!.key).not.toBe('agentNotSignedIn');
    for (const words of [FR_SHARE, EN_SHARE] as Record<string, string>[]) for (const part of ['title', 'why', 'fix']) expect(words[`err.agentNotSignedIn.${part}`]).toBeTruthy();
  });
  it('bounds subprocess output and stops a hanging process without invoking a shell', async () => {
    await expect(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000))'], { input: '', cwd: process.cwd(), env: process.env, maxBytes: 100 })).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { input: '', cwd: process.cwd(), env: process.env, timeoutMs: 30 })).rejects.toMatchObject({ code: 'E_IO' });
  });
  it('the in-app MCP policy exposes only selected reading tools and refuses state writes', async () => {
    const { box } = await fixture();
    const handle = mcpHandler({ env: { ...box.env, OKB_MCP_POLICY: 'assistant' } });
    const list = await handle({ id: 1, method: 'tools/list' });
    const tools = (list?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain('notes_read');
    expect(tools.map((t) => t.name)).not.toContain('actions_add');
    const call = await handle({ id: 2, method: 'tools/call', params: { name: 'actions_add', arguments: { text: 'Interdit' } } });
    expect(call?.error?.code).toBe(-32602);
  });
});
