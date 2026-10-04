import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { COMMANDS } from '../cli/commands/help.js';
import { addTokens, costOf, noTokens, type Tokens } from './prices.js';

/**
 * What OKB costs, read from the logs Claude Code already keeps on this machine
 * (`~/.claude/projects/<project>/<session>.jsonl`, plus one file per subagent).
 * Nothing is sent anywhere and no model is called: the numbers are the ones the
 * API returned with each answer. Only numbers and workflow names are kept.
 *
 * A session is cut into turns, from one message of the person to the next. A
 * turn belongs to an OKB workflow when it runs an OKB skill or command
 * (`okb:okb-ingest`, `/okb:ingest`), or calls the `okb` CLI; its subagents are
 * counted with it.
 */
export type ModelUse = { tokens: Tokens; costUsd: number; requests: number };
export type Usage = Record<string, ModelUse>;

export type OkbRun = {
  readonly session: string;
  readonly start: string;
  readonly end: string;
  /** `ingest`, `onboard`… for a skill or command; `cli:review`… for the CLI alone. */
  readonly workflow: string;
  readonly profile: string | null;
  readonly main: Usage;
  readonly agents: readonly { readonly type: string; readonly usage: Usage }[];
  /** Calls to the okb CLI, their output read back by Claude, and the failures. */
  readonly okbCalls: number;
  readonly okbErrors: number;
  readonly outputBytes: Readonly<Record<string, number>>;
  readonly outputCalls: Readonly<Record<string, number>>;
  /** OKB skill instructions loaded into the conversation. */
  readonly skillBytes: number;
};

export type SessionSummary = {
  readonly session: string;
  readonly project: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly okbRuns: readonly OkbRun[];
  /** Everything else Claude Code did in this session, by day (YYYY-MM-DD). */
  readonly other: Readonly<Record<string, Usage>>;
  /** Context the OKB session hook added (bytes, each time it ran). */
  readonly hookBytes: number;
  readonly hookRuns: number;
};

export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
  return join(base, 'projects');
}

/** Every session log: `{ file, session, project, agents: [...] }`. */
export async function listSessions(projectsDir: string): Promise<{ file: string; session: string; project: string; agentDir: string }[]> {
  const out: { file: string; session: string; project: string; agentDir: string }[] = [];
  let projects: string[];
  try { projects = await readdir(projectsDir); } catch { return out; }
  for (const project of projects) {
    let files: string[];
    try { files = await readdir(join(projectsDir, project)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const session = f.slice(0, -'.jsonl'.length);
      out.push({ file: join(projectsDir, project, f), session, project, agentDir: join(projectsDir, project, session, 'subagents') });
    }
  }
  return out;
}

type Line = Record<string, unknown> & { type?: string; timestamp?: string };
type Content = { type?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string };

const OKB_SKILL = /^okb:okb-([a-z0-9-]+)$/;
const OKB_COMMAND = /<command-name>\/okb:([a-z0-9-]+)<\/command-name>/;
const OKB_CLI = /(?:^|[;&|(]\s*|\s)(?:okb|node\s+\S*dist\/cli\/index\.js)\s+([a-z][a-z-]*)/;
const CLI_NAMES = new Map(COMMANDS.flatMap((c) => [[c.name, c.name], ...(c.aliases ?? []).map((a) => [a, c.name] as [string, string])]));

async function* lines(file: string): AsyncGenerator<Line> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw) continue;
    try { yield JSON.parse(raw) as Line; } catch { /* a line cut while being written */ }
  }
}

const textOf = (c: unknown): string => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : typeof (x as Content)?.text === 'string' ? (x as Content).text! : '')).join('');
  return '';
};

type Message = { id?: string; model?: string; usage?: Record<string, unknown>; content?: Content[] };

