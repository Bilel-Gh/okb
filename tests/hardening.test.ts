import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { makeSandbox, type Sandbox, FIXTURE_SOURCES } from './helpers/sandbox.js';
import { runSetup } from '../src/setup/setup.js';
import { loadConfig } from '../src/config/load.js';
import { retainAcquired } from '../src/sources/retention.js';
import { requireCleanGitTree, commitKbChanges } from '../src/apply/git.js';
import { applyProposal, rollback } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { checkPathPolicy } from '../src/apply/guard.js';
import { withBundleLock } from '../src/apply/lock.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { validateAnalysis, type SourceAnalysis } from '../src/pipeline/analysis.js';
import { proposeFiles } from '../src/proposal/files.js';
import { computeProposalHash, resolveSelection } from '../src/proposal/model.js';
import { saveProposal, loadProposal, updateProposalStatus } from '../src/proposal/store.js';
import { materializeFile } from '../src/proposal/materialize.js';
import { acquire, acquireUrl, extractSource } from '../src/sources/registry.js';
import { asBundlePath, assertInsideRoot } from '../src/util/paths.js';
import { portableLink, classifyLink } from '../src/links/portable.js';
import { parseOkf } from '../src/okf/document.js';
import { validateDocument } from '../src/okf/validate.js';
import { planMigration } from '../src/migrate/migrate.js';
import * as fsx from '../src/util/fsx.js';

const boxes: Sandbox[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(boxes.splice(0).map(s => s.cleanup())); });
async function box() { const s = await makeSandbox({ profileId: 'test' }); boxes.push(s); return s; }
async function fixture() {
  const s = await box(); const config = await s.config();
  const doc = await extractSource(await acquire(resolve(FIXTURE_SOURCES,'weekly-sync.vtt'),config),config);
  const analysis: SourceAnalysis = {
    version: 1, sourceSha256: doc.source.sha256, reviewedBlockIds: doc.blocks.map(b => b.id), summary: '',
    sections: [{ heading: 'Broker', claims: [{ id: 'broker', text: 'DRX est un courtier de files, pas un pipeline.', kind: 'reported', evidence: [{ blockId: doc.blocks[4]!.id, quote: doc.blocks[4]!.text }] }] }], concepts: [],
    corrections: [{ earlierBlockId: doc.blocks[0]!.id, laterBlockId: doc.blocks[4]!.id, note: 'La description initiale comme pipeline est corrigée.' }], openQuestions: [],
  };
  const p = (await prepareProposal(config, doc, { target: { mode: 'create', path: asBundlePath('notes/broker.md'), title: 'Broker' }, analysis })).proposal;
  await saveProposal(config,p);
  return { s,config,doc,analysis,p };
}
const approve = async (f: Awaited<ReturnType<typeof fixture>>, ids = f.p.changes.map(c => c.id)) => grantApproval(f.config,f.p,ids,'human:test');

