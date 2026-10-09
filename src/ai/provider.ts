import { spawn } from 'node:child_process';
import { which } from '../integrations/system.js';
import { readRootConfig } from '../kb/registry.js';
import { OkbError } from '../util/errors.js';
import { estimateTokens } from '../util/context-meter.js';

/**
 * How OKB itself asks a model (to translate a note, and more later), one
 * interface for two ways (decided on 8 Oct 2026, « prévoir les deux »):
 * - `claude-code`: the person's Claude Code, in the background, with their
 *   subscription and no key. No tools, no settings (so no plugin and no OKB
 *   hook), no saved session, a small model.
 * - `api`: the Anthropic API with the key in ANTHROPIC_API_KEY — needed for a
 *   team server. The key is never written by OKB.
 * Setting `ai.provider`: auto (Claude Code when installed, else the key) ·
 * claude-code · api · off. `OKB_AI=fake` answers without any model, for tests.
 */
export type ProviderId = 'claude-code' | 'api' | 'fake';
export type AiRequest = { readonly system: string; readonly prompt: string; readonly size: 'small' | 'medium'; readonly maxTokens: number };
export type AiResult = { readonly text: string; readonly tokens: { readonly input: number; readonly output: number }; readonly provider: ProviderId };

const CLAUDE_MODELS = { small: 'haiku', medium: 'sonnet' } as const;
const API_MODELS = { small: 'claude-haiku-5-5', medium: 'claude-sonnet-5-5' } as const;
const TIMEOUT_MS = 180_000;

export async function pickProvider(env: NodeJS.ProcessEnv = process.env): Promise<{ id: ProviderId } | null> {
  if (env.OKB_AI === 'fake') return { id: 'fake' };
  const root = await readRootConfig(env).catch(() => ({}));
  const choice = (root as { ai?: { provider?: unknown } }).ai?.provider ?? 'auto';
  if (choice === 'off') return null;
  const claude = choice === 'api' ? null : await which('claude', env);
  const key = choice === 'claude-code' ? '' : (env.ANTHROPIC_API_KEY ?? '').trim();
  if (choice === 'claude-code') return claude ? { id: 'claude-code' } : null;
  if (choice === 'api') return key ? { id: 'api' } : null;
  if (claude) return { id: 'claude-code' };
  if (key) return { id: 'api' };
  return null;
}

/** The arguments of a background Claude Code call: one answer, nothing else loaded. */
export function claudeArgs(size: AiRequest['size'], system: string): string[] {
  return ['-p', '--model', CLAUDE_MODELS[size], '--tools', '', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json', '--system-prompt', system];
}

/** Claude Code's `--output-format json` answer: the text and the tokens it used. */
export function parseClaudeJson(stdout: string): { text: string; tokens: { input: number; output: number } } {
  let data: { is_error?: boolean; result?: unknown; usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } };
  try { data = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '{}'); } catch { throw new OkbError('E_IO', `Claude Code gave an unreadable answer: ${stdout.slice(0, 200)}`, { key: 'aiFailed', params: { error: stdout.slice(0, 200) } }); }
  if (data.is_error || typeof data.result !== 'string' || !data.result.trim()) throw new OkbError('E_IO', `Claude Code: ${String(data.result || 'no answer')}`, { key: 'aiFailed', params: { error: String(data.result || 'no answer').slice(0, 200) } });
  const u = data.usage ?? {};
  return { text: data.result, tokens: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 } };
}

function runClaude(cli: string, req: AiRequest, env: NodeJS.ProcessEnv): Promise<AiResult> {
  return new Promise((done, fail) => {
    // OKB_HEADLESS: OKB's own hooks stay silent even if a plugin were loaded.
    const child = spawn(cli, claudeArgs(req.size, req.system), { env: { ...env, OKB_HEADLESS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); fail(new OkbError('E_IO', 'Claude Code took too long', { key: 'aiFailed', params: { error: 'timeout' } })); }, TIMEOUT_MS);
    child.stdout.on('data', (c) => { out += String(c); });
    child.stderr.on('data', (c) => { err += String(c); });
    child.on('error', (e) => { clearTimeout(timer); fail(new OkbError('E_IO', `Claude Code could not start: ${e.message}`, { key: 'aiFailed', params: { error: e.message } })); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const r = parseClaudeJson(out);
        done({ ...r, provider: 'claude-code' });
      } catch (e) {
        // A JSON answer explains itself (« Not logged in »…); otherwise stderr does.
        const answered = (() => { try { JSON.parse(out.trim().split('\n').filter(Boolean).pop() ?? ''); return true; } catch { return false; } })();
        fail(answered || code === 0 ? e : new OkbError('E_IO', `Claude Code: ${(err || out).slice(0, 300)}`, { key: 'aiFailed', params: { error: (err || out).trim().slice(0, 200) } }));
      }
    });
    // Claude Code may stop before reading everything (not signed in, killed): its exit says why, not a crash.
    child.stdin.on('error', () => { /* reported by 'close' */ });
    child.stdin.end(req.prompt);
  });
}