/** One answer's tokens, as the API counted them. */
function tokensOf(usage: Record<string, unknown>): Tokens {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const creation = (usage.cache_creation ?? {}) as Record<string, unknown>;
  const write1h = n(creation.ephemeral_1h_input_tokens);
  const write5m = creation.ephemeral_5m_input_tokens !== undefined ? n(creation.ephemeral_5m_input_tokens) : Math.max(0, n(usage.cache_creation_input_tokens) - write1h);
  return { input: n(usage.input_tokens), output: n(usage.output_tokens), write5m, write1h, read: n(usage.cache_read_input_tokens) };
}

function addUse(into: Usage, model: string, usage: Record<string, unknown>): void {
  const tokens = tokensOf(usage);
  const speed = usage.speed === 'fast' ? 'fast' : 'standard';
  const slot = (into[model] ??= { tokens: noTokens(), costUsd: 0, requests: 0 });
  addTokens(slot.tokens, tokens);
  slot.costUsd += costOf(model, tokens, speed);
  slot.requests += 1;
}

export function mergeUsage(into: Usage, more: Usage): Usage {
  for (const [model, use] of Object.entries(more)) {
    const slot = (into[model] ??= { tokens: noTokens(), costUsd: 0, requests: 0 });
    addTokens(slot.tokens, use.tokens);
    slot.costUsd += use.costUsd;
    slot.requests += use.requests;
  }
  return into;
}

/**
 * Answers of one log, each counted once: Claude Code writes one line per
 * content block of an answer, all carrying the same usage.
 */
async function answersOf(file: string, onLine: (line: Line) => void): Promise<void> {
  // A resumed or compacted session copies earlier lines again, with their ids.
  const seen = new Set<string>();
  for await (const line of lines(file)) {
    if (typeof line.uuid === 'string') {
      if (seen.has(line.uuid)) continue;
      seen.add(line.uuid);
    }
    onLine(line);
  }
}

