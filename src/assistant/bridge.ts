import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { estimateTokens } from '../util/context-meter.js';
import type { AiRequest } from '../ai/provider.js';

export type AgentId = 'claude-code' | 'codex';
export type AgentUsage = { input: number | null; output: number | null };
export type Source = { id: string; path: string; title: string; kind: 'note' | 'document' | 'shared' | 'work'; quote: string; hash: string; author?: string; drawer?: string; workKind?: string; ref?: string; passages?: { text: string; start: number; end: number; startLine: number; endLine: number }[] };
export type BridgeRequest = { system: string; prompt: string; sources: Source[]; schema: Record<string, unknown>; signal?: AbortSignal; tools?: 'okb-read' | 'none' };
export type BridgeResult = { answer: unknown; usage: AgentUsage; provider: string };
const localRequests = new Map<symbol, AbortController>();

/** No shell, bounded output, bounded lifetime, and cancellation of the process group we created. */
export async function runProcess(command: string, args: string[], options: { input: string; cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; acceptFailureOutput?: boolean }): Promise<string> {
  if (options.signal?.aborted) throw new OkbError('E_IO', 'local agent request cancelled');
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let size = 0; let failure: OkbError | null = null; let killTimer: ReturnType<typeof setTimeout> | undefined; const chunks: Buffer[] = [];
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
        killer.on('error', () => { child.kill(); });
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
        killTimer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already closed */ } }, 1000); killTimer.unref(); }
    };
    // Await close after killing our process group: shutdown must not abandon a detached agent.
    const fail = (error: OkbError) => { if (failure) return; failure = error; stop(); };
    const timer = setTimeout(() => fail(new OkbError('E_IO', 'local agent took too long; request stopped')), options.timeoutMs ?? 180_000);
    timer.unref();
    const cancel = () => fail(new OkbError('E_IO', 'local agent request cancelled'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = (bytes: Buffer, keep: boolean) => {
      size += bytes.length;
      if (size > (options.maxBytes ?? 4_000_000)) { fail(new OkbError('E_UNSUPPORTED', 'local agent output exceeded the limit')); return; }
      if (keep) chunks.push(bytes);
    };
    child.stdout.on('data', (b: Buffer) => collect(b, true));
    child.stderr.on('data', (b: Buffer) => collect(b, false));
    child.stdin.on('error', () => { /* exit handler reports the failure */ });
    child.on('error', () => fail(new OkbError('E_IO', 'local agent could not start; check its installation and connection')));
    child.on('close', (code) => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (killTimer) clearTimeout(killTimer);
      if (failure) { reject(failure); return; }
      const raw = Buffer.concat(chunks).toString('utf8');
      // Claude describes model failures on stdout; its parser retains usage without exposing stderr or credentials.
      if (code !== 0 && (!options.acceptFailureOutput || !raw.trim())) { reject(new OkbError('E_IO', 'local agent failed; check its connection or usage limit')); return; }
      done(raw);
    });
    child.stdin.end(options.input);
  });
}

export function claudeArguments(options: { schema: Record<string, unknown>; mcp: string; tools?: 'okb-read' | 'none' }): string[] {
  return ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(options.schema), '--tools', '', ...(options.tools === 'none' ? [] : ['--allowedTools', 'mcp__okb__notes_find,mcp__okb__notes_read,mcp__okb__documents_list,mcp__okb__shared_find,mcp__okb__shared_read,mcp__okb__shared_glossary']), '--permission-prompts', 'none', '--strict-mcp-config', '--mcp-config', options.mcp, '--no-session-persistence', '--no-chrome'];
}

const tomlValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${tomlValue(v)}`).join(',')}}`;
  return JSON.stringify(value);
};
export function codexArguments(options: { schemaFile: string; replyFile: string; mcp: Record<string, unknown>; tools?: 'okb-read' | 'none' }): string[] {
  // Replace the MCP map for this invocation only. Overriding nonexistent managed servers
  // individually creates entries without a transport and breaks Codex configuration.
  const servers = options.tools === 'none' ? {} : { okb: { ...options.mcp, enabled: true, required: true, enabled_tools: ['notes_find', 'notes_read', 'documents_list', 'shared_find', 'shared_read', 'shared_glossary'], default_tools_approval_mode: 'auto' } };
  return ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'multi_agent', '-c', 'web_search="disabled"', '-c', 'features.code_mode.enabled=false', '-c', `mcp_servers=${tomlValue(servers)}`, '--output-schema', options.schemaFile, '--output-last-message', options.replyFile, '-'];
}

