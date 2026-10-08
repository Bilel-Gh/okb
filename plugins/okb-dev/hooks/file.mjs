#!/usr/bin/env node
/**
 * PostToolUse (Read, Edit, Write): when Claude opens or changes a file of a
 * repository OKB documents, the notes about that file come to it — once per
 * file and session, in one line each. Without AI; silent when there is none.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { okbPath } from './okb-path.mjs';

const okb = okbPath();
if (!okb) process.exit(0);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const file = String(input?.tool_input?.file_path ?? input?.tool_input?.path ?? '');
  if (!file || /\.(md|lock|png|jpe?g|svg|ico)$/i.test(file) || /node_modules|\/\.git\//.test(file)) process.exit(0);
  // Once per file and session.
  const seenFile = join(tmpdir(), `okb-seen-${String(input?.session_id ?? 'x').replace(/[^\w-]/g, '')}.json`);
  let seen = [];
  try { seen = JSON.parse(readFileSync(seenFile, 'utf8')); } catch { /* first one */ }
  if (seen.includes(file)) process.exit(0);
  execFile(okb, ['find', '--file', file, '--json'], { timeout: 5000, env: process.env, ...(input?.cwd ? { cwd: String(input.cwd) } : {}) }, (error, stdout) => {
    try { writeFileSync(seenFile, JSON.stringify([...seen, file].slice(-300))); } catch { /* best effort */ }
    if (error) process.exit(0);
    try {
      const out = JSON.parse(String(stdout));
      const notes = (out?.notes ?? []).slice(0, 3);
      if (notes.length) {
        const lines = notes.map((n) => `- ${n.title} — ${out.root}/${n.path} (${n.why})`);
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `OKB notes about ${out.file} (read the relevant one before changing it; cite it):\n${lines.join('\n')}` } }));
      }
    } catch { /* nothing */ }
    process.exit(0);
  });
});
setTimeout(() => process.exit(0), 7000).unref();
