import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sendToAi } from '../src/ai/gate.js';
import { aiSpentToday } from '../src/ai/usage.js';
import { statePaths } from '../src/state/paths.js';
import { composeAnswer, passagesFor } from '../src/find/answer.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeRootConfig } from '../src/kb/registry.js';
import { estimateTranslation, translateNote } from '../src/translate/translate.js';
import { asBundlePath } from '../src/util/paths.js';
import { demoBrain } from './helpers/brain.js';

const AWS = 'AKIA' + 'Q3J7Z2M5K8W1R4T6';

type Seen = { system: string; prompt: string };
const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise((done) => s.close(done)); });

/** A local stand-in for the AI service: it keeps what it receives and answers as told. */
async function aiService(answer: (body: { system: string; messages: { content: string }[] }) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += String(c); });
    req.on('end', () => {
      const body = JSON.parse(raw) as { system: string; messages: { content: string }[] };
      seen.push({ system: body.system, prompt: body.messages[0]?.content ?? '' });
      const r = answer(body);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  return { seen, url: `http://127.0.0.1:${port}` };
}

const ok = (text: string) => ({ body: { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 30 } } });
/** Echo each <<<n>>> block back, as a translation would. */
const echo = (b: { messages: { content: string }[] }) => ok(b.messages[0]!.content.replace(/^(?!<<<)(.+)$/gm, 'EN $1'));

async function brainWithApi(answer: Parameters<typeof aiService>[0]) {
  const b = await demoBrain();
  const service = await aiService(answer);
  const { OKB_AI: _fake, ...rest } = b.env;
  const env = { ...rest, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: service.url };
  await writeRootConfig((root) => ({ ...root, ai: { provider: 'api' } }), env);
  return { ...b, env, service };
}

async function note(kb: string, path: string, front: string[], body: string) {
  await mkdir(resolve(kb, path, '..'), { recursive: true });
  await writeFile(resolve(kb, path), ['---', ...front, '---', '', body, ''].join('\n'));
  return asBundlePath(path);
}