const count = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
export function supportedClaudeVersion(version: string | null): boolean {
  const m = version ? /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$|[-+(])/.exec(version) : null;
  if (!m) return false;
  const [major, minor, patch] = m.slice(1).map(Number);
  return major! > 2 || major === 2 && (minor! > 1 || minor === 1 && patch! >= 259);
}
export function parseClaudeResult(raw: string): BridgeResult {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw.trim()) as Record<string, unknown>; } catch { throw new OkbError('E_IO', 'local agent returned no usable response'); }
  const usage = (value.usage ?? {}) as Record<string, unknown>;
  const input = count(usage.input_tokens);
  const cached = (count(usage.cache_read_input_tokens) ?? 0) + (count(usage.cache_creation_input_tokens) ?? 0);
  const tokens: AgentUsage = { input: input === null ? null : input + cached, output: count(usage.output_tokens) };
  if (value.is_error || value.type === 'error') {
    const detail = { usage: { ...tokens, tokens: tokens.input !== null && tokens.output !== null ? tokens.input + tokens.output : undefined, provider: 'claude-code' } };
    // The agent's own words are not repeated; actionable connection and usage failures are named.
    if (typeof value.result === 'string' && /authenticat|not logged in|please (?:run )?\/?login|oauth|invalid api key/i.test(value.result)) {
      throw new OkbError('E_CONFIG', 'the local agent is not signed in; run it in a terminal and sign in', { key: 'agentNotSignedIn', detail });
    }
    if (typeof value.result === 'string' && /quota|rate.?limit|usage.?limit|limit reached|out of credits|insufficient credits|credit balance/i.test(value.result)) throw new OkbError('E_IO', 'the local agent reported a usage limit; continue with local search', { key: 'agentQuotaExceeded', detail });
    throw new OkbError('E_IO', 'local agent failed; check its connection or usage limit', { detail });
  }
  let answer = value.structured_output;
  if (!answer && typeof value.result === 'string') { try { answer = JSON.parse(value.result); } catch { /* validated by the caller */ } }
  return { answer, usage: tokens, provider: 'claude-code' };
}

/** The configuration is the person's. We neither extract OAuth credentials nor provide an API key. */
export async function agentStatus(config: OkbConfig, env: NodeJS.ProcessEnv) {
  const { openDb } = await import('../state/db.js');
  const selected = openDb(config).get<{ value: string }>("SELECT value FROM meta WHERE key = 'assistant.agent'")?.value === 'codex' ? 'codex' : 'claude-code';
  const agents = await Promise.all((['claude-code', 'codex'] as const).map(async (id) => {
    const command = id === 'claude-code' ? 'claude' : 'codex';
    let version: string | null = null;
    try { version = (await runProcess(command, ['--version'], { input: '', cwd: statePaths(config).root, env, timeoutMs: 5000, maxBytes: 10_000 })).trim().slice(0, 100); } catch { /* absent is a state, not an error */ }
    const compatible = id === 'claude-code' ? supportedClaudeVersion(version) : version?.includes('0.159.0-alpha.12.1') === true && env.OKB_ASSISTANT_EXPERIMENTAL_CODEX === '1';
    return { id, installed: version !== null, version, ready: compatible, connection: 'unchecked' as const, ...(id === 'codex' ? { reason: 'experimental opt-in; MCP tested on Codex CLI 0.159.0-alpha.12.1 only' } : version !== null && !compatible ? { reason: 'Claude Code 2.1.259 or newer is required for unattended permission prompts' } : {}) };
  }));
  const connected = openDb(config).get<{ value: string }>("SELECT value FROM meta WHERE key = 'assistant.connected'")?.value === 'true';
  return { selected, connected, agents, privacy: 'local-agent' as const, terms: [{ agent: 'claude-code', checkedAt: '2026-10-11', url: 'https://code.claude.com/docs/en/headless', scope: 'documented CLI invocation; the person’s own installation and applicable terms' }, { agent: 'codex', checkedAt: '2026-10-11', url: 'https://learn.chatgpt.com/docs/non-interactive-mode', scope: 'documented CLI; real MCP fixture test on 0.159.0-alpha.12.1; experimental opt-in; commercial contractual review pending' }] };
}

export async function shutdownLocalAgents(): Promise<void> {
  for (const controller of localRequests.values()) controller.abort();
  const deadline = Date.now() + 3000;
  while (localRequests.size && Date.now() < deadline) await new Promise<void>((done) => setTimeout(done, 20));
}

export async function runLocalAgent(config: OkbConfig, env: NodeJS.ProcessEnv, request: BridgeRequest, agent: AgentId): Promise<BridgeResult> {
  const id = Symbol(); const controller = new AbortController(); localRequests.set(id, controller);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  try { return await localAgent(config, env, { ...request, signal }, agent); }
  finally { localRequests.delete(id); }
}

