import { spawn } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });
const ROOT = resolve(import.meta.dirname, '..');
async function fixture() {
  const home = await mkdtemp(resolve(tmpdir(), 'okb hooks with spaces ')); roots.push(home);
  const cli = resolve(home, 'fake cli');
  await writeFile(cli, `#!${process.execPath}\nconst a=process.argv.slice(2); if(process.env.FAKE==='slow')setTimeout(()=>{},10000); else if(process.env.FAKE==='error')process.exit(3); else if(process.env.FAKE==='invalid')console.log('not-json'); else if(a.includes('--json'))console.log(JSON.stringify({ok:true,context:'fixture context',notes:[{title:'Useful note',path:'notes/n.md',why:'fixture'}],root:'fixture',file:'file.ts'})); else console.log('fixture context');`); await chmod(cli, 0o700);
  return { home, cli };
}
async function run(hook: string, input: unknown, env: Record<string,string>) {
  return new Promise<{ stdout: string; stderr: string }>((done, fail) => {
    const p = spawn(process.execPath, [resolve(ROOT, hook)], { env: { ...process.env, ...env }, stdio: ['pipe','pipe','pipe'] }); let stdout=''; let stderr='';
    p.stdout.on('data',(c)=>stdout+=c); p.stderr.on('data',(c)=>stderr+=c); p.on('error',fail); p.on('close',()=>done({stdout,stderr})); p.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
async function log(home: string) { return (await readFile(resolve(home,'hooks','diagnostics.jsonl'),'utf8')).trim().split('\n').map((l)=>JSON.parse(l)); }
describe('Claude hooks are observable and retry failures without content logs', () => {
  it('covers resumed sessions in both manifests', async () => {
    for (const path of ['plugin/hooks/hooks.json','plugins/okb-dev/hooks/hooks.json']) expect(JSON.parse(await readFile(resolve(ROOT,path),'utf8')).hooks.SessionStart[0].matcher).toContain('resume');
  });
  it('uses explicit binary with reduced PATH and spaces, and records version/duration without input values', async () => {
    const { home,cli }=await fixture(); const marker='private-token-never-log';
    const out=await run('plugins/okb-dev/hooks/session-scope.mjs',{cwd:home,source:'resume',prompt:marker},{OKB_HOME:home,OKB_CLI:cli,PATH:'/usr/bin:/bin'});
    expect(JSON.parse(out.stdout).hookSpecificOutput).toMatchObject({hookEventName:'SessionStart',additionalContext:'fixture context'});
    const rows=await log(home); expect(rows).toContainEqual(expect.objectContaining({reason:'context-sent',event:'SessionStart',runtime:process.version})); expect(JSON.stringify(rows)).not.toContain(marker);
  });
  it('reports headless and invalid input silence and permits disabling diagnostics', async () => {
    const {home,cli}=await fixture();
    await run('plugin/hooks/session-focus.mjs',{}, {OKB_HOME:home,OKB_CLI:cli,OKB_HEADLESS:'1'});
    expect(await log(home)).toContainEqual(expect.objectContaining({reason:'headless'}));
    await run('plugins/okb-dev/hooks/session-scope.mjs','broken',{OKB_HOME:home,OKB_CLI:cli});
    expect(await log(home)).toContainEqual(expect.objectContaining({reason:'invalid-input'}));
    const before=await readFile(resolve(home,'hooks','diagnostics.jsonl'),'utf8');
    await run('plugin/hooks/session-focus.mjs',{}, {OKB_HOME:home,OKB_CLI:cli,OKB_HEADLESS:'1',OKB_HOOK_DIAGNOSTICS:'0'});
    expect(await readFile(resolve(home,'hooks','diagnostics.jsonl'),'utf8')).toBe(before);
  });
  it('distinguishes CLI failure, invalid output and timeout', async () => {
    const {home,cli}=await fixture();
    for(const fake of ['error','invalid','slow']) await run('plugins/okb-dev/hooks/session-scope.mjs',{cwd:home},{OKB_HOME:home,OKB_CLI:cli,FAKE:fake,OKB_HOOK_TIMEOUT_MS:fake==='slow' ? '250' : '6000'});
    const rows=await log(home); for(const reason of ['cli-error','invalid-output','timeout']) expect(rows).toContainEqual(expect.objectContaining({reason}));
  });
  it('retries a file lookup that failed and isolates same relative file across repositories', async () => {
    const {home,cli}=await fixture(); const input={cwd:home,session_id:'fixture',tool_input:{file_path:'src/a.ts'}};
    await run('plugins/okb-dev/hooks/file.mjs',input,{OKB_HOME:home,OKB_CLI:cli,FAKE:'error'});
    expect((await run('plugins/okb-dev/hooks/file.mjs',input,{OKB_HOME:home,OKB_CLI:cli})).stdout).toContain('Useful note');
    expect((await run('plugins/okb-dev/hooks/file.mjs',{...input,cwd:ROOT},{OKB_HOME:home,OKB_CLI:cli})).stdout).toContain('Useful note');
  });
  it('gives the notes of five files per session at most (D76)', async () => {
    const {home,cli}=await fixture(); const at=(f: string)=>({cwd:home,session_id:'capped',tool_input:{file_path:`src/${f}.ts`}});
    for (const f of ['a','b','c','d','e']) expect((await run('plugins/okb-dev/hooks/file.mjs',at(f),{OKB_HOME:home,OKB_CLI:cli})).stdout).toContain('Useful note');
    expect((await run('plugins/okb-dev/hooks/file.mjs',at('f'),{OKB_HOME:home,OKB_CLI:cli})).stdout).toBe('');
    expect(await log(home)).toContainEqual(expect.objectContaining({reason:'session-cap'}));
  });
  it('hands a finished conversation to the scribe without a word (D77)', async () => {
    const {home,cli}=await fixture();
    expect((await run('plugin/hooks/session-end.mjs',{cwd:home,session_id:'ended',transcript_path:resolve(home,'ended.jsonl')},{OKB_HOME:home,OKB_CLI:cli})).stdout).toBe('');
    await run('plugin/hooks/session-end.mjs',{cwd:home,session_id:'lost'},{OKB_HOME:home,OKB_CLI:cli});
    const rows=await log(home);
    expect(rows).toContainEqual(expect.objectContaining({reason:'scribe-started',event:'SessionEnd'}));
    expect(rows).toContainEqual(expect.objectContaining({reason:'transcript-unavailable'}));
    expect(JSON.parse(await readFile(resolve(ROOT,'plugin/hooks/hooks.json'),'utf8')).hooks.SessionEnd[0].hooks[0].command).toContain('session-end.mjs');
  });
  it('uses the same runtime contract in an installed/cache module copy', async () => {
    const {home,cli}=await fixture(); const copy=resolve(home,'cache','okb-dev','2.0.0'); await cp(resolve(ROOT,'plugins/okb-dev'),copy,{recursive:true});
    const p=spawn(process.execPath,[resolve(copy,'hooks/session-scope.mjs')],{env:{...process.env,OKB_HOME:home,OKB_CLI:cli,PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']}); let out='';p.stdout.on('data',(c)=>out+=c);p.stdin.end(JSON.stringify({cwd:home,source:'resume'})); await new Promise((r)=>p.on('close',r));expect(out).toContain('fixture context');
    expect(await readFile(resolve(ROOT,'plugin/hooks/runtime.mjs'),'utf8')).toBe(await readFile(resolve(ROOT,'plugins/okb-dev/hooks/runtime.mjs'),'utf8'));
  });
  it('reports a missing explicit engine and expected Stop continuations without a model call', async () => {
    const {home}=await fixture();
    await run('plugins/okb-dev/hooks/session-scope.mjs',{cwd:home},{OKB_HOME:home,OKB_CLI:resolve(home,'absent')});
    await run('plugin/hooks/stop.mjs',{stop_hook_active:true},{OKB_HOME:home});
    const rows=await log(home);
    expect(rows).toContainEqual(expect.objectContaining({reason:'binary-absent'}));
    expect(rows).toContainEqual(expect.objectContaining({reason:'continuation'}));
  });

});
