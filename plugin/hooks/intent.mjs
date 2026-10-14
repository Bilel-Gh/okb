#!/usr/bin/env node
import { createHook } from './runtime.mjs';
const hook=createHook(import.meta.url,'UserPromptSubmit',10000);
const input=await hook.read();
const prompt=String(input?.prompt ?? '').trim();
const cwd=typeof input?.cwd==='string' ? input.cwd : undefined;
const yes=/^\s*(oui|yes|ok(ay)?|d['’]accord|vas[- ]y|go|cr[ée]e[- ]?la|garde[- ]?(la|le|ça|les)?|[ée]cris[- ]?la|ajoute[- ]?la|create( it)?|keep( it)?|write( it)?|sure|yep|ouais)\b/i.test(prompt) && prompt.length<=60;
if(yes || /\bS-[0-9a-f]{6}\b/i.test(prompt))await hook.run(['suggest','consent','--prompt',prompt.slice(0,400)],{cwd,timeout:4000});
if(/\b(ouvre|lis|lire|montre|regarde|utilise|open|read|show|use|look at)\b/i.test(prompt) && prompt.length<=600)await hook.run(['secret','allow','--prompt',prompt.slice(0,600),'--json'],{json:true,timeout:4000});
if(!prompt || prompt.startsWith('/') || prompt.length<4)hook.finish('excluded-prompt');
if(/^<(task-notification|system-reminder|local-command-[a-z]+|command-[a-z]+)>/.test(prompt))hook.finish('agent-notification');
const out=await hook.run(['route','--suggest','--stdin','--json',...(cwd ? ['--cwd',cwd] : [])],{cwd,json:true,stdin:prompt.slice(0,20000)});
hook.finish('no-suggestion',typeof out?.context==='string' ? out.context : '');
