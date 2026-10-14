#!/usr/bin/env node
/** Suggestions stay nonblocking; no AI call and no note mutation. */
import { open } from 'node:fs/promises';
import { createHook } from './runtime.mjs';
const hook=createHook(import.meta.url,'Stop',8000);
const input=await hook.read();
if(input?.stop_hook_active)hook.finish('continuation');
const answer=String(input?.last_assistant_message ?? '');
const WORTH=/marche|fonctionne|r[ée]solu|r[ée]gl[ée]|corrig[ée]|works?|fixed|solved|demain|soir[ée]e|session|arr[êe]te|bye|night|today|aujourd|termine|on part sur|on garde|on choisit|on prend|d[ée]cid|go with|savais pas|ignorais|didn.t know/i;
const prompts=[];let toolErrors=0;let handle;
try {
  handle=await open(String(input?.transcript_path ?? ''),'r');
  const stat=await handle.stat();const size=Math.min(stat.size,2_000_000);const buffer=Buffer.alloc(size);
  const {bytesRead}=await handle.read(buffer,0,size,Math.max(0,stat.size-size));
  const rows=buffer.subarray(0,bytesRead).toString('utf8').split('\n');
  if(stat.size>size) {rows.shift();hook.trace('transcript-window');}
  for(const text of rows){
    let row;try{row=JSON.parse(text);}catch{continue;}
    if(row?.type!=='user' || row?.isMeta)continue;
    const content=row?.message?.content;
    if(Array.isArray(content))toolErrors+=content.filter((c)=>c?.type==='tool_result' && c?.is_error).length;
    const said=typeof content==='string' ? content : Array.isArray(content) ? content.filter((c)=>c?.type==='text').map((c)=>c.text).join('\n') : '';
    if(said && !said.startsWith('<'))prompts.push(said);
  }
}catch{hook.finish('transcript-unavailable');}finally{await handle?.close().catch(()=>{});}
const prompt=prompts.pop() ?? '';
if(!prompt)hook.finish('no-user-prompt');
if(answer.length<500 && !WORTH.test(prompt.slice(0,400)))hook.finish('short-exchange');
const out=await hook.run(['suggest','moment','--stdin','--json'],{cwd:typeof input?.cwd==='string' ? input.cwd : undefined,json:true,stdin:JSON.stringify({prompt:prompt.slice(0,2000),answer:answer.slice(0,6000),session:String(input?.session_id ?? ''),earlier:prompts.slice(-30).map((p)=>p.slice(0,300)),toolErrors})});
hook.finish('no-suggestion',typeof out?.context==='string' ? out.context : '');
