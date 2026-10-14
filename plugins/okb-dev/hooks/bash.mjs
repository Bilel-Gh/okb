#!/usr/bin/env node
import { createHook } from './runtime.mjs';
const hook=createHook(import.meta.url,'PostToolUse',8000);
const input=await hook.read();
const command=String(input?.tool_input?.command ?? '');
const cwd=typeof input?.cwd==='string' ? input.cwd : undefined;
const response=input?.tool_response;
const output=typeof response==='string' ? response : [response?.stdout,response?.stderr,response?.output].filter(Boolean).join('\n');
const tasks=[];
if(cwd && /\bgit\b[^\n|;&]*\bcommit\b/.test(command))tasks.push(hook.run(['ticket','commit','--cwd',cwd,'--json'],{cwd,json:true}).then((o)=>typeof o?.context==='string' ? o.context : ''));
if(/\b(error|erreur|exception|failed|fatal|échec)\b/i.test(output) && !/\bokb\b/.test(command))tasks.push(hook.run(['find','--stdin','--error-stdin','--json'],{cwd,json:true,stdin:output.slice(-6000)}).then((o)=>Array.isArray(o?.hits) && o.hits.length ? `OKB knows this error: ${o.hits.slice(0,3).map((h)=>`${h.title} (${h.path})`).join('; ')}` : ''));
if(!tasks.length)hook.finish('irrelevant-command');
hook.finish('no-matches',(await Promise.all(tasks)).filter(Boolean).join('\n'));
