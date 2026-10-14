#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHook } from './runtime.mjs';
const hook = createHook(import.meta.url, 'PostToolUse', 7000);
const input = await hook.read();
const file = String(input?.tool_input?.file_path ?? input?.tool_input?.path ?? '');
if (!file || /\.(md|lock|png|jpe?g|svg|ico)$/i.test(file) || /node_modules|\/\.git\//.test(file)) hook.finish('excluded-file');
const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
// Hash identity includes cwd, profile/home and absolute file, preventing collisions across repos and profiles.
const digest = (v) => createHash('sha256').update(v).digest('hex');
const dir = resolve(process.env.OKB_HOME || resolve(homedir(), '.okb'), 'hooks');
const seenFile = resolve(dir, `seen-${digest(String(input?.session_id ?? '') + cwd).slice(0,24)}.json`);
const key = digest(resolve(cwd,file));
let seen=[];
try { const saved=JSON.parse(readFileSync(seenFile,'utf8')); if(Array.isArray(saved))seen=saved; } catch { /* first lookup */ }
if(seen.includes(key))hook.finish('already-sent');
const out=await hook.run(['find','--file',file,'--json'], {cwd,json:true,timeout:5000});
if (!out) hook.finish('lookup-failed');
const notes = Array.isArray(out.notes) ? out.notes.slice(0,3) : [];
if (!notes.length) hook.finish('no-notes');
// Mark only delivered lookups. A failure or empty result is retryable after configuration/source changes.
try { mkdirSync(dir,{recursive:true,mode:0o700}); writeFileSync(seenFile,JSON.stringify([...seen,key].slice(-300)),{mode:0o600}); } catch { hook.trace('dedup-write-failed'); }
hook.finish('no-notes',`OKB notes about ${out.file}:\n${notes.map((n)=>`- ${n.title} — ${out.root}/${n.path} (${n.why})`).join('\n')}`);
