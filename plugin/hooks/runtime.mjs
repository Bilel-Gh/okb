/** Shared hook contract, shipped unchanged in core and dev (test checks parity).
 * Diagnostics contain only fixed reasons, versions and timings, never input,
 * paths, command arguments, transcript text, CLI stderr or environment values.
 */
import { execFile } from 'node:child_process';
import { accessSync, appendFileSync, constants, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runnable = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };
const exists = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const REASONS = new Set('started headless invalid-input event-not-covered input-limit deadline context-sent binary-absent runtime-unsupported timeout binary-or-runtime-absent cli-error profile-or-repo-unresolved cli-ok no-context invalid-output missing-cwd excluded-file already-sent session-cap scribe-started lookup-failed no-notes dedup-write-failed irrelevant-command no-matches excluded-prompt agent-notification no-suggestion consent-processed continuation transcript-window transcript-unavailable no-user-prompt short-exchange outside-scope profile-resolution-error brief-error'.split(' '));
const home = () => process.env.OKB_HOME || resolve(homedir(), '.okb');
export function resolveEngine(url) {
  const here = dirname(fileURLToPath(url));
  if (process.env.OKB_CLI) return runnable(process.env.OKB_CLI) ? { command: process.env.OKB_CLI, args: [], source: 'explicit' } : null;
  // Directly use the runtime already running the hook: a wrapper's `node` on PATH may be older or absent.
  for (const file of [resolve(here, '../../dist/cli/index.js'), resolve(here, '../../../dist/cli/index.js')]) {
    if (exists(file)) return { command: process.execPath, args: [file], source: 'package' };
  }
  const candidates = [[resolve(home(), 'bin/okb'), 'launcher'], [resolve(here, '../../../plugin/bin/okb'), 'checkout']];
  try {
    const core = resolve(here, '../../../okb');
    for (const v of readdirSync(core).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }))) candidates.push([resolve(core, v, 'bin/okb'), 'cache']);
  } catch { /* a standalone module */ }
  for (const dir of String(process.env.PATH || '').split(delimiter)) if (dir) candidates.push([resolve(dir, 'okb'), 'path']);
  for (const [command, source] of candidates) if (runnable(command)) return { command, args: [], source };
  return null;
}
export function diagnostic(url, event, reason, started, extra = {}) {
  if (process.env.OKB_HOOK_DIAGNOSTICS === '0') return;
  try {
    const here = dirname(fileURLToPath(url));
    const plugin = JSON.parse(readFileSync(resolve(here, '../.claude-plugin/plugin.json'), 'utf8'));
    const dir = resolve(home(), 'hooks'); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = resolve(dir, 'diagnostics.jsonl');
    if (exists(file) && statSync(file).size > 256_000) renameSync(file, `${file}.1`);
    // Only callers' fixed enum values reach extras. No arbitrary error.message/code is persisted.
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, hook: fileURLToPath(url).split('/').at(-1), reason: REASONS.has(reason) ? reason : 'unknown', durationMs: Date.now()-started, runtime: process.version, plugin: String(plugin.version), ...extra })+'\n', { mode: 0o600 });
  } catch { /* diagnostic failures never change the hook's decision */ }
}
export function createHook(url, event, deadlineMs = 9000) {
  const started = Date.now();
  const trace = (reason, extra) => diagnostic(url, event, reason, started, extra);
  trace('started');
  const timer = setTimeout(() => { trace('deadline'); process.exit(0); }, deadlineMs).unref();
  const finish = (reason, context = '') => {
    clearTimeout(timer);
    trace(context ? 'context-sent' : reason, { result: context ? 'context' : 'silent' });
    if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }), () => process.exit(0));
    else process.exit(0);
  };
  const read = async () => {
    if (process.env.OKB_HEADLESS === '1') return finish('headless');
    let raw = '';
    try {
      for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1_000_000) return finish('input-limit'); }
      const input = JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return finish('invalid-input');
      if (input.hook_event_name && input.hook_event_name !== event) return finish('event-not-covered');
      return input;
    } catch { return finish('invalid-input'); }
  };
  const run = async (args, { cwd, stdin, json = false, timeout = 6000 } = {}) => {
    const engine = resolveEngine(url);
    if (!engine) { trace('binary-absent'); return null; }
    const version = process.versions.node.split('.').map(Number);
    if (engine.source === 'package' && (version[0] < 22 || (version[0] === 22 && version[1] < 13))) { trace('runtime-unsupported'); return null; }
    const requested = Number(process.env.OKB_HOOK_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(timeout, requested) : timeout;
    return new Promise((done) => {
      const child = execFile(engine.command, [...engine.args, ...args], { timeout: timeoutMs, maxBuffer: 200_000, env: { ...process.env, OKB_NODE: process.execPath, OKB_NO_INTERACTIVE: '1', OKB_VIA_CLAUDE: '1', OKB_PLUGIN_VERSION: (() => { try { return String(JSON.parse(readFileSync(resolve(dirname(fileURLToPath(url)), '../.claude-plugin/plugin.json'), 'utf8')).version); } catch { return ''; } })() }, ...(cwd ? { cwd } : {}) }, (error, stdout) => {
        if (error) { trace(error.killed ? 'timeout' : error.code === 'ENOENT' || error.code === 127 ? 'binary-or-runtime-absent' : 'cli-error', { resolver: engine.source, result: 'error' }); return done(null); }
        const text = String(stdout).trim();
        if (!json) { trace(text ? 'cli-ok' : 'no-context', { resolver: engine.source }); return done(text); }
        try {
          const out = JSON.parse(text);
          if (!out || typeof out !== 'object') throw new Error();
          if (out.ok === false) { trace('profile-or-repo-unresolved'); return done(null); }
          trace('cli-ok', { resolver: engine.source }); return done(out);
        } catch { trace('invalid-output'); return done(null); }
      });
      child.stdin?.end(stdin ?? '');
    });
  };
  return { read, run, finish, trace };
}
