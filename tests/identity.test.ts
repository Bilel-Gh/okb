import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newPersonId, person } from '../src/identity/person.js';
import { json } from './helpers/team.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

async function home() {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-person-')));
  made.push(dir);
  return { dir, env: { ...process.env, OKB_HOME: resolve(dir, '.okb'), HOME: dir, USER: 'jdupont', LOGNAME: 'jdupont' } };
}

describe('a stable identity, never a name', () => {
  it('makes ids of the form p-xxxxxxxxxx', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newPersonId()));
    for (const id of ids) expect(id).toMatch(/^p-[a-z0-9]{10}$/);
    expect(ids.size).toBe(50);
  });

  it('creates the id once and keeps it, with no name from the computer', async () => {
    const { dir, env } = await home();
    const a = await person(env);
    const b = await person(env);
    expect(a.id).toBe(b.id);
    expect(a.role).toBe('');
    const config = await readFile(resolve(dir, '.okb', 'config.yaml'), 'utf8');
    expect(config).toContain(a.id);
    expect(config).not.toContain('jdupont');
  });

  it('okb whoami shows the id and the role set in the settings', async () => {
    const { dir, env } = await home();
    await json(['settings', 'set', 'person.role', 'devops'], env, dir);
    const me = await json(['whoami'], env, dir);
    expect(me).toMatchObject({ ok: true, role: 'devops' });
    expect(me.id).toMatch(/^p-[a-z0-9]{10}$/);
  }, 60_000);
});

describe('the identity travels with what the person does', () => {
  it('a receipt carries the person id and role', async () => {
    const { applyProposal } = await import('../src/apply/apply.js');
    const { grantApproval } = await import('../src/apply/approval.js');
    const { prepareProposal } = await import('../src/pipeline/ingest.js');
    const { saveProposal } = await import('../src/proposal/store.js');
    const { acquire, extractSource } = await import('../src/sources/registry.js');
    const { asBundlePath } = await import('../src/util/paths.js');
    const { makeSandbox, FIXTURE_SOURCES } = await import('./helpers/sandbox.js');
    const s = await makeSandbox({ profileId: 'alpha' });
    try {
      const config = await s.config();
      const doc = await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), config), config);
      const { proposal } = await prepareProposal(config, doc, { target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Weekly sync notes' } });
      await saveProposal(config, proposal);
      await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
      const receipt = await applyProposal(config, proposal);
      expect(receipt.person?.id).toMatch(/^p-[a-z0-9]{10}$/);
      expect(receipt.person?.id).toBe((await person()).id);
    } finally {
      await s.cleanup();
    }
  }, 60_000);

  it('a decided suggestion carries the person id', async () => {
    const { addSuggestion, contextFor, setStatus } = await import('../src/suggest/suggest.js');
    const { loadBundleFor } = await import('../src/kb/bundle.js');
    const { makeSandbox } = await import('./helpers/sandbox.js');
    const s = await makeSandbox({ profileId: 'alpha' });
    try {
      const config = await s.config();
      const ctx = await contextFor(config, await loadBundleFor(config));
      const { suggestion } = await addSuggestion(config, { type: 'concept', title: 'Idempotence', why: 'asked twice', signal: 'asked', source: 'test' } as never, ctx);
      const decided = await setStatus(config, suggestion.id, 'accepted', 'person');
      expect(decided.decidedPerson).toBe((await person()).id);
    } finally {
      await s.cleanup();
    }
  }, 60_000);
});
