#!/usr/bin/env node
/**
 * SessionStart: hand Claude the user's OKB focus note and the last session's
 * "next time", once, so a new session starts where the last one stopped.
 *
 * Prints nothing, and never blocks the session, when OKB is not configured, when
 * there is no focus note or journal yet, or when the profile sets
 * `focus.sessionStart: false`. The text is the user's own data, marked as such.
 */
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const okb = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'okb');

process.stdin.resume();
process.stdin.on('error', () => {});
execFile(okb, ['focus', '--context'], { timeout: 5000, maxBuffer: 200_000, env: process.env }, (error, stdout) => {
  const text = error ? '' : String(stdout).trim();
  if (text) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  }
  process.exit(0);
});
