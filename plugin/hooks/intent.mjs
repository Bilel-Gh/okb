#!/usr/bin/env node
/**
 * UserPromptSubmit: when a message in plain language looks like an OKB task
 * ("ok fin de session", "lis ce transcript", "note ça"), give Claude an OFFER
 * to make: ask the person, with buttons, whether OKB should take over with the
 * matching command. Nothing runs unless the person says yes.
 *
 * At the top of a workspace, a message naming one repository or a ticket
 * narrows OKB's scope to it, and Claude gets that repository's brief.
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
process.stdin.on('end', async () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const prompt = String(input?.prompt ?? '').trim();
  // The person's own yes to a suggestion card (« oui », « garde-la », or a card id they typed):
  // OKB records it, Claude never can (src/suggest/consent.ts).
  const yes = /^\s*(oui|yes|ok(ay)?|d['’]accord|vas[- ]y|go|cr[ée]e[- ]?la|garde[- ]?(la|le|ça|les)?|[ée]cris[- ]?la|ajoute[- ]?la|create( it)?|keep( it)?|write( it)?|sure|yep|ouais)\b/i.test(prompt) && prompt.length <= 60;
  const recorded = yes || /\bS-[0-9a-f]{6}\b/i.test(prompt)
    ? new Promise((done) => execFile(okb, ['suggest', 'consent', '--prompt', prompt.slice(0, 400)], { timeout: 4000, env: process.env, ...(input?.cwd ? { cwd: String(input.cwd) } : {}) }, () => done(null)))
    : Promise.resolve(null);
  // The person named a 🔒 note (« ouvre ma note … », "read my … note"): OKB opens it to Claude for 30 minutes.
  const unlocking = /\b(ouvre|lis|lire|montre|regarde|utilise|open|read|show|use|look at)\b/i.test(prompt) && prompt.length <= 600
    ? new Promise((done) => execFile(okb, ['secret', 'allow', '--prompt', prompt.slice(0, 600), '--json'], { timeout: 4000, env: process.env }, () => done(null)))
    : Promise.resolve(null);
  await unlocking;
  if (!prompt || prompt.startsWith('/') || prompt.length < 4) { await recorded; process.exit(0); }
  // Notices Claude Code delivers as prompts (a background task that ended…) are not the user.
  if (/^<(task-notification|system-reminder|local-command-[a-z]+|command-[a-z]+)>/.test(prompt)) process.exit(0);
  await recorded;
  const args = ['route', '--suggest', '--stdin', '--json', ...(input?.cwd ? ['--cwd', String(input.cwd)] : [])];
  const child = execFile(okb, args, { timeout: 6000, maxBuffer: 200_000, env: process.env, ...(input?.cwd ? { cwd: String(input.cwd) } : {}) }, (error, stdout) => {
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
