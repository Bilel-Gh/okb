import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';
import { capture, inboxDir, listInbox, settleInboxItem } from '../src/inbox/inbox.js';
import { weeklyReport } from '../src/weekly/weekly.js';
import { proposeFiles } from '../src/proposal/files.js';
import { saveProposal } from '../src/proposal/store.js';
import { computeProposalHash } from '../src/proposal/model.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { statePaths } from '../src/state/paths.js';
import { walkFiles, writeJsonAtomic } from '../src/util/fsx.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(boxes.splice(0).map(s => s.cleanup())); });
const day = 86_400_000;
const note = (title: string) => `---\ntype: Guide\ntitle: ${title}\ndescription: Une note fictive.\nstatus: draft\n---\n\n# ${title}\n\nUn fait fictif.\n`;

async function setup(id: string) {
  const s = await makeSandbox({ profileId: id }); boxes.push(s);
  return s.config();
}

describe('inbox', () => {
  it('captures outside the KB, lists oldest first and settles by moving, never deleting', async () => {
    const config = await setup('inbox');
    const now = new Date('2026-10-03T12:00:00Z');
    const kbBefore = await walkFiles(config.kb.root);
    const old = await capture(config, { text: 'Idée : relier les fiches concepts aux procédures.', tags: ['okb'], now: new Date(now.getTime() - 10 * day) });
    const fresh = await capture(config, { text: '# Réunion produit\n\nPoints à creuser.', source: 'réunion du 3/10', now });
    expect(old.path.startsWith(inboxDir(config))).toBe(true);
    expect(await walkFiles(config.kb.root)).toEqual(kbBefore);
    const listed = await listInbox(config, { now });
    expect(listed.map(i => [i.id, i.ageDays])).toEqual([[old.id, 10], [fresh.id, 0]]);
    expect(fresh.title).toBe('Réunion produit');

    const done = await settleInboxItem(config, old.id.slice(0, 6), 'done', { proposal: 'p-1234' });
    expect(done).toMatchObject({ status: 'done', proposal: 'p-1234' });
    expect(await readFile(done.path, 'utf8')).toContain('Idée : relier les fiches');
    expect((await listInbox(config)).map(i => i.id)).toEqual([fresh.id]);
    await expect(settleInboxItem(config, old.id, 'dropped')).rejects.toMatchObject({ code: 'E_CONFLICT' });
  });

  it('refuses empty captures and credentials', async () => {
    const config = await setup('inbox-guard');
    await expect(capture(config, { text: '   ' })).rejects.toMatchObject({ code: 'E_INVALID' });
    const fake = 'ghp' + '_' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7';
    await expect(capture(config, { text: `token ${fake}` })).rejects.toMatchObject({ code: 'E_SECRET' });
  });
});

describe('weekly review', () => {
  it('reports waiting items, old proposals, notes to re-read and the audit without writing', async () => {
    const config = await setup('weekly');
    const now = new Date('2026-10-03T12:00:00Z');
    await capture(config, { text: 'Capture oubliée', now: new Date(now.getTime() - 25 * day) });
    await capture(config, { text: 'Capture récente', now: new Date(now.getTime() - 2 * day) });
    const proposal = proposeFiles(config, await loadBundleFor(config), new Map([['notes/b.md', note('B')]]), 'note B');
    const { contentHash: _hash, status: _status, ...body } = { ...proposal, createdAt: new Date(now.getTime() - 9 * day).toISOString() };
    await saveProposal(config, { ...body, status: 'prepared', contentHash: computeProposalHash(body) });
    await writeFixture(resolve(config.kb.root, 'notes/a.md'), note('Note A'));
    await writeJsonAtomic(resolve(statePaths(config).receipts, 'r-1.json'), {
      id: 'r-1', proposalId: 'p-old', complete: true, appliedAt: new Date(now.getTime() - 7 * day - 3_600_000).toISOString(),
      results: [{ path: 'notes/a.md', action: 'created', sha256: 'x' }],
    });
    const before = await walkFiles(config.kb.root);
    const r = await weeklyReport(config, { now });
    expect(r.inbox.open).toBe(2);
    expect(r.inbox.stale.map(i => i.title)).toEqual(['Capture oubliée']);
    expect(r.proposals.prepared).toMatchObject([{ ageDays: 9, changes: 1 }]);
    expect(r.toReview).toEqual([{ path: 'notes/a.md', title: 'Note A', ageDays: 7, milestone: 7 }]);
    expect(r.applied).toEqual({ receipts: 0, created: [], updated: [] });
    expect(await walkFiles(config.kb.root)).toEqual(before);
  });
});
