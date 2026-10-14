#!/usr/bin/env node
import { createHook } from './runtime.mjs';
const hook=createHook(import.meta.url,'PostToolUse',5000);
const input=await hook.read();
if(input?.tool_name && input.tool_name!=='AskUserQuestion')hook.finish('event-not-covered');
await hook.run(['suggest','consent','--stdin'],{cwd: typeof input?.cwd==='string' ? input.cwd : undefined,stdin:JSON.stringify({tool_input:input?.tool_input ?? null,tool_response:input?.tool_response ?? null}),timeout:4000});
hook.finish('consent-processed');
