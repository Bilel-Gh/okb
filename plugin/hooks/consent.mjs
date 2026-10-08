#!/usr/bin/env node
/**
 * PostToolUse (AskUserQuestion): when the person answers Claude's question
 * about a suggestion card (« Créer », « Garder », or a card picked in a list),
 * OKB records their yes. Claude cannot record it itself: the approval guard
 * refuses `okb suggest consent` from a tool call. Silent, never blocks.
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
  if (input?.tool_name && input.tool_name !== 'AskUserQuestion') process.exit(0);
  const child = execFile(okb, ['suggest', 'consent', '--stdin'], { timeout: 4000, env: process.env, ...(input?.cwd ? { cwd: String(input.cwd) } : {}) }, () => process.exit(0));
  child.stdin?.end(JSON.stringify({ tool_input: input?.tool_input ?? null, tool_response: input?.tool_response ?? null }));
});
setTimeout(() => process.exit(0), 5000).unref();
