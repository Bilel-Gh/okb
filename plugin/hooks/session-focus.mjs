#!/usr/bin/env node
/**
 * SessionStart: hand Claude the user's OKB focus note and the last session's
 * "next time", once, so a new session starts where the last one stopped — and
 * the brief of the scope it opens in: inside a repository OKB documents, its
 * notes, the shared notes tied to it, its connections and the ticket in
 * progress; at the top of a workspace, its repositories and tickets.
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
  // Run in the session's folder: inside a workspace, its KB is the one meant.
  const run = (args) => new Promise((done) => execFile(okb, args, { timeout: 7000, maxBuffer: 200_000, env: process.env, ...(cwd ? { cwd } : {}) }, (error, stdout) => done(error ? '' : String(stdout).trim())));
  Promise.all([run(['focus', '--context']), cwd ? run(['scope', '--context', '--cwd', cwd]) : Promise.resolve('')]).then(([focus, repo]) => {
    const text = [focus, repo].filter(Boolean).join('\n\n');
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
    process.exit(0);
  });
});
setTimeout(() => process.exit(0), 9000).unref();
