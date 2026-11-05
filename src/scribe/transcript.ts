import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { claudeProjectsDir } from '../usage/claude-logs.js';

/**
 * Claude Code's conversation logs, read for the scribe (D77):
 * `~/.claude/projects/<project>/<session>.jsonl`, one JSON object per line,
 * written while the conversation goes on. The format is Claude Code's own and
 * undocumented: every field is optional here, an unknown row is skipped and
 * counted, never fatal. Only complete lines are read; the cursor is a byte
 * offset, so a session is read again from where the scribe stopped.
 */
export type Turn = {
  readonly at: string | null;
  readonly who: 'person' | 'assistant';
  readonly text: string;
  /** Files the assistant created or changed in this turn. */
  readonly edited: readonly string[];
  /** Shell commands the assistant ran in this turn. */
  readonly commands: readonly string[];
  /** Tool results marked as errors, for the person's turn that carried them. */
  readonly errors: number;
};

export type Chunk = {
  readonly session: string;
  readonly file: string;
  readonly cwd: string | null;
  readonly branch: string | null;
  readonly turns: readonly Turn[];
  /** Byte offsets: where this chunk started and where the next read starts. */
  readonly from: number;
  readonly to: number;
  /** The file's size when read: `to < size` means more is waiting. */
  readonly size: number;
  /** Lines that were not JSON or not understood. */
  readonly skipped: number;
};

const MAX_READ = 8_000_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Text Claude Code itself puts in the person's turn: commands, reminders, notifications. */
const MACHINE = /^\s*<(command-[a-z]+|local-command-[a-z]+|system-reminder|task-notification|bash-[a-z]+|user-memory-input)>/;

type Block = { type?: unknown; text?: unknown; name?: unknown; input?: Record<string, unknown>; is_error?: unknown };
type Row = { type?: unknown; isMeta?: unknown; isSidechain?: unknown; timestamp?: unknown; cwd?: unknown; gitBranch?: unknown; sessionId?: unknown; message?: { content?: unknown } };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Read the complete lines of a transcript from a byte offset. */
export async function readTranscript(file: string, from = 0): Promise<Chunk> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.min(Math.max(0, from), size);
    const length = Math.min(size - start, MAX_READ);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const last = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    const complete = last < 0 ? 0 : last + 1;
    const parsed = parseLines(buffer.subarray(0, complete).toString('utf8'));
    return { session: parsed.session ?? basename(file, '.jsonl'), file, cwd: parsed.cwd, branch: parsed.branch, turns: parsed.turns, from: start, to: start + complete, size, skipped: parsed.skipped };
  } finally {
    await handle.close();
  }
}

export function parseLines(text: string): { turns: Turn[]; cwd: string | null; branch: string | null; session: string | null; skipped: number } {
  const turns: Turn[] = [];
  let cwd: string | null = null;
  let branch: string | null = null;
  let session: string | null = null;
  let skipped = 0;
  let errors = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: Row;
    try { row = JSON.parse(line) as Row; } catch { skipped++; continue; }
    if (!row || typeof row !== 'object') { skipped++; continue; }
    cwd = str(row.cwd) ?? cwd;
    branch = str(row.gitBranch) ?? branch;
    session = str(row.sessionId) ?? session;
    // A subagent's own exchanges, or Claude Code's bookkeeping: not the conversation.
    if (row.isSidechain === true || row.isMeta === true) continue;
    if (row.type !== 'user' && row.type !== 'assistant') continue;
    const at = str(row.timestamp);
    const content = row.message?.content;
    const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Block[]) : [];
    if (!blocks.length) { skipped++; continue; }
    if (row.type === 'user') {
      errors += blocks.filter((b) => b?.type === 'tool_result' && b.is_error === true).length;
      const said = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => String(b.text)).filter((t) => !MACHINE.test(t)).join('\n').trim();
      if (!said) continue;
      turns.push({ at, who: 'person', text: said, edited: [], commands: [], errors });
      errors = 0;
      continue;
    }
    const said = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => String(b.text)).join('\n').trim();
    const edited = blocks.filter((b) => b?.type === 'tool_use' && EDIT_TOOLS.has(String(b.name))).map((b) => str(b.input?.file_path) ?? str(b.input?.notebook_path)).filter((p): p is string => Boolean(p));
    const commands = blocks.filter((b) => b?.type === 'tool_use' && b.name === 'Bash').map((b) => str(b.input?.command)).filter((c): c is string => Boolean(c)).map((c) => c.split('\n')[0]!.slice(0, 200));
    const prev = turns.at(-1);
    // One answer is often several rows (text, tool calls, text again): they make one turn.
    if (prev?.who === 'assistant') {
      turns[turns.length - 1] = { ...prev, text: [prev.text, said].filter(Boolean).join('\n\n'), edited: [...new Set([...prev.edited, ...edited])], commands: [...prev.commands, ...commands] };
    } else if (said || edited.length || commands.length) {
      turns.push({ at, who: 'assistant', text: said, edited, commands, errors: 0 });
    }
  }
  return { turns, cwd, branch, session, skipped };
}

export type TranscriptFile = { readonly file: string; readonly session: string; readonly size: number; readonly modified: number };

/** Every main transcript on this machine (subagents' own files are not conversations). */
export async function listTranscripts(env: NodeJS.ProcessEnv = process.env, since = 0): Promise<TranscriptFile[]> {
  const root = claudeProjectsDir(env);
  const out: TranscriptFile[] = [];
  const projects = await readdir(root).catch(() => [] as string[]);
  for (const project of projects) {
    const files = await readdir(join(root, project)).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = join(root, project, f);
      const s = await stat(file).catch(() => null);
      if (!s?.isFile() || s.mtimeMs < since) continue;
      out.push({ file, session: basename(f, '.jsonl'), size: s.size, modified: s.mtimeMs });
    }
  }
  return out.sort((a, b) => a.modified - b.modified);
}

/** The transcript of one session, wherever Claude Code filed it. */
export async function findTranscript(session: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(session)) return null;
  return (await listTranscripts(env)).find((t) => t.session === session)?.file ?? null;
}
