#!/usr/bin/env node
/**
 * Stop: at the end of Claude's answer, OKB looks — without AI — for a moment
 * worth keeping (the person asked what something is, or said they did not
 * know it). It queues a suggestion card and, when it is worth it now, lets
 * Claude offer it in one line. Nothing is ever written here. Silent otherwise,
 * once per answer (never on its own continuation), never blocks.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A model OKB itself runs in the background (src/ai/provider.ts) needs no context: stay silent.
if (process.env.OKB_HEADLESS === '1') process.exit(0);

const okb = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'okb');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  if (input?.stop_hook_active) process.exit(0);
  const answer = String(input?.last_assistant_message ?? '');
  if (answer.length < 500) process.exit(0);
  // The person's last message, from the transcript (the last user line that is text, not a tool result).
  let prompt = '';
  try {
    const lines = readFileSync(String(input?.transcript_path ?? ''), 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && !prompt; i--) {
      const row = JSON.parse(lines[i]);
      if (row?.type !== 'user' || row?.isMeta) continue;
      const content = row?.message?.content;
      if (typeof content === 'string') prompt = content;
      else if (Array.isArray(content)) prompt = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    }
  } catch { process.exit(0); }
  if (!prompt || prompt.startsWith('<')) process.exit(0);
  const child = execFile(okb, ['suggest', 'moment', '--stdin', '--json'], { timeout: 6000, env: process.env, ...(input?.cwd ? { cwd: String(input.cwd) } : {}) }, (error, stdout) => {
    if (error) process.exit(0);
    try {
      const out = JSON.parse(String(stdout));
      if (out?.context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: out.context } }));
    } catch { /* nothing to offer */ }
    process.exit(0);
  });
  child.stdin?.end(JSON.stringify({ prompt: prompt.slice(0, 2000), answer: answer.slice(0, 4000) }));
});
setTimeout(() => process.exit(0), 8000).unref();
