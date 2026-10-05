#!/usr/bin/env node
/**
 * UserPromptSubmit: when a message in plain language looks like an OKB task
 * ("ok fin de session", "lis ce transcript", "note ça"), give Claude an OFFER
 * to make: ask the person, with buttons, whether OKB should take over with the
 * matching command. Nothing runs unless the person says yes.
 *
 * Silent for slash commands, when OKB is not set up, when the profile turns
 * suggestions off (routing.suggest: false) and for requests that name another
 * knowledge tool. Never blocks the prompt; any failure means no suggestion.
 */
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const okb = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'okb');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const prompt = String(input?.prompt ?? '').trim();
  if (!prompt || prompt.startsWith('/') || prompt.length < 4) process.exit(0);
  // Notices Claude Code delivers as prompts (a background task that ended…) are not the user.
  if (/^<(task-notification|system-reminder|local-command-[a-z]+|command-[a-z]+)>/.test(prompt)) process.exit(0);
  const args = ['route', '--suggest', '--stdin', '--json', ...(input?.cwd ? ['--cwd', String(input.cwd)] : [])];
  const child = execFile(okb, args, { timeout: 4000, maxBuffer: 200_000, env: process.env }, (error, stdout) => {
    if (error) process.exit(0);
    try {
      const out = JSON.parse(String(stdout));
      if (out?.context) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: out.context } }));
      }
    } catch { /* no suggestion */ }
    process.exit(0);
  });
  child.stdin?.end(prompt.slice(0, 20_000));
});