describe('trust boundaries', () => {
  it('refuses a discarded proposal even when an earlier exact approval remains', async () => {
    const f = await fixture();
    await approve(f);
    await updateProposalStatus(f.config, f.p.id, 'superseded');
    const discarded = await loadProposal(f.config, f.p.id);
    await expect(grantApproval(f.config, discarded, discarded.changes.map(c => c.id), 'human:test')).rejects.toMatchObject({ code: 'E_CONFLICT' });
    await expect(applyProposal(f.config, discarded)).rejects.toMatchObject({ code: 'E_CONFLICT', message: expect.stringContaining('superseded') });
    await expect(readFile(resolve(f.s.vault, 'notes/broker.md'))).rejects.toThrow();
  });
  it('rejects a payload altered without changing its claimed hash', async () => {
    const f = await fixture(); await approve(f);
    const changed = { ...f.p, changes: f.p.changes.map((c,i) => i ? c : { ...c, createDocument: { content: 'hijacked' } }) };
    await expect(applyProposal(f.config,changed)).rejects.toMatchObject({ code: 'E_APPROVAL_MISMATCH' });
    await expect(readFile(resolve(f.s.vault,'notes/broker.md'))).rejects.toThrow();
  });
  it('also binds evidence, dependencies and the profile to an approval', async () => {
    const f = await fixture();
    expect(computeProposalHash({ ...f.p, evidence: [] })).not.toBe(f.p.contentHash);
    expect(computeProposalHash({ ...f.p, profileId: 'other' })).not.toBe(f.p.contentHash);
  });
  it('rejects a subset of an approval whose materialised diff differs', async () => {
    const f = await fixture(); await approve(f);
    await expect(applyProposal(f.config,f.p,{only:['c-article']})).rejects.toMatchObject({ code: 'E_APPROVAL_MISMATCH' });
  });
  it('refuses state and profile traversal before creating anything', async () => {
    const s = await box(); const config = await s.config();
    await expect(loadProposal(config,'../../oops')).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(runSetup({ profileId:'../escape', kbRoot:s.vault,conceptAssist:'off' }, {env:s.env})).rejects.toMatchObject({ code:'E_INVALID' });
    expect(() => asBundlePath('/tmp/outside.md')).toThrow();
    expect(() => asBundlePath('..\\outside.md')).toThrow();
  });
  it('refuses state inside the KB, including through a symlink', async () => {
    const s = await box(); await symlink(s.vault,resolve(s.dir,'alias'));
    await expect(loadConfig({env:{...s.env,OKB_STATE_HOME:resolve(s.dir,'alias','state')}})).rejects.toMatchObject({code:'E_CONFIG'});
  });
  it('rejects dangling symlinks before writing to a missing outside directory', async () => {
    const s = await box(); await symlink(resolve(s.dir,'missing'),resolve(s.vault,'escape'));
    await expect(assertInsideRoot(s.vault,'escape/n.md')).rejects.toMatchObject({code:'E_FORBIDDEN_PATH'});
  });
  it('keeps org ceilings when a personal policy explicitly tries to widen them', async () => {
    const s = await box(); const org = resolve(s.dir,'org.yaml');
    await writeFile(org,'policy:\n  allowDirectApply: false\n  maxApplyFiles: 2\n  writeAllow: ["concepts/**"]\n  writeDeny: ["concepts/private.md"]\n');
    const profile = resolve(s.home,'profiles/test/profile.yaml');
    const data = YAML.parse(await readFile(profile,'utf8'));
    data.policy = { allowDirectApply:true,maxApplyFiles:500,writeAllow:['**'],writeDeny:[] }; data.changes = {apply:'allow-direct'};
    await writeFile(profile,YAML.stringify(data));
    const {config} = await loadConfig({env:s.env,orgConfigPath:org});
    expect(config.policy.maxApplyFiles).toBe(2); expect(config.changes.apply).toBe('require-approval');
    expect(checkPathPolicy(config,asBundlePath('flows/f.md'))).not.toBeNull();
    expect(checkPathPolicy(config,asBundlePath('concepts/private.md'))).not.toBeNull();
  });
  it('fails closed for a declared but missing org policy', async () => {
    const s = await box();
    await expect(loadConfig({env:s.env,orgConfigPath:resolve(s.dir,'gone.yaml')})).rejects.toMatchObject({code:'E_CONFIG'});
  });
});

