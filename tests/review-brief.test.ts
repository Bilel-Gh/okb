import { afterEach, describe, expect, it } from 'vitest';
import { layoutOf } from '../src/brain/layout.js';
import { sessionBrief } from '../src/brain/session.js';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { saveProposal } from '../src/proposal/store.js';
import { requestCheck } from '../src/review/gestures.js';
import { keepProposal } from '../src/review/keep.js';
import { writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const note = (title: string) => `---\ntype: Guide\ntitle: "${title}"\ndescription: Une note.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n---\n\n# ${title}\n\nTexte.\n`;

describe('the session brief tells the agent how notes are filed (F2.0-54, F2.0-55)', () => {
  it('keeps the yes-first rule when the KB did not opt in', async () => {
    const { config } = await workKb();
    const text = await sessionBrief(config, layoutOf(config) ?? { preset: 'work', lang: 'fr' }, await loadBundleFor(config));
    expect(text).toContain('never write one without the person\'s yes');
    expect(text).not.toContain('okb keep');
  });

  it('with review-later: an asked note is consent, filed with okb keep, and the pending count and checks are named', async () => {
    const { s, config } = await workKb();
    await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', s.env);
    const c = (await loadConfig({ env: s.env, profileId: config.profile.id })).config;
    await writeOwner(c.kb.root, c.profile.id);
    const p = proposeFiles(c, await loadBundleFor(c), new Map([['Cas/a.md', note('A')]]), 'agent');
    await saveProposal(c, p); await keepProposal(c, p.id, s.env);
    const id = requestCheck(c, 'Cas/a.md');
    const text = await sessionBrief(c, layoutOf(c) ?? { preset: 'work', lang: 'fr' }, await loadBundleFor(c));
    expect(text).toContain('okb keep');
    expect(text).toContain('a note the person asked for is their yes');
    expect(text).toMatch(/Notes to review by the person: \d+/);
    expect(text).toContain(`Checks asked: Cas/a.md [${id}]`);
    expect(text).toContain('never validate');
  });
});
