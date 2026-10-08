#!/usr/bin/env node
/**
 * SessionStart (dev module): inside a repository OKB documents, Claude gets its
 * brief — the repository's notes in reading order, the shared notes tied to it,
 * its connections and the ticket in progress; at the top of a workspace, its
 * repositories and tickets. Silent outside, and on any error.
 */
import { execFile } from 'node:child_process';
import { okbPath } from './okb-path.mjs';

// A model OKB itself runs in the background (src/ai/provider.ts) needs no context: stay silent.
if (process.env.OKB_HEADLESS === '1') process.exit(0);

const okb = okbPath();
if (!okb) process.exit(0);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  let cwd = '';
  try { cwd = String(JSON.parse(raw)?.cwd ?? ''); } catch { /* no input */ }
  if (!cwd) process.exit(0);
  execFile(okb, ['scope', '--context', '--cwd', cwd], { timeout: 7000, maxBuffer: 200_000, env: process.env, cwd }, (error, stdout) => {
    const text = error ? '' : String(stdout).trim();
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
    process.exit(0);
  });
});
setTimeout(() => process.exit(0), 9000).unref();