describe('transactions', () => {
  it('preserves an external edit between the guard and staging of an approved replacement', async () => {
    const s = await box();
    const config = await s.config();
    const path = asBundlePath('flows/run-a-delivery-job.md');
    const file = resolve(s.vault, path);
    const bundle = await loadBundleFor(config);
    const before = await readFile(file, 'utf8');
    const p = proposeFiles(config, bundle, new Map([[path, before + '\nApproved new prose.\n']]), 'Test replacement');
    await saveProposal(config, p);
    await grantApproval(config, p, p.changes.map(c => c.id), 'human:test');
    const humanEdit = before + '\nA concurrent edit by the reader.\n';
    const original = fsx.readTextIfExists;
    let edited = false;
    vi.spyOn(fsx, 'readTextIfExists').mockImplementation(async path => {
      const text = await original(path);
      if (path === file && !edited) { edited = true; await writeFile(file, humanEdit); }
      return text;
    });
    await expect(applyProposal(config, p)).rejects.toMatchObject({ code: 'E_STALE' });
    expect(await readFile(file, 'utf8')).toBe(humanEdit);
    expect(await readdir(resolve(config.stateHome, 'receipts'))).toEqual([]);
  });
  it('rechecks links on resume when an untouched target disappeared after the interruption', async () => {
    const s = await box();
    const config = await s.config();
    const linked = resolve(s.vault, 'concepts/idempotence.md');
    const source = await readFile(linked, 'utf8');
    const text = '---\ntype: Reference\ntitle: Recovery\ndescription: A fictional recovery test.\nstatus: draft\ngenerated: { by: "human:test", at: "2026-01-15T09:40:00Z" }\nsources: [{ resource: "concepts/idempotence.md" }]\n---\n\n# Recovery\n\nSee [Idempotence](../concepts/idempotence.md).\n';
    const p = proposeFiles(config, await loadBundleFor(config), new Map([['notes/recovery.md', text]]), 'Test recovery');
    await saveProposal(config, p);
    await grantApproval(config, p, p.changes.map(c => c.id), 'human:test');
    const original = fsx.writeTextAtomic;
    vi.spyOn(fsx, 'writeTextAtomic').mockImplementation(async (path, text) => {
      if (path.startsWith(s.vault + '/')) throw new Error('interrupted before first note write');
      await original(path, text);
    });
    await expect(applyProposal(config, p)).rejects.toThrow('interrupted');
    vi.restoreAllMocks();
    await rm(linked);
    await expect(applyProposal(config, p, { resume: true })).rejects.toMatchObject({ code: 'E_INVALID', message: expect.stringContaining('links') });
    await expect(readFile(resolve(s.vault, 'notes/recovery.md'))).rejects.toThrow();
    await writeFile(linked, source);
    expect((await applyProposal(config, p, { resume: true })).complete).toBe(true);
  });
  it('resumes the rename-before-journal crash window and keeps all backups for rollback', async () => {
    const f = await fixture(); await approve(f);
    const original = fsx.writeTextAtomic;
    let crashed = false;
    vi.spyOn(fsx,'writeTextAtomic').mockImplementation(async (path,text) => {
      await original(path,text);
      if (!crashed && path.startsWith(f.s.vault + '/')) { crashed = true; throw new Error('simulated interruption after rename'); }
    });
    await expect(applyProposal(f.config,f.p)).rejects.toThrow('simulated interruption');
    vi.restoreAllMocks();
    const receipt = await applyProposal(f.config,f.p,{resume:true});
    expect(receipt.complete).toBe(true);
    await rollback(f.config,receipt.id);
    await expect(readFile(resolve(f.s.vault,'notes/broker.md'))).rejects.toThrow();
    await expect(readFile(resolve(f.s.vault,'concepts/drx.md'))).rejects.toThrow();
  });
  it('rolls back an interrupted apply even before a completed receipt exists', async () => {
    const f = await fixture(); await approve(f); const original = fsx.writeTextAtomic;
    vi.spyOn(fsx,'writeTextAtomic').mockImplementation(async (path,text) => { await original(path,text); if (path.startsWith(f.s.vault+'/')) throw new Error('crash'); });
    await expect(applyProposal(f.config,f.p)).rejects.toThrow(); vi.restoreAllMocks();
    await rollback(f.config,`rcpt-${f.p.id}`);
    await expect(readFile(resolve(f.s.vault,'notes/broker.md'))).rejects.toThrow();
  });
  it('preflights a rollback and preserves a later user edit', async () => {
    const f = await fixture(); await approve(f); const r = await applyProposal(f.config,f.p);
    const file = resolve(f.s.vault,'notes/broker.md'); const changed = (await readFile(file,'utf8'))+'\nLater human work.\n'; await writeFile(file,changed);
    await expect(rollback(f.config,r.id)).rejects.toMatchObject({code:'E_CONFLICT'});
    expect(await readFile(file,'utf8')).toBe(changed);
    expect(await readFile(resolve(f.s.vault,'concepts/drx.md'),'utf8')).toContain('Delivery');
  });
  it('a dry run does not create a receipt or journal', async () => {
    const f = await fixture(); await approve(f); const before = await readdir(resolve(f.config.stateHome,'runs'));
    await applyProposal(f.config,f.p,{dryRun:true});
    expect(await readdir(resolve(f.config.stateHome,'runs'))).toEqual(before);
    expect(await readdir(resolve(f.config.stateHome,'receipts'))).toEqual([]);
    await applyProposal(f.config,f.p); // no spurious interrupted-run error
  });
  it('refuses disabling backups instead of deleting an old file on rollback', async () => {
    const f = await fixture(); await approve(f);
    await expect(applyProposal({...f.config,changes:{...f.config.changes,keepBackups:false}},f.p)).rejects.toMatchObject({code:'E_CONFIG'});
  });
  it('serialises local writers by physical bundle, across profiles', async () => {
    const s = await box(); let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(r => entered=r);
    const held = withBundleLock(s.vault, async () => { entered(); await new Promise<void>(r => release=r); });
    await ready;
    await expect(withBundleLock(s.vault,async () => 1)).rejects.toMatchObject({code:'E_CONFLICT'});
    release(); await held;
    expect(await withBundleLock(s.vault,async () => 2)).toBe(2);
  });
  it('rejects all-or-nothing move subsets', async () => {
    const s=await box(); const config=await s.config(); const bundle=await loadBundleFor(config);
    const from='concepts/dispatcher.md';
    const p=proposeFiles(config,bundle,new Map([[from,null],['reference/new.md',bundle.snapshot.files.get(asBundlePath(from))!]]),'move',true);
    expect(resolveSelection(p,[p.changes[0]!.id]).accepted).toEqual([]);
  });
});

