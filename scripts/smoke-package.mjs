import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(join(tmpdir(),'okb-package-'));
const env={...process.env,OKB_HOME:join(temp,'home'),OKB_PROFILE:'smoke'};
for(const key of ['OKB_KB_ROOT','OKB_ORG_CONFIG','OKB_TEAM_CONFIG','OKB_STATE_HOME','OKB_APPLY_MODE','OKB_CONCEPT_ASSIST']) delete env[key];
const npmCli=process.env.npm_execpath;
if(!npmCli) throw new Error('Run this check with npm run smoke:package.');
function run(bin,args,extra={}) { return execFileSync(bin,args,{cwd:temp,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],...extra}); }
async function smokeReader(bin, proposalId) {
  const child = spawn(process.execPath, [bin, 'serve', '--port', '0', '--json'], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    const { url } = await new Promise((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(() => reject(new Error('local reader startup timed out')), 10000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); reject(new Error(`local reader exited ${code}: ${stderr}`)); });
      child.stdout.on('data', chunk => {
        stdout += chunk;
        try { const ready = JSON.parse(stdout); clearTimeout(timer); resolve(ready); } catch { /* wait for complete JSON */ }
      });
    });
    const page = await fetch(url);
    assert.equal(page.status, 200);
    // The installed package ships the app (built into web/app) on « / ».
    const home = await page.text();
    const entry = /src="(\/app\/assets\/[^"]+\.js)"/.exec(home)?.[1];
    assert(entry, 'the new web app is in the package');
    assert.equal((await fetch(`${url}${entry}`)).status, 200, entry);
    assert.equal((await fetch(`${url}/classic`, { redirect: 'manual' })).status, 302);
    for (const asset of ['/favicon.svg', '/vendor/mermaid.js']) assert.equal((await fetch(`${url}${asset}`)).status, 200, asset);
    assert.equal((await fetch(`${url}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"x"}' })).status, 403);
    assert((await (await fetch(`${url}/api/status`)).json()).name);
    assert((await (await fetch(`${url}/api/search?q=dispatcher`)).json()).hits.length > 0);
    const preview = await (await fetch(`${url}/api/proposal?id=${proposalId}`)).json();
    assert(preview.guard.ok && preview.files.some(file => file.after.includes('DRX')));
  } finally {
    child.kill('SIGTERM');
    await closed;
  }
}
try {
  const packed=JSON.parse(run(process.execPath,[npmCli,'pack','--json','--pack-destination',temp],{cwd:root}))[0];
  assert(!packed.files.some(f=>/^(?:\.dev|tests|src|node_modules)\//.test(f.path)));
  // Sync tools (iCloud, Dropbox) leave "name 2.js" copies beside files they saw change.
  assert(!packed.files.some(f=>/ \d+(?:\.[^/]*)?(?:\/|$)/.test(f.path)), 'conflict copies (" 2") in the package');
  run(process.execPath,[npmCli,'install','--ignore-scripts','--no-audit','--no-fund','--omit=dev','--prefix',join(temp,'install'),join(temp,packed.filename)]);
  const bin=join(temp,'install/node_modules/okb/dist/cli/index.js');
  const cli=(args)=>JSON.parse(run(process.execPath,[bin,...args,'--json']));
  const vault=join(temp,'vault'); await cp(join(root,'tests/fixtures/vault-acme'),vault,{recursive:true});
  const setup=cli(['setup','--profile','smoke','--kb-root',vault,'--concept-assist','targeted']); assert(setup.ok);
  assert(cli(['doctor']).ok);
  const source=join(root,'tests/fixtures/sources/weekly-sync.vtt');
  const first=cli(['ingest',source,'--extract-only','--limit','2']);
  const blockIds=first.blocks.map(b=>b.id); let cursor=first.truncation.nextCursor;
  while(cursor!==null) { const page=cli(['ingest',source,'--extract-only','--run',first.runId,'--cursor',cursor,'--limit','2']); blockIds.push(...page.blocks.map(b=>b.id));cursor=page.truncation.nextCursor; }
  const snapshot=JSON.parse(await readFile(join(temp,'home/profiles/smoke/state/runs',first.runId,'source.json'),'utf8'));
  assert.equal(new Set(blockIds).size,snapshot.blocks.length);
  const b=snapshot.blocks.find(b=>b.text.includes('not a pipeline'));
  const analysis={version:1,sourceSha256:snapshot.source.sha256,reviewedBlockIds:blockIds,sections:[{heading:'Correction',claims:[{id:'broker',text:'DRX is a queue broker, not a pipeline.',kind:'reported',evidence:[{blockId:b.id,quote:b.text}]}]}],concepts:[],corrections:[],openQuestions:[]};
  const dossier=join(temp,'dossier.json');await writeFile(dossier,JSON.stringify(analysis));
  const p=cli(['ingest',source,'--run',first.runId,'--analysis-file',dossier,'--create','notes/smoke.md','--title','Smoke']);
  const review=cli(['review',p.proposalId,'--diff']);assert(review.diffs.length>0);
  await smokeReader(bin, p.proposalId);
  cli(['review',p.proposalId,'--approve']);
  const r=cli(['apply',p.proposalId]).receipt;assert(r.complete);
  assert((await readFile(join(vault,'notes/smoke.md'),'utf8')).includes('[DRX](../concepts/drx.md)'));
  assert(cli(['links','check']).issues.every(i=>i.level!=='error'));
  cli(['apply','--rollback',r.id]);
  console.log(JSON.stringify({ok:true,package:packed.filename,version:packed.version,flow:'clean install → setup → paged extraction → analysis → preview → local reader → approve → apply → links → rollback'}));
} finally { await rm(temp,{recursive:true,force:true}); }
