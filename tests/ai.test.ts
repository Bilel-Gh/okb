import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeArgs, complete, parseClaudeJson, pickProvider } from '../src/ai/provider.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function home(config = '') {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-ai-')));
  made.push(dir);
  await mkdir(resolve(dir, '.okb'), { recursive: true });
  if (config) await writeFile(resolve(dir, '.okb', 'config.yaml'), config);
  // A PATH with node only: no `claude` on it.
  const env: NodeJS.ProcessEnv = { HOME: dir, OKB_HOME: resolve(dir, '.okb'), PATH: '/nonexistent' };
  return { dir, env };
}

describe('the AI provider', () => {
  it('uses the fake provider for tests: the input comes back, marked, with token counts', async () => {
    const { env } = await home();
    const fake = { ...env, OKB_AI: 'fake' };
    expect(await pickProvider(fake)).toEqual({ id: 'fake' });
    const r = await complete({ system: 'Translate.', prompt: 'Bonjour\n<<<1>>>\nle monde', size: 'small', maxTokens: 100 }, fake);
    expect(r.provider).toBe('fake');
    expect(r.text).toBe('[fake] Bonjour\n<<<1>>>\n[fake] le monde');
    expect(r.tokens.input).toBeGreaterThan(0);
    expect(r.tokens.output).toBeGreaterThan(0);
  });

  it('says plainly when there is no provider: no Claude Code, no key', async () => {
    const { env } = await home();
    expect(await pickProvider(env)).toBeNull();
    await expect(complete({ system: '', prompt: 'x', size: 'small', maxTokens: 10 }, env)).rejects.toMatchObject({ key: 'aiUnavailable' });
  });

  it('uses the API key when there is no Claude Code', async () => {
    const { env } = await home();
    expect(await pickProvider({ ...env, ANTHROPIC_API_KEY: 'test-key' })).toEqual({ id: 'api' });
  });

  it('is off when the person turned it off, key or not', async () => {
    const { env } = await home('ai:\n  provider: "off"\n');
    expect(await pickProvider({ ...env, ANTHROPIC_API_KEY: 'test-key' })).toBeNull();
  });

  it('runs Claude Code without tools, settings, plugins or a saved session, on a small model', () => {
    const args = claudeArgs('small', 'Translate.');
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe('-p');
    expect(at('--model')).toBe('haiku');
    expect(at('--tools')).toBe('');
    expect(at('--setting-sources')).toBe('');
    expect(args).toContain('--no-session-persistence');
    expect(at('--output-format')).toBe('json');
    expect(at('--system-prompt')).toBe('Translate.');
    expect(claudeArgs('medium', '')[claudeArgs('medium', '').indexOf('--model') + 1]).toBe('sonnet');
  });

  it("reads Claude Code's JSON answer and its token counts", () => {
    const out = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hello world', usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 4 } });
    expect(parseClaudeJson(out)).toEqual({ text: 'Hello world', tokens: { input: 15, output: 4 } });
    expect(() => parseClaudeJson(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }))).toThrow(/Not logged in/);
  });
});

describe('hooks during an AI call made by OKB', () => {
  let sandboxEnv: NodeJS.ProcessEnv = {};
  const hook = (file: string, input: unknown, headless: boolean) => spawnSync(process.execPath, [resolve(TEST_ROOT, '..', file)], {
    input: JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ...sandboxEnv, ...(headless ? { OKB_HEADLESS: '1' } : {}) },
  });
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'ok fin de session', cwd: tmpdir(), session_id: 'x' };

  it('the context hooks stay silent', async () => {
    const { makeSandbox } = await import('./helpers/sandbox.js');
    const s = await makeSandbox({ profileId: 'alpha' });
    made.push(s.dir);
    sandboxEnv = s.env;
    // Without the flag, the intent hook offers to end the session (OKB as in 2.4)…
    const { writeSetting } = await import('../src/settings/settings.js');
    await writeSetting('alpha', 'presence', 'assist', s.env);
    expect(hook('plugin/hooks/intent.mjs', prompt, false).stdout).toContain('additionalContext');
    // …with it, every context hook says nothing.
    for (const file of ['plugin/hooks/session-focus.mjs', 'plugin/hooks/intent.mjs', 'plugin/hooks/stop.mjs', 'plugin/hooks/consent.mjs', 'plugins/okb-dev/hooks/session-scope.mjs', 'plugins/okb-dev/hooks/bash.mjs', 'plugins/okb-dev/hooks/file.mjs']) {
      const r = hook(file, prompt, true);
      expect(r.status, file).toBe(0);
      expect(r.stdout, file).toBe('');
    }
  });

  it('the guards keep guarding', () => {
    const r = hook('plugin/hooks/guard-approval.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'okb review --approve p-1234' } }, true);
    expect(r.stdout + r.stderr).toMatch(/deny|refus|human|personne/i);
  });
});

describe('Claude Code that stops early (review M9)', () => {
  it('a claude that exits before reading the prompt is a clean error, not a crash', async () => {
    const { chmod } = await import('node:fs/promises');
    const { env, dir } = await home('ai:\n  provider: claude-code\n');
    const bin = resolve(dir, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(resolve(bin, 'claude'), '#!/bin/sh\nexit 3\n');
    await chmod(resolve(bin, 'claude'), 0o755);
    const big = 'x'.repeat(4_000_000);
    await expect(complete({ system: 's', prompt: big, size: 'small', maxTokens: 10 }, { ...env, PATH: `${bin}:/usr/bin:/bin` })).rejects.toMatchObject({ key: 'aiFailed' });
  }, 30_000);
});

describe('Claude Code signed out (review M5)', () => {
  async function setup(config: string) {
    const { chmod } = await import('node:fs/promises');
    const { createServer } = await import('node:http');
    const { env, dir } = await home(config);
    const bin = resolve(dir, 'bin');
    await mkdir(bin, { recursive: true });
    // Claude Code installed, but its session expired: it answers with an error.
    await writeFile(resolve(bin, 'claude'), '#!/bin/sh\ncat >/dev/null\necho \'{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}\'\n');
    await chmod(resolve(bin, 'claude'), 0o755);
    const calls: string[] = [];
    const server = createServer((req, res) => { calls.push(req.url ?? ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ content: [{ type: 'text', text: 'from the API' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } })); });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const port = (server.address() as { port: number }).port;
    made.push(dir);
    return { server, calls, env: { ...env, PATH: `${bin}:/usr/bin:/bin`, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` } };
  }

  it('on « auto », falls back to the API key', async () => {
    const { server, calls, env } = await setup('');
    try {
      const r = await complete({ system: 's', prompt: 'p', size: 'small', maxTokens: 10 }, env);
      expect(r).toMatchObject({ text: 'from the API', provider: 'api' });
      expect(calls).toHaveLength(1);
    } finally { server.close(); }
  }, 30_000);

  it('when Claude Code was chosen, says so instead of using the key', async () => {
    const { server, calls, env } = await setup('ai:\n  provider: claude-code\n');
    try {
      await expect(complete({ system: 's', prompt: 'p', size: 'small', maxTokens: 10 }, env)).rejects.toMatchObject({ key: 'aiFailed' });
      expect(calls).toHaveLength(0);
    } finally { server.close(); }
  }, 30_000);
});