describe('coverage and concepts', () => {
  it('rejects incomplete reading, wrong source bytes and fabricated quotes', async () => {
    const f=await fixture();
    expect(() => validateAnalysis({...f.analysis,reviewedBlockIds:f.analysis.reviewedBlockIds.slice(0,-1)},f.doc)).toThrow(/every/);
    expect(() => validateAnalysis({...f.analysis,sourceSha256:'0'.repeat(64)},f.doc)).toThrow(/different/);
    const bad=structuredClone(f.analysis); bad.sections[0]!.claims[0]!.evidence[0]!.quote='fabricated source';
    expect(() => validateAnalysis(bad,f.doc)).toThrow(/verbatim/);
  });
  it('creates clickable terms in a newly written article and can refuse just the new concept', async () => {
    const f=await fixture(); const link=f.p.changes.find(c => c.category==='link' && c.dependsOn.some(d => d.startsWith('c-concept-')));
    expect(link).toBeDefined();
    expect(f.p.changes.some(c => c.path.includes('zqt'))).toBe(false);
    const selected=f.p.changes.filter(c => c.category!=='concept-card').map(c => c.id);
    const resolved=resolveSelection(f.p,selected); expect(resolved.accepted).not.toContain(link!.id);
    await approve(f,resolved.accepted); await applyProposal(f.config,f.p,{only:resolved.accepted});
    const note=await readFile(resolve(f.s.vault,'notes/broker.md'),'utf8');
    expect(note).toContain('DRX est'); expect(note).not.toContain('[DRX]');
  });
  it('accepted concept links use the containing file and preserve the late correction', async () => {
    const f=await fixture(); await approve(f); await applyProposal(f.config,f.p);
    const note=await readFile(resolve(f.s.vault,'notes/broker.md'),'utf8');
    expect(note).toContain('[DRX](../concepts/drx.md)'); expect(note).toContain('pas un pipeline');
    expect(note).not.toContain('file://');
    const fm=parseOkf('notes/broker.md',note).data;
    const ids=new Set((fm.sources ?? []).map(s => s.id));
    for (const m of note.matchAll(/\[\^([^\]]+)\]/g)) expect(ids.has(m[1])).toBe(true);
  });
  it('splits giant blocks without loss', async () => {
    const s=await box(); const c=await s.config(); const text='Révision '.repeat(5000);
    const doc=await extractSource({uri:'fixture://long.txt',filename:'long.txt',bytes:Buffer.from(text)},c);
    expect(doc.blocks.map(b=>b.text).join('')).toBe(text.trim());
    expect(doc.blocks.every(b=>b.text.length<=4000)).toBe(true);
  });
  it('includes evidence for claims introduced beyond block forty', async () => {
    const s=await box(); const config=await s.config();
    const text=Array.from({length:60},(_,i)=>`Paragraph ${i}: a distinct source statement.`).join('\n\n');
    const doc=await extractSource({uri:'fixture://many.md',filename:'many.md',bytes:Buffer.from(text)},config);
    const block=doc.blocks[55]!;
    const analysis={version:1,sourceSha256:doc.source.sha256,reviewedBlockIds:doc.blocks.map(b=>b.id),sections:[{heading:'Late fact',claims:[{id:'late',text:block.text,kind:'reported',evidence:[{blockId:block.id,quote:block.text}]}]}]};
    const p=(await prepareProposal(config,doc,{target:{mode:'create',path:asBundlePath('late.md'),title:'Late'},analysis,conceptAssistLevel:'off'})).proposal;
    expect(p.evidence.some(e=>e.blockIds.includes(block.id) && e.quote===block.text)).toBe(true);
    expect(p.analysis?.reviewedBlockIds).toHaveLength(doc.blocks.length);
  });
  it('refuses unsupported extraction instead of inventing a note', async () => {
    const f=await fixture();
    await expect(prepareProposal(f.config,{...f.doc,blocks:[],source:{...f.doc.source,support:'unsupported'}},{target:{mode:'create',path:asBundlePath('absent.md'),title:'Absent'}})).rejects.toMatchObject({code:'E_UNSUPPORTED'});
  });
});

