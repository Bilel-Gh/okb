#!/usr/bin/env node
/**
 * PreToolUse (Read, and Bash commands that print a Markdown file): a note
 * marked `x_okb.confidentiality: secret` (🔒) is the person's alone. Claude may
 * read it only after the person named it in their own message — OKB's
 * UserPromptSubmit hook then opens it for 30 minutes (~/.okb/unlocked.json).
 *
 * Honest limits: this sees Read and the common shell readers (cat, head, tail,
 * less, more, sed, awk, bat) on `.md` paths; OKB's own search already leaves 🔒
 * notes out for Claude. It is a guard against accidental reading, not a vault.
 * Any failure lets the call through: the hook never blocks ordinary work.
 */
import { open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

const READERS = /(?:^|[\s;&|(])(?:cat|head|tail|less|more|sed|awk|bat|nl|strings)\b([^;&|]*)/g;

async function isSecret(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    const head = buffer.subarray(0, bytesRead).toString('utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    return Boolean(fm && /^\s+confidentiality:\s*['"]?secret\b/m.test(fm[1]));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function unlocked(path) {
  try {
    const home = process.env.OKB_HOME || resolve(homedir(), '.okb');
    const data = JSON.parse(await readFile(resolve(home, 'unlocked.json'), 'utf8'));
    const now = new Date().toISOString();
    return Array.isArray(data?.entries) && data.entries.some((e) => e.path === path && e.until > now);
  } catch {
    return false;
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  const cwd = String(payload?.cwd ?? process.cwd());
  const input = payload?.tool_input ?? {};
  const candidates = [];
  if (payload?.tool_name === 'Read' && typeof input.file_path === 'string') candidates.push(input.file_path);
  if (payload?.tool_name === 'Bash' && typeof input.command === 'string') {
    for (const m of input.command.matchAll(READERS)) {
      for (const word of m[1].match(/"[^"]+\.md"|'[^']+\.md'|[^\s"']+\.md/g) ?? []) candidates.push(word.replace(/^["']|["']$/g, ''));
    }
  }
  for (const c of candidates) {
    const path = isAbsolute(c) ? c : resolve(cwd, c.replace(/^~(?=\/)/, homedir()));
    if (!path.endsWith('.md')) continue;
    if (await isSecret(path) && !(await unlocked(path))) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: 'This OKB note is marked confidential (🔒 x_okb.confidentiality: secret): the person reads it, Claude does not unless they ask. Tell them it is 🔒; if they want you to read it, they name the note in their next message and OKB opens it to you for 30 minutes. Do not try another way to read it.',
      } }), () => process.exit(0));
      return;
    }
  }
  process.exit(0);
});
