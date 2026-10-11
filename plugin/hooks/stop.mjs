#!/usr/bin/env node
/**
 * Stop: at the end of Claude's answer, OKB looks — without AI — for a moment
 * worth keeping: a long explanation the person asked for, the same question
 * twice, a bug solved after several tries, a decision, a command discovered,
 * an error and its cause. It keeps what it spots for the end of the session,
 * where at most three things are offered in one question (`suggest.mode: live`
 * also offers a strong card at once). Nothing is ever written here. Silent
 * otherwise, once per answer (never on its own continuation), never blocks.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A model OKB itself runs in the background (src/ai/provider.ts) needs no context: stay silent.
if (process.env.OKB_HEADLESS === '1') process.exit(0);

// A short exchange is looked at only when its words may close a session, settle a bug or take a decision.
const WORTH = /marche|fonctionne|r[ée]solu|r[ée]gl[ée]|corrig[ée]|works?|fixed|solved|demain|soir[ée]e|session|arr[êe]te|bye|night|today|aujourd|termine|on part sur|on garde|on choisit|on prend|d[ée]cid|go with|savais pas|ignorais|didn.t know/i;

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
  // The person's messages, from the transcript (the user lines that are text, not tool results), and the commands that failed.
  const prompts = [];
  let toolErrors = 0;
  try {
    for (const text of readFileSync(String(input?.transcript_path ?? ''), 'utf8').trim().split('\n')) {
      let row;
      try { row = JSON.parse(text); } catch { continue; }
      if (row?.type !== 'user' || row?.isMeta) continue;
      const content = row?.message?.content;
      if (Array.isArray(content)) toolErrors += content.filter((c) => c?.type === 'tool_result' && c?.is_error).length;
      const said = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '';
      if (said && !said.startsWith('<')) prompts.push(said);
    }
  } catch { process.exit(0); }
  const prompt = prompts.pop() ?? '';
  if (!prompt) process.exit(0);
  if (answer.length < 500 && !WORTH.test(prompt.slice(0, 400))) process.exit(0);
  const child = execFile(okb, ['suggest', 'moment', '--stdin', '--json'], { timeout: 6000, env: process.env, ...(input?.cwd ? { cwd: String(input.cwd) } : {}) }, (error, stdout) => {
    if (error) process.exit(0);
    try {
      const out = JSON.parse(String(stdout));
      if (out?.context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: out.context } }));
    } catch { /* nothing to offer */ }
    process.exit(0);
  });
  child.stdin?.end(JSON.stringify({
    prompt: prompt.slice(0, 2000), answer: answer.slice(0, 6000), session: String(input?.session_id ?? ''),
    earlier: prompts.slice(-30).map((p) => p.slice(0, 300)), toolErrors,
  }));
});
setTimeout(() => process.exit(0), 8000).unref();
