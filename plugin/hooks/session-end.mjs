#!/usr/bin/env node
/** D77: when a conversation ends, the scribe reads it in its own process. Nothing is said, nothing waits. */
import { createHook } from './runtime.mjs';
const hook=createHook(import.meta.url,'SessionEnd',4000);
const input=await hook.read();
const file=String(input?.transcript_path ?? '');
if(!file.endsWith('.jsonl'))hook.finish('transcript-unavailable');
await hook.run(['scribe','run','--file',file,'--detach','--json'],{cwd:typeof input?.cwd==='string' ? input.cwd : undefined,json:true,timeout:3000});
hook.finish('scribe-started');
