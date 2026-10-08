#!/usr/bin/env node
/**
 * PostToolUse (Bash), without AI:
 * - after a `git commit`, the new commits join the journal of the ticket in progress;
 * - when a command or a test fails with an error OKB already knows, its note comes
 *   with its solution, so a solved problem is not debugged twice.
 * Silent otherwise and on any error.
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
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const command = String(input?.tool_input?.command ?? '');
  const cwd = String(input?.cwd ?? '');
  const say = (text) => { if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })); };
  const response = input?.tool_response;
  const output = typeof response === 'string' ? response : [response?.stdout, response?.stderr, response?.output].filter(Boolean).join('\n');
  const failed = /\b(error|erreur|exception|failed|fatal|échec)\b/i.test(output) && !/\bokb\b/.test(command);
  const tasks = [];
  if (cwd && /\bgit\b[^\n|;&]*\bcommit\b/.test(command)) {
    tasks.push(new Promise((done) => execFile(okb, ['ticket', 'commit', '--cwd', cwd, '--json'], { timeout: 6000, maxBuffer: 100_000, env: process.env, cwd }, (error, stdout) => {
      if (error) return done('');
      try { done(JSON.parse(String(stdout))?.context ?? ''); } catch { done(''); }
    })));
  }
  if (failed) {
    tasks.push(new Promise((done) => {
      const child = execFile(okb, ['find', '--stdin', '--error-stdin', '--json'], { timeout: 6000, maxBuffer: 100_000, env: process.env, ...(cwd ? { cwd } : {}) }, (error, stdout) => {
        if (error) return done('');
        try {
          const hits = JSON.parse(String(stdout))?.hits ?? [];
          done(hits.length ? `OKB knows this error: ${hits.map((h) => `${h.title} (${h.path})`).join('; ')} — read it before debugging further.` : '');
        } catch { done(''); }
      });
      child.stdin?.end(output.slice(-6000));
    }));
  }
  if (!tasks.length) process.exit(0);
  Promise.all(tasks).then((texts) => { say(texts.filter(Boolean).join('\n')); process.exit(0); });
});
setTimeout(() => process.exit(0), 8000).unref();
