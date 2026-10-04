#!/usr/bin/env node
/**
 * SessionStart: hand Claude the user's OKB focus note and the last session's
 * "next time", once, so a new session starts where the last one stopped — and,
 * inside a code repository OKB documents, where that repository's notes are.
 *
 * Prints nothing, and never blocks the session, when OKB is not configured, when
 * there is no focus note or journal yet, or when the profile sets
 * `focus.sessionStart: false`. The text is the user's own data, marked as such.
 */
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const okb = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'okb');

// The session's folder comes on stdin: inside a repository OKB documents, Claude
// also gets that repository's notes and open questions.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('error', () => {});
process.stdin.on('end', () => {
  let cwd = '';
  try { cwd = String(JSON.parse(raw)?.cwd ?? ''); } catch { /* no input */ }
  const run = (args) => new Promise((done) => execFile(okb, args, { timeout: 5000, maxBuffer: 200_000, env: process.env }, (error, stdout) => done(error ? '' : String(stdout).trim())));
  Promise.all([run(['focus', '--context']), cwd ? run(['repo', 'context', '--cwd', cwd]) : Promise.resolve('')]).then(([focus, repo]) => {
    const text = [focus, repo].filter(Boolean).join('\n\n');
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
    process.exit(0);
  });
});
setTimeout(() => process.exit(0), 9000).unref();