async function localAgent(config: OkbConfig, env: NodeJS.ProcessEnv, request: BridgeRequest, agent: AgentId): Promise<BridgeResult> {
  if (request.signal?.aborted) throw new OkbError('E_IO', 'local agent request cancelled');
  // An empty working folder avoids loading instructions/hooks from a knowledge document or a source repository.
  const workspace = resolve(statePaths(config).root, 'assistant', 'workspace');
  await mkdir(workspace, { recursive: true });
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
  const mcp = JSON.stringify({ mcpServers: { okb: { command: process.execPath, args: [cli, 'mcp'], env: { ...(env.OKB_HOME ? { OKB_HOME: env.OKB_HOME } : {}), ...(env.OKB_STATE_HOME ? { OKB_STATE_HOME: env.OKB_STATE_HOME } : {}), OKB_PROFILE: config.profile.id, OKB_MCP_POLICY: 'assistant', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } } } });
  const input = `${request.system}\n\n${request.prompt}`;
  if (agent === 'claude-code') {
    const version = await runProcess('claude', ['--version'], { input: '', cwd: workspace, env, signal: request.signal, timeoutMs: 5000, maxBytes: 10_000 });
    if (!supportedClaudeVersion(version)) throw new OkbError('E_CONFIG', 'Claude Code 2.1.259 or newer is required for this local integration');
    return parseClaudeResult(await runProcess('claude', claudeArguments({ schema: request.schema, mcp: request.tools === 'none' ? '{"mcpServers":{}}' : mcp, tools: request.tools }), { input, cwd: workspace, env, signal: request.signal, acceptFailureOutput: true }));
  }
  // Codex keeps the person's auth/config. The tested alpha remains an explicit experiment.
  if (env.OKB_ASSISTANT_EXPERIMENTAL_CODEX !== '1') throw new OkbError('E_CONFIG', 'Codex adapter is experimental; explicitly opt in to the tested CLI version');
  const version = await runProcess('codex', ['--version'], { input: '', cwd: workspace, env, signal: request.signal, timeoutMs: 5000, maxBytes: 10_000 });
  if (!version.includes('0.159.0-alpha.12.1')) throw new OkbError('E_CONFIG', 'this Codex CLI version has not been validated for the experimental adapter');
  const schemaFile = resolve(workspace, `${randomUUID()}.schema.json`);
  const replyFile = resolve(workspace, `${randomUUID()}.reply.json`);
  await writeFile(schemaFile, JSON.stringify(request.schema), { mode: 0o600 });
  try {
    const only = (JSON.parse(mcp) as { mcpServers: { okb: Record<string, unknown> } }).mcpServers.okb;
    const args = codexArguments({ schemaFile, replyFile, mcp: only, tools: request.tools });
    const raw = await runProcess('codex', args, { input, cwd: workspace, env, signal: request.signal });
    let usage: AgentUsage = { input: null, output: null };
    for (const line of raw.split('\n')) { try { const event = JSON.parse(line) as { type?: string; usage?: Record<string, unknown> }; if (event.type === 'turn.completed' && event.usage) usage = { input: count(event.usage.input_tokens), output: count(event.usage.output_tokens) }; } catch { /* informational line */ } }
    return { answer: JSON.parse(await readFile(replyFile, 'utf8')) as unknown, usage, provider: 'codex' };
  } finally { await Promise.all([rm(schemaFile, { force: true }), rm(replyFile, { force: true })]); }
}

export const localTextSystem = (system: string): string => `${system}\nReturn the requested answer as {"text":"the full answer"}; preserve its required inner format inside text.`;
export type LocalTextResult = { text: string; tokens: { input: number; output: number }; usage: AgentUsage; usedTokens: number | null; estimated: boolean; provider: AgentId };
/** Existing feature prompts, same configured local CLI, no tools and no API fallback.
 * Numeric legacy counters use a labelled estimate when the CLI omits usage; raw usage stays null.
 * The caller must wrap this transport in throughAiGate, as for every model call.
 */
export async function completeLocalText(config: OkbConfig, env: NodeJS.ProcessEnv, input: AiRequest, agent: AgentId, options: { run?: (request: BridgeRequest) => Promise<BridgeResult> } = {}): Promise<LocalTextResult> {
  const request: BridgeRequest = { system: localTextSystem(input.system), prompt: input.prompt, sources: [], tools: 'none', schema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: Math.min(120_000, input.maxTokens * 12) } }, required: ['text'], additionalProperties: false } };
  const result = options.run ? await options.run(request) : await runLocalAgent(config, env, request, agent);
  const answer = result.answer as { text?: unknown } | null;
  if (!answer || typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > Math.min(120_000, input.maxTokens * 12)) {
    throw new OkbError('E_IO', 'the local agent returned no usable text', { detail: { usage: { ...result.usage, tokens: result.usage.input === null || result.usage.output === null ? undefined : result.usage.input + result.usage.output, provider: result.provider } } });
  }
  const estimated = result.usage.input === null || result.usage.output === null;
  return { text: answer.text, tokens: { input: result.usage.input ?? estimateTokens(request.system + request.prompt), output: result.usage.output ?? estimateTokens(answer.text) }, usage: result.usage, usedTokens: estimated ? null : result.usage.input! + result.usage.output!, estimated, provider: agent };
}