async function callApi(req: AiRequest, env: NodeJS.ProcessEnv): Promise<AiResult> {
  const base = (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const r = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': (env.ANTHROPIC_API_KEY ?? '').trim(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.OKB_AI_MODEL ?? API_MODELS[req.size], max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: Error) => { throw new OkbError('E_IO', `the AI service cannot be reached: ${e.message}`, { key: 'aiFailed', params: { error: e.message } }); });
  const body = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!r.ok) throw new OkbError('E_IO', `AI service: ${body.error?.message ?? r.status}`, { key: 'aiFailed', params: { error: String(body.error?.message ?? r.status) } });
  // A cut or refused answer is not an answer: say so rather than use half of it.
  if (body.stop_reason === 'max_tokens' || body.stop_reason === 'refusal') throw new OkbError('E_IO', `AI service stopped: ${body.stop_reason}`, { key: 'aiFailed', params: { error: body.stop_reason } });
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  if (!text.trim()) throw new OkbError('E_IO', 'AI service: empty answer', { key: 'aiFailed', params: { error: 'empty answer' } });
  return { text, tokens: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 }, provider: 'api' };
}

/**
 * An exam asked offline (src/knowledge/exam.ts): each question answered with its first excerpt, each answer
 * graded by the words it shares with its reference. Enough to try the exam page without a model.
 */
function fakeExam(req: AiRequest): string | null {
  const blocks = req.prompt.split(/^### /m).slice(1).map((b) => { const [id, ...rest] = b.split('\n'); return { id: id!.trim(), body: rest.join('\n') }; });
  if (req.system.includes('{"answers"')) {
    return JSON.stringify({ answers: blocks.map((b) => ({ id: b.id, answer: (/^\[\d+\][^:]*: (.*)$/m.exec(b.body)?.[1] ?? 'NOT IN THE NOTES').slice(0, 300) })) });
  }
  if (req.system.includes('{"grades"')) {
    const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 || /^\d+$/.test(w)));
    return JSON.stringify({ grades: blocks.map((b) => {
      const answer = words(/^Answer: (.*)$/m.exec(b.body)?.[1] ?? '');
      const reference = words(b.body.split(/^(?:Expected answer|A person’s answer|Code):$/m)[1] ?? '');
      const shared = [...reference].filter((w) => answer.has(w)).length / Math.max(1, Math.min(reference.size, 12));
      // A number the reference gives and the answer does not: not the same answer.
      const numbers = [...reference].filter((w) => /^\d+$/.test(w)).every((w) => answer.has(w));
      return { id: b.id, grade: !numbers ? 'wrong' : shared >= 0.5 ? 'right' : shared > 0 ? 'partial' : 'wrong', why: '[fake] shared words' };
    }) });
  }
  return null;
}

/** The echo provider: the input comes back, each line marked — for tests and offline demos. */
function fake(req: AiRequest): AiResult {
  const exam = fakeExam(req);
  if (exam) return { text: exam, tokens: { input: estimateTokens(req.system + req.prompt), output: estimateTokens(exam) }, provider: 'fake' };
  // The mark goes after Markdown's own line start (a heading, a list item), so the structure survives.
  const text = req.prompt.split('\n').map((l) => (!l.trim() || /^<<<\d+>>>$/.test(l.trim()) ? l : l.replace(/^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?)/, '$1[fake] '))).join('\n');
  return { text, tokens: { input: estimateTokens(req.system + req.prompt), output: estimateTokens(text) }, provider: 'fake' };
}

export async function complete(req: AiRequest, env: NodeJS.ProcessEnv = process.env): Promise<AiResult> {
  const provider = await pickProvider(env);
  if (!provider) throw new OkbError('E_CONFIG', 'no AI available: install Claude Code, or set ANTHROPIC_API_KEY, or turn ai.provider on', { key: 'aiUnavailable' });
  if (provider.id === 'fake') return fake(req);
  if (provider.id === 'api') return callApi(req, env);
  return runClaude((await which('claude', env))!, req, env);
}