describe('portability and acquisition', () => {
  it('round-trips special filename characters in relative links', () => {
    const name='concepts/a#b% c(d).md'; const url=portableLink('flows/x.md',name);
    expect(classifyLink(url,'flows/x.md').target).toBe(name);
    expect(() => classifyLink('#bad%zz','a.md')).not.toThrow();
  });
  it('checks images against real assets instead of flagging all as missing', async () => {
    const s=await box(); await writeFile(resolve(s.vault,'image.png'),Buffer.from([1,2]));
    expect((await loadBundleFor(await s.config())).snapshot.files.has(asBundlePath('image.png'))).toBe(true);
  });
  it('rewrites reference-style links by AST position and protects inline code and quotes', async () => {
    const s=await box(); const config=await s.config();
    await writeFile(resolve(s.vault,'legacy.md'),'---\ntype: Reference\n---\n\n`[[Dispatcher]]`\n\n> [[Dispatcher]]\n\n[[Dispatcher]]\n\n[open][d]\n\n[d]: /concepts/dispatcher.md "title"\n');
    const plan=await planMigration(config,'portable-links');
    const change=plan.proposal.changes.find(c=>c.path==='legacy.md')!;
    const text=change.replaceDocument!.content;
    expect(text).toContain('`[[Dispatcher]]`'); expect(text).toContain('> [[Dispatcher]]');
    expect(text).toContain('[d]: concepts/dispatcher.md "title"');
  });
  it('validates every redirect against the allow-list before fetching it', async () => {
    const s=await box(); const c=await s.config(); const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://outside.invalid/private'}})); vi.stubGlobal('fetch',fetcher);
    await expect(acquireUrl('https://allowed.invalid/a',{...c,connectors:{...c.connectors,web:{enabled:true,allowDomains:['allowed.invalid']}}})).rejects.toMatchObject({code:'E_FORBIDDEN_PATH'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains only optional acquired copies, with configured text redaction', async () => {
    const s=await box(); const c=await s.config();
    const acquired={uri:'fixture://note.txt',filename:'note.txt',bytes:Buffer.from('The private-marker is mentioned.')};
    const doc=await extractSource(acquired,c);
    const config={...c,sources:{...c.sources,retention:{...c.sources.retention,mode:'copy' as const,redactPatterns:['private-marker']}}};
    await retainAcquired(config,acquired,doc);
    const names=await readdir(resolve(config.stateHome,'sources'));
    const copied=names.find(n=>n.endsWith('.txt'))!;
    expect(await readFile(resolve(config.stateHome,'sources',copied),'utf8')).toBe('The [REDACTED] is mentioned.');
    expect(doc.blocks[0]!.text).toContain('private-marker'); // working evidence is intentionally unchanged
    await expect(retainAcquired({...config,sources:{...config.sources,retention:{...config.sources.retention,dir:'../escape'}}},acquired,doc)).rejects.toMatchObject({code:'E_FORBIDDEN_PATH'});
  });
  it('does not pretend to enforce an unavailable clean-Git policy; autoCommit outside a repository commits nothing', async () => {
    const s=await box(); const c=await s.config();
    await expect(requireCleanGitTree({...c,git:{...c.git,requireCleanTree:true}})).rejects.toMatchObject({code:'E_CONFIG'});
    await expect(requireCleanGitTree({...c,git:{...c.git,autoCommit:true}})).resolves.toBeUndefined();
    expect((await commitKbChanges({...c,git:{...c.git,autoCommit:true}},['a.md'],'m')).committed).toBe(false);
  });
  it('bounds streaming responses without trusting Content-Length', async () => {
    const s=await box(); const c=await s.config(); vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('x'.repeat(100))));
    await expect(acquireUrl('https://allowed.invalid/a',{...c,sources:{...c.sources,limits:{...c.sources.limits,maxBytes:10}},connectors:{...c.connectors,web:{enabled:true,allowDomains:['allowed.invalid']}}})).rejects.toMatchObject({code:'E_UNSUPPORTED'});
  });
  it('keeps optional unknown lifecycle values consumable under OKF section 11', () => {
    expect(validateDocument(parseOkf('a.md','---\ntype: FutureKind\nstatus: future-state\n---\n')).okfConformant).toBe(true);
  });
});