/** Subagents of a session: their type, the tool call that started them, and what they used. */
async function readAgents(agentDir: string): Promise<{ type: string; toolUseId: string | null; usage: Usage }[]> {
  let files: string[];
  try { files = await readdir(agentDir); } catch { return []; }
  const out: { type: string; toolUseId: string | null; usage: Usage }[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    let meta: { agentType?: string; toolUseId?: string } = {};
    try { meta = JSON.parse(await readFile(join(agentDir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch { /* older Claude Code: no metadata */ }
    const usage: Usage = {};
    const seen = new Map<string, { model: string; usage: Record<string, unknown> }>();
    await answersOf(join(agentDir, f), (line) => {
      if (line.type !== 'assistant') return;
      const m = line.message as Message | undefined;
      if (!m?.usage || !m.model || m.model === '<synthetic>') return;
      const key = m.id ?? `${line.uuid}`;
      const prev = seen.get(key);
      if (!prev || Number(m.usage.output_tokens ?? 0) >= Number(prev.usage.output_tokens ?? 0)) seen.set(key, { model: m.model, usage: m.usage });
    });
    for (const a of seen.values()) addUse(usage, a.model, a.usage);
    out.push({ type: meta.agentType ?? 'unknown', toolUseId: meta.toolUseId ?? null, usage });
  }
  return out;
}

type Turn = {
  start: string | null;
  end: string | null;
  workflow: string | null;
  cli: string | null;
  profile: string | null;
  cwd: string | null;
  answers: Map<string, { model: string; usage: Record<string, unknown> }>;
  toolUses: Set<string>;
  okbTools: Map<string, string>;
  okbCalls: number;
  okbErrors: number;
  outputBytes: Record<string, number>;
  outputCalls: Record<string, number>;
  skillBytes: number;
  /** Claude changed OKB's own code in this turn: someone developing OKB, not using it. */
  dev: boolean;
};

const newTurn = (ts: string | null): Turn => ({
  start: ts, end: ts, workflow: null, cli: null, profile: null, cwd: null, answers: new Map(), toolUses: new Set(),
  okbTools: new Map(), okbCalls: 0, okbErrors: 0, outputBytes: {}, outputCalls: {}, skillBytes: 0, dev: false,
});

/** A message typed by the person (not a tool result, not text Claude Code adds). */
function isPrompt(line: Line): boolean {
  if (line.type !== 'user' || line.isMeta || line.isCompactSummary) return false;
  const c = (line.message as { content?: unknown } | undefined)?.content;
  if (typeof c === 'string') return !c.startsWith('<local-command-stdout>') && !c.startsWith('<local-command-caveat>');
  return Array.isArray(c) && !c.some((x) => (x as Content)?.type === 'tool_result');
}

/**
 * Read one session log. `profileOf(cwd)` names the OKB profile whose KB holds a
 * folder, so a run can be told apart by KB.
 */
export async function summariseSession(
  entry: { file: string; session: string; project: string; agentDir: string },
  profileOf: (cwd: string) => string | null = () => null,
  devRoot: string | null = null,
): Promise<SessionSummary> {
  const touchesDev = (path: unknown) => Boolean(devRoot && typeof path === 'string' && path.startsWith(`${devRoot}/`) && !path.includes('/node_modules/'));
  const turns: Turn[] = [];
  let turn: Turn | null = null;
  const answerTurn = new Map<string, Turn>();
  let hookBytes = 0;
  let hookRuns = 0;
  let first: string | null = null;
  let last: string | null = null;
  await answersOf(entry.file, (line) => {
    const ts = typeof line.timestamp === 'string' ? line.timestamp : null;
    if (ts) { first ??= ts; last = ts; }
    if (line.type === 'attachment') {
      const a = line.attachment as { type?: string; hookEvent?: string; stdout?: string; content?: unknown } | undefined;
      if (a?.hookEvent === 'SessionStart' && typeof a.stdout === 'string' && a.stdout.includes('OKB')) {
        hookRuns += 1;
        try { hookBytes += Buffer.byteLength(String((JSON.parse(a.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? '')); } catch { hookBytes += Buffer.byteLength(a.stdout); }
      }
      return;
    }
    if (isPrompt(line) || !turn) {
      turn = newTurn(ts);
      turns.push(turn);
    }
    const current: Turn = turn;
    if (ts) current.end = ts;
    if (typeof line.cwd === 'string' && !current.cwd) current.cwd = line.cwd;
    if (line.type === 'user') {
      const c = (line.message as { content?: unknown } | undefined)?.content;
      const text = textOf(c);
      const command = OKB_COMMAND.exec(text);
      if (command && !current.workflow) current.workflow = command[1]!;
      if (line.isMeta && /Base directory for this skill: \S*okb-[a-z-]+/.test(text)) current.skillBytes += Buffer.byteLength(text);
      if (Array.isArray(c)) {
        for (const item of c as Content[]) {
          if (item?.type !== 'tool_result' || !item.tool_use_id) continue;
          const sub = current.okbTools.get(item.tool_use_id);
          if (!sub) continue;
          current.outputBytes[sub] = (current.outputBytes[sub] ?? 0) + Buffer.byteLength(textOf(item.content));
          current.outputCalls[sub] = (current.outputCalls[sub] ?? 0) + 1;
          if (item.is_error) current.okbErrors += 1;
        }
      }
      return;
    }
    if (line.type !== 'assistant') return;
    const m = line.message as Message | undefined;
    if (!m) return;
    for (const item of m.content ?? []) {
      if (item?.type !== 'tool_use' || !item.id) continue;
      current.toolUses.add(item.id);
      const input = item.input ?? {};
      if ((item.name === 'Edit' || item.name === 'Write' || item.name === 'NotebookEdit') && touchesDev(input.file_path)) current.dev = true;
      if (item.name === 'Skill') {
        const skill = OKB_SKILL.exec(String(input.skill ?? ''));
        if (skill && !current.workflow) current.workflow = skill[1]!;
      } else if (item.name === 'Bash') {
        const command = String(input.command ?? '');
        const cli = OKB_CLI.exec(command);
        const sub = cli ? CLI_NAMES.get(cli[1]!) : undefined;
        if (sub) {
          current.okbCalls += 1;
          current.okbTools.set(item.id, sub);
          current.cli ??= sub;
          const kb = /--(?:kb|profile)[= ]([A-Za-z0-9_-]+)/.exec(command);
          if (kb) current.profile ??= kb[1]!;
        }
      }
    }
    if (!m.usage || !m.model || m.model === '<synthetic>') return;
    const key = m.id ?? String(line.uuid);
    const owner = answerTurn.get(key) ?? current;
    answerTurn.set(key, owner);
    const prev = owner.answers.get(key);
    if (!prev || Number(m.usage.output_tokens ?? 0) >= Number(prev.usage.output_tokens ?? 0)) owner.answers.set(key, { model: m.model, usage: m.usage });
  });

  const agents = await readAgents(entry.agentDir);
  const okbRuns: OkbRun[] = [];
  const other: Record<string, Usage> = {};
  const placed = new Set<number>();
  const agentsOf = (tn: Turn) => agents.filter((a) => a.toolUseId && tn.toolUses.has(a.toolUseId));
  // Calling the CLI alone counts as using OKB in a session that also ran an OKB
  // skill, or on a KB; otherwise it is someone working on OKB itself, or a test.
  const okbSession = turns.some((tn) => tn.workflow || agentsOf(tn).some((a) => a.type.startsWith('okb:')));
  const devSession = turns.some((tn) => tn.dev);
  turns.forEach((tn) => {
    const mine = agentsOf(tn);
    mine.forEach((a) => placed.add(agents.indexOf(a)));
    const okbAgent = mine.find((a) => a.type.startsWith('okb:'));
    const onKb = tn.profile ?? (tn.cwd ? profileOf(tn.cwd) : null);
    const cliCounts = tn.cli && !tn.dev && (okbSession || (onKb && !devSession));
    const workflow = tn.workflow ?? (okbAgent ? `agent:${okbAgent.type.slice(4)}` : cliCounts ? `cli:${tn.cli}` : null);
    const main: Usage = {};
    for (const a of tn.answers.values()) addUse(main, a.model, a.usage);
    if (!workflow) {
      const day = (tn.start ?? tn.end ?? '').slice(0, 10) || 'unknown';
      mergeUsage((other[day] ??= {}), main);
      for (const a of mine) mergeUsage(other[day]!, a.usage);
      return;
    }
    okbRuns.push({
      session: entry.session,
      start: tn.start ?? '',
      end: tn.end ?? tn.start ?? '',
      workflow,
      profile: onKb,
      main,
      agents: mine.map((a) => ({ type: a.type, usage: a.usage })),
      okbCalls: tn.okbCalls,
      okbErrors: tn.okbErrors,
      outputBytes: tn.outputBytes,
      outputCalls: tn.outputCalls,
      skillBytes: tn.skillBytes,
    });
  });
  // Subagents whose parent call was not found still count, as other usage.
  agents.forEach((a, i) => {
    if (placed.has(i)) return;
    const day = (last ?? 'unknown').slice(0, 10);
    mergeUsage((other[day] ??= {}), a.usage);
  });
  return { session: entry.session, project: basename(entry.project), start: first, end: last, okbRuns, other, hookBytes, hookRuns };
}

/** Size and modification time, to re-read only the logs that changed. */
export async function fingerprint(entry: { file: string; agentDir: string }): Promise<string> {
  const s = await stat(entry.file);
  let agents = '';
  try {
    const files = await readdir(entry.agentDir);
    for (const f of files.sort()) {
      if (!f.endsWith('.jsonl')) continue;
      const a = await stat(join(entry.agentDir, f));
      agents += `${f}:${a.size}:${Math.round(a.mtimeMs)};`;
    }
  } catch { /* no subagents */ }
  return `${s.size}:${Math.round(s.mtimeMs)}|${agents}`;
}
