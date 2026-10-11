import { resolve } from 'node:path';
import { chmod, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';
import { closeDbs, openDb } from '../src/state/db.js';
import { askAssistant, cancelAssistant, createConversation, getConversation, listConversations, shutdownAssistant } from '../src/assistant/assistant.js';
import { OkbError } from '../src/util/errors.js';
import { completeLocalText, runLocalAgent, runProcess, supportedClaudeVersion, type BridgeRequest, type BridgeResult } from '../src/assistant/bridge.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await shutdownAssistant(); closeDbs(); await Promise.all(boxes.splice(0).map((b) => b.cleanup())); });
const raw = '---\ntype: concept\ntitle: Cache solaire\ndescription: Cache solaire.\nstatus: stable\n---\n\nUn cache solaire expire après dix minutes.\n';
async function fixture() {
  const box = await makeSandbox({ profileId: 'assistant-audit', language: 'fr' }); boxes.push(box);
  await writeFixture(resolve(box.vault, 'cache.md'), raw);
  return { box, config: await box.config() };
}
const good = (request: BridgeRequest): BridgeResult => ({ answer: { statements: [{ text: 'Dix minutes.', kind: 'notes', evidence: [{ source: request.sources[0]!.id, quote: 'expire après dix minutes' }] }], actions: [] }, usage: { input: 125, output: 45 }, provider: 'fixture-agent' });

describe('Assistant: cancellation, current confidentiality and consumed work', () => {
  it('separates installation detection from compatibility of unattended permission prompts', () => {
    expect(supportedClaudeVersion('2.1.258 (Claude Code)')).toBe(false);
    expect(supportedClaudeVersion('2.1.259 (Claude Code)')).toBe(true);
    expect(supportedClaudeVersion('2.2.0')).toBe(true);
    expect(supportedClaudeVersion('unknown')).toBe(false);
  });
  it('requires a successful process exit even when a failing command prints output', async () => {
    await expect(runProcess(process.execPath, ['-e', 'process.stdout.write("not a success"); process.exit(1)'], { input: '', cwd: process.cwd(), env: process.env })).rejects.toMatchObject({ code: 'E_IO' });
  });
  it('waits for termination of a process ignoring TERM before resolving cancellation', async () => {
    const controller = new AbortController(); const started = Date.now();
    const pending = runProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { input: '', cwd: process.cwd(), env: process.env, signal: controller.signal });
    await new Promise<void>((r) => setTimeout(r, 150)); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'E_IO' });
    if (process.platform !== 'win32') expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  });
  it('adapts a bounded text response without enabling tools or pretending unknown usage is zero', async () => {
    const { box, config } = await fixture(); let sent: BridgeRequest | undefined;
    const result = await completeLocalText(config, box.env, { system: 'Translate the supplied text.', prompt: 'A cache lasts ten minutes.', size: 'small', maxTokens: 100 }, 'claude-code', { run: async (request) => {
      sent = request; return { answer: { text: 'Un cache dure dix minutes.' }, usage: { input: null, output: null }, provider: 'claude-code' };
    } });
    expect(sent!.tools).toBe('none'); expect(sent!.sources).toEqual([]);
    expect(result.text).toBe('Un cache dure dix minutes.'); expect(result.usedTokens).toBeNull(); expect(result.usage).toEqual({ input: null, output: null });
    expect(result.estimated).toBe(true); expect(result.tokens.input).toBeGreaterThan(0); expect(result.tokens.output).toBeGreaterThan(0);
  });
  it.skipIf(process.platform === 'win32')('rejects an incompatible CLI before sending any prompt', async () => {
    const { box, config } = await fixture(); const bin = resolve(box.dir, 'bin'); const marker = resolve(box.dir, 'sent');
    const command = resolve(bin, 'claude');
    await writeFixture(command, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.258 (Claude Code)')}else{require('node:fs').writeFileSync(${JSON.stringify(marker)},'sent')}\n`);
    await chmod(command, 0o700);
    await expect(runLocalAgent(config, { ...box.env, PATH: bin }, { system: 'Answer.', prompt: 'Cache?', sources: [], schema: {} }, 'claude-code')).rejects.toMatchObject({ code: 'E_CONFIG' });
    expect(await readFile(marker, 'utf8').catch(() => null)).toBeNull();
  });
  it.skipIf(process.platform === 'win32')('stops a generic local text call at shutdown, beyond active conversations', async () => {
    const { box, config } = await fixture(); const bin = resolve(box.dir, 'bin'); const marker = resolve(box.dir, 'started');
    const command = resolve(bin, 'claude');
    await writeFixture(command, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.259 (Claude Code)')}else{process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)}\n`);
    await chmod(command, 0o700);
    const pending = completeLocalText(config, { ...box.env, PATH: bin }, { system: 'Translate.', prompt: 'Bonjour.', size: 'small', maxTokens: 50 }, 'claude-code');
    // Attach rejection immediately: shutdown intentionally rejects the pending call.
    const outcome = pending.then(() => null, (error: unknown) => error);
    for (let n = 0; n < 100 && !await readFile(marker, 'utf8').catch(() => null); n++) await new Promise<void>((done) => setTimeout(done, 10));
    expect(await readFile(marker, 'utf8')).toBe('ready');
    await shutdownAssistant();
    expect(await outcome).toMatchObject({ code: 'E_IO' });
  });
  it('creates an empty conversation before its first question can be cancelled', async () => {
    const { box, config } = await fixture();
    const { conversation } = createConversation(config);
    expect(conversation.messages).toEqual([]);
    let entered!: () => void; const started = new Promise<void>((r) => { entered = r; });
    const pending = askAssistant(config, box.env, { conversation: conversation.id, question: 'cache solaire' }, { run: async (request) => {
      entered();
      await new Promise<void>((r) => request.signal!.addEventListener('abort', () => r(), { once: true }));
      // A transport can finish after receiving cancellation. That answer must never be saved.
      return good(request);
    } });
    await started; expect(cancelAssistant(config, conversation.id)).toEqual({ cancelled: true });
    await expect(pending).rejects.toMatchObject({ code: 'E_IO' });
    const saved = getConversation(config, conversation.id).conversation;
    expect(saved.messages).toEqual([]);
    expect(saved.usage).toEqual({ input: 125, output: 45 });
    expect(saved.usageSummary).toEqual({ calls: 1, failed: 1, total: 170, knownTotal: 170 });
  });
  it.each(['lock', 'change'] as const)('rejects a source that is %s during the model call', async (change) => {
    const { box, config } = await fixture(); const { conversation } = createConversation(config);
    await expect(askAssistant(config, box.env, { conversation: conversation.id, question: 'cache solaire' }, { run: async (request) => {
      await writeFixture(resolve(box.vault, 'cache.md'), change === 'lock' ? raw.replace('status: stable', 'status: stable\nx_okb:\n  confidentiality: secret') : raw.replace('dix', 'vingt'));
      return good(request);
    } })).rejects.toMatchObject({ code: change === 'lock' ? 'E_SECRET' : 'E_STALE' });
    const saved = getConversation(config, conversation.id).conversation;
    expect(saved.messages).toEqual([]); expect(saved.usageSummary.failed).toBe(1);
  });
  it('retains unusable answer consumption and then adds the next usable response', async () => {
    const { box, config } = await fixture(); const { conversation } = createConversation(config);
    await expect(askAssistant(config, box.env, { conversation: conversation.id, question: 'cache solaire' }, { run: async () => ({ answer: { statements: [], actions: [] }, usage: { input: 12, output: 8 }, provider: 'fixture-agent' }) })).rejects.toMatchObject({ code: 'E_IO' });
    const result = await askAssistant(config, box.env, { conversation: conversation.id, question: 'cache solaire' }, { run: async (request) => good(request) });
    expect(result.conversation.usage).toEqual({ input: 137, output: 53 });
    expect(result.conversation.usageSummary).toEqual({ calls: 2, failed: 1, total: 190, knownTotal: 190 });
  });
  it('reports unknown input/output for a failed call with only a known total', async () => {
    const { box, config } = await fixture();
    await expect(askAssistant(config, box.env, { question: 'cache solaire' }, { run: async () => { throw new OkbError('E_IO', 'fixture limit', { detail: { usage: { tokens: 19, provider: 'fixture-agent' } } }); } })).rejects.toMatchObject({ code: 'E_IO' });
    const id = listConversations(config).conversations[0]!.id;
    const saved = getConversation(config, id).conversation;
    expect(saved.messages).toEqual([]); expect(saved.usage).toEqual({ input: null, output: null });
    expect(saved.usageSummary).toEqual({ calls: 1, failed: 1, total: 19, knownTotal: 19 });
  });
  it('bounds retained call details without losing cumulative usage', async () => {
    const { box, config } = await fixture(); const { conversation } = createConversation(config);
    for (let i = 0; i < 201; i++) {
      await expect(askAssistant(config, box.env, { conversation: conversation.id, question: 'cache solaire' }, { run: async () => ({ answer: null, usage: { input: 1, output: 1 }, provider: 'fixture-agent' }) })).rejects.toMatchObject({ code: 'E_IO' });
    }
    const saved = getConversation(config, conversation.id).conversation;
    expect(saved.usage).toEqual({ input: 201, output: 201 });
    expect(saved.usageSummary).toEqual({ calls: 201, failed: 201, total: 402, knownTotal: 402 });
    const ledger = JSON.parse(openDb(config).get<{ value: string }>('SELECT value FROM meta WHERE key = ?', `assistant.usage:${conversation.id}`)!.value);
    expect(ledger.calls).toHaveLength(200);
  }, 20_000);
});
