#!/usr/bin/env node
/**
 * PostToolUse (Bash): after a `git commit` Claude ran, the new commits join the
 * journal of the ticket in progress (OKB reads them from Git: no AI, nothing
 * written in the KB). Claude gets one line only when a commit was added, as a
 * reminder to note the decision or trap it settled while it is fresh.
 *
 * Silent for every other command, outside a followed ticket, and on any error.
 */
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const okb = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'okb');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const command = String(input?.tool_input?.command ?? '');
  if (!/\bgit\b[^\n|;&]*\bcommit\b/.test(command)) process.exit(0);
  const cwd = String(input?.cwd ?? '');
  if (!cwd) process.exit(0);
  execFile(okb, ['ticket', 'commit', '--cwd', cwd, '--json'], { timeout: 6000, maxBuffer: 100_000, env: process.env, cwd }, (error, stdout) => {
    if (error) process.exit(0);
    try {
      const out = JSON.parse(String(stdout));
      if (out?.context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: out.context } }));
    } catch { /* nothing to say */ }
    process.exit(0);
  });
});
setTimeout(() => process.exit(0), 8000).unref();
