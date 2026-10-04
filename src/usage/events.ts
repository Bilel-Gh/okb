import { rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { appendLine, ensureDir, readLines } from '../util/fsx.js';
import { usageDir } from './stats.js';

/**
 * A short line per okb command: which command, how it ended, how long it took.
 * No argument is kept (a capture or a path can be private): only the command,
 * a declared subcommand, the error code and the KB id. It shows which steps
 * fail or drag, without any model call. `OKB_NO_EVENTS=1` turns it off.
 */
export type OkbEvent = {
  readonly at: string;
  readonly command: string;
  readonly sub?: string;
  readonly ok: boolean;
  readonly code?: string;
  readonly ms: number;
  readonly kb?: string;
  /** Run by Claude (inside Claude Code) or typed by the person. */
  readonly by: 'claude' | 'person';
};

const MAX_BYTES = 2_000_000;

export async function recordEvent(event: OkbEvent, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.OKB_NO_EVENTS === '1') return;
  try {
    const dir = usageDir(env);
    await ensureDir(dir);
    const file = join(dir, 'events.jsonl');
    const size = await stat(file).then((s) => s.size, () => 0);
    if (size > MAX_BYTES) await rename(file, join(dir, 'events-old.jsonl')).catch(() => undefined);
    await appendLine(file, JSON.stringify(event));
  } catch { /* the log must never break a command */ }
}

export async function readEvents(env: NodeJS.ProcessEnv = process.env): Promise<OkbEvent[]> {
  const dir = usageDir(env);
  const out: OkbEvent[] = [];
  for (const f of ['events-old.jsonl', 'events.jsonl']) {
    const rows = await readLines(join(dir, f)).catch(() => [] as string[]);
    for (const row of rows) {
      try { out.push(JSON.parse(row) as OkbEvent); } catch { /* cut line */ }
    }
  }
  return out;
}

/** Claude Code sets CLAUDECODE=1 in the shell of its tools. */
export function invokedBy(env: NodeJS.ProcessEnv = process.env): 'claude' | 'person' {
  return env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT ? 'claude' : 'person';
}

export type Feedback = { readonly at: string; readonly text: string; readonly kb?: string; readonly where: 'cli' | 'web' };

export async function addFeedback(entry: Feedback, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const dir = usageDir(env);
  await ensureDir(dir);
  await appendLine(join(dir, 'feedback.jsonl'), JSON.stringify(entry));
}

export async function readFeedback(env: NodeJS.ProcessEnv = process.env): Promise<Feedback[]> {
  const rows = await readLines(join(usageDir(env), 'feedback.jsonl')).catch(() => [] as string[]);
  return rows.flatMap((r) => { try { return [JSON.parse(r) as Feedback]; } catch { return []; } });
}