describe('the one way out to the AI', () => {
  it('refuses a message that holds a secret anywhere, before anything leaves', async () => {
    const { config, env, service } = await brainWithApi(() => ok('fine'));
    await expect(sendToAi(config, { purpose: 'ask', system: `Use the key ${AWS} to log in.`, prompt: 'Hello', size: 'small', maxTokens: 50 }, env))
      .rejects.toMatchObject({ code: 'E_SECRET' });
    await expect(sendToAi(config, { purpose: 'ask', system: 'Answer.', prompt: `Question: what is ${AWS}?`, size: 'small', maxTokens: 50 }, env))
      .rejects.toMatchObject({ code: 'E_SECRET' });
    expect(service.seen).toHaveLength(0);
    expect(await aiSpentToday(config)).toBe(0);
  }, 60_000);

  it('sends a 🔒 note only with the person’s yes for that very content', async () => {
    const { config, env, service } = await brainWithApi(() => ok('fine'));
    const out = { purpose: 'translate' as const, system: 'Translate.', prompt: 'Bonjour', size: 'small' as const, maxTokens: 50, notes: [{ path: 'a.md', secret: true, hash: 'h-now' }] };
    await expect(sendToAi(config, out, env)).rejects.toMatchObject({ code: 'E_SECRET' });
    await expect(sendToAi(config, { ...out, consent: [{ path: 'a.md', hash: 'h-before' }] }, env)).rejects.toMatchObject({ code: 'E_SECRET' });
    await expect(sendToAi(config, { ...out, consent: [{ path: 'b.md', hash: 'h-now' }] }, env)).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(service.seen).toHaveLength(0);
    const r = await sendToAi(config, { ...out, consent: [{ path: 'a.md', hash: 'h-now' }] }, env);
    expect(r.text).toBe('fine');
    expect(service.seen).toHaveLength(1);
  }, 60_000);

  it('checks the day’s budget before the call', async () => {
    const { config, env, service } = await brainWithApi(() => ok('fine'));
    await writeRootConfig((root) => ({ ...root, budget: { daily: 10 } }), env);
    await expect(sendToAi(config, { purpose: 'ask', system: 'Answer.', prompt: 'A long enough question to cost more than ten tokens, surely.', size: 'small', maxTokens: 50 }, env))
      .rejects.toMatchObject({ code: 'E_INVALID' });
    expect(service.seen).toHaveLength(0);
  }, 60_000);

  it('counts each call with its purpose, and what a cut answer used', async () => {
    let cut = false;
    const { config, env } = await brainWithApi(() => (cut
      ? { body: { content: [{ type: 'text', text: 'half an ans' }], stop_reason: 'max_tokens', usage: { input_tokens: 300, output_tokens: 50 } } }
      : ok('fine')));
    await sendToAi(config, { purpose: 'ask', system: 'Answer.', prompt: 'Hello', size: 'small', maxTokens: 50 }, env);
    expect(await aiSpentToday(config)).toBe(150);
    cut = true;
    await expect(sendToAi(config, { purpose: 'ask', system: 'Answer.', prompt: 'Hello', size: 'small', maxTokens: 50 }, env)).rejects.toMatchObject({ code: 'E_IO' });
    expect(await aiSpentToday(config)).toBe(500);
    const lines = (await readFile(resolve(statePaths(config).root, 'ai', 'usage.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { purpose: string; tokens: number });
    expect(lines.map((l) => [l.purpose, l.tokens])).toEqual([['ask', 150], ['ask', 350]]);
  }, 60_000);
});

describe('what the features send to the AI', () => {
  it('translating: the terms of a 🔒 card stay home, the others go', async () => {
    const { config, env, kb, service } = await brainWithApi(echo);
    await note(kb, '3 Boîte à outils/Concepts/Faucon.md', ['type: Concept', 'title: Projet Faucon', 'description: Le nom de code du rachat.', 'x_okb:', '  confidentiality: secret', '  aliases:', '    - Opération Faucon'], '# Projet Faucon\n\nLe rachat en cours.');
    await note(kb, '3 Boîte à outils/Concepts/Idempotence.md', ['type: Concept', 'title: Idempotence', 'description: Rejouer sans effet de plus.'], '# Idempotence\n\nRejouer une opération ne change rien de plus.');
    const path = await note(kb, '3 Boîte à outils/Méthodes/Livrer.md', ['type: Guide', 'title: Livrer', 'description: Livrer sans casse.'], '# Livrer\n\n## En bref\n\nOn livre le mardi.');
    await translateNote(config, path, 'en', 'brief', env);
    expect(service.seen).toHaveLength(1);
    const sent = `${service.seen[0]!.system}\n${service.seen[0]!.prompt}`;
    expect(sent).toContain('Idempotence');
    expect(sent).not.toContain('Faucon');
  }, 60_000);

  it('translating a 🔒 note: the yes holds for the content the person saw, not a later one', async () => {
    const { config, env, kb, service } = await brainWithApi(echo);
    const path = await note(kb, '2 Produits/Secret.md', ['type: Guide', 'title: Plan', 'description: Le plan.', 'x_okb:', '  confidentiality: secret'], '# Plan\n\n## En bref\n\nOn rachète.');
    await expect(estimateTranslation(config, path, 'en', 'brief', env)).rejects.toMatchObject({ code: 'E_SECRET' });
    await expect(translateNote(config, path, 'en', 'brief', env, { confirmSecret: 'not-this-version' })).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(service.seen).toHaveLength(0);
    const seenHash = (await estimateTranslation(config, path, 'en', 'brief', env, { confirmSecret: true })).hash;
    expect(typeof seenHash).toBe('string');
    const r = await translateNote(config, path, 'en', 'brief', env, { confirmSecret: seenHash });
    expect(r.translated).toBeGreaterThan(0);
  }, 60_000);

  it('asking: a passage whose title looks like a secret is left out, and a question holding one is refused', async () => {
    const { config, env, kb, service } = await brainWithApi(() => ok('On livre le mardi [1].'));
    await note(kb, '3 Boîte à outils/Méthodes/Livrer.md', ['type: Guide', 'title: Livrer le mardi', 'description: Le jour des livraisons.'], '# Livrer le mardi\n\nOn livre le mardi après les tests.');
    await note(kb, '3 Boîte à outils/Méthodes/Clé.md', ['type: Guide', 'title: ' + `Accès ${AWS}`, 'description: Livrer avec la clé.'], '# Accès\n\nOn livre le mardi avec cette clé.');
    const { passages } = passagesFor(config, await loadBundleFor(config), 'quand livre-t-on le mardi');
    expect(passages.some((p) => p.title.includes('AKIA'))).toBe(true);
    const r = await composeAnswer(config, 'quand livre-t-on le mardi', passages, env);
    expect(r.answer).toContain('mardi');
    expect(service.seen).toHaveLength(1);
    expect(`${service.seen[0]!.system}\n${service.seen[0]!.prompt}`).not.toContain(AWS);
    await expect(composeAnswer(config, `et la clé ${AWS} ?`, passages, env)).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(service.seen).toHaveLength(1);
  }, 60_000);
});
