import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { loadConfig } from '../src/config/load.js';
import { ask } from '../src/pipeline/ask.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { listProposals, saveProposal } from '../src/proposal/store.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { runSetup, switchProfile, parseConceptAssist } from '../src/setup/setup.js';
import { ensureState, statePaths } from '../src/state/paths.js';
import { asBundlePath } from '../src/util/paths.js';
import { FIXTURE_SOURCES, FIXTURE_VAULT, makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

describe('setup', () => {
  it('refuses to pick a concept-assist level on the user\'s behalf', () => {
    expect(() => parseConceptAssist(undefined)).toThrowError(/not provided/);
    const error = (() => {
      try {
        parseConceptAssist(undefined);
      } catch (e) {
        return e as { hint: string };
      }
      return null;
    })();
    expect(error?.hint).toContain('recommended');
    expect(error?.hint).toContain('targeted');
    expect(() => parseConceptAssist('sometimes')).toThrowError(/unknown concept assist level/);
  });

  it('answers the whole interview from a configuration file', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const result = await runSetup(
      {
        profileId: 'from-file',
        kbRoot: s.vault,
        conceptAssist: 'pedagogical',
        humanActor: 'human:someone',
        answerLanguage: 'fr',
        role: 'platform engineer',
        projects: ['fleet', 'billing'],
      },
      { env: s.env },
    );
    expect(result.created).toBe(true);

    const { config } = await loadConfig({ env: s.env, profileId: 'from-file' });
    expect(config.profile.role).toBe('platform engineer');
    expect(config.profile.projects).toEqual(['fleet', 'billing']);
    expect(config.profile.answer.language).toBe('fr');
    expect(config.conceptAssist.level).toBe('pedagogical');
  });

  it('survives a clean reinstall of the product without losing the profile', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const before = await readFile(resolve(s.home, 'profiles', 'alpha', 'profile.yaml'), 'utf8');

    // "Reinstalling" the product touches no user state: nothing lives in the package.
    const again = await runSetup(
      { profileId: 'alpha', kbRoot: s.vault, conceptAssist: 'targeted' },
      { env: s.env },
    );
    expect(again.created).toBe(false);

    const after = await readFile(resolve(s.home, 'profiles', 'alpha', 'profile.yaml'), 'utf8');
    expect(after).toContain('human:testuser');
    expect(before).toContain('human:testuser');
  });

  it('refuses to switch to a profile that is not installed', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    await expect(switchProfile('ghost', { env: s.env })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

describe('two profiles, one product', () => {
  it('keeps bundles, settings and operational state separate', async () => {
    const a = await makeSandbox({ profileId: 'atlas', conceptAssist: 'targeted' });
    sandboxes.push(a);

    // Second profile, same OKB_HOME, different bundle and different settings.
    const { cp } = await import('node:fs/promises');
    const otherVault = resolve(a.dir, 'vault-nova');
    await cp(FIXTURE_VAULT, otherVault, { recursive: true });
    await writeFile(
      resolve(otherVault, 'concepts', 'nova-only.md'),
      '---\ntype: Concept\ntitle: Nova only\ndescription: Exists in the second bundle only.\nstatus: stable\ngenerated: { by: "human:nova", at: 2026-01-01T00:00:00Z }\n---\n\nSomething only nova knows.\n',
    );
    await runSetup(
      { profileId: 'nova', kbRoot: otherVault, conceptAssist: 'off', humanActor: 'human:nova' },
      { env: a.env },
    );

    const atlas = (await loadConfig({ env: a.env, profileId: 'atlas' })).config;
    const nova = (await loadConfig({ env: a.env, profileId: 'nova' })).config;
    await ensureState(statePaths(atlas));
    await ensureState(statePaths(nova));

    expect(atlas.kb.root).not.toBe(nova.kb.root);
    expect(atlas.stateHome).not.toBe(nova.stateHome);
    expect(atlas.conceptAssist.level).toBe('targeted');
    expect(nova.conceptAssist.level).toBe('off');
    expect(atlas.profile.humanActor).toBe('human:testuser');
    expect(nova.profile.humanActor).toBe('human:nova');

    // Content does not leak between bundles.
    expect((await ask(nova, 'Nova only')).hits.length).toBeGreaterThan(0);
    expect((await ask(atlas, 'Nova only')).hits).toEqual([]);

    // Proposals do not leak either.
    const doc = await extractSource(
      await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), atlas),
      atlas,
    );
    const report = await prepareProposal(atlas, doc, {
      target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Sync' },
    });
    await saveProposal(atlas, report.proposal);

    expect((await listProposals(atlas)).map((p) => p.id)).toContain(report.proposal.id);
    expect(await listProposals(nova)).toEqual([]);

    // An approval granted under one profile does not verify under the other.
    await grantApproval(atlas, report.proposal, report.proposal.changes.map((c) => c.id), 'human:testuser');
    await saveProposal(nova, report.proposal);
    await expect(applyProposal(nova, report.proposal)).rejects.toMatchObject({
      code: 'E_CONFLICT',
    });
  });

  it('runs the same code with a disabled assist for one profile only', async () => {
    const a = await makeSandbox({ profileId: 'atlas', conceptAssist: 'targeted' });
    sandboxes.push(a);
    const { cp } = await import('node:fs/promises');
    const otherVault = resolve(a.dir, 'vault-nova');
    await cp(FIXTURE_VAULT, otherVault, { recursive: true });
    await runSetup(
      { profileId: 'nova', kbRoot: otherVault, conceptAssist: 'off', humanActor: 'human:nova' },
      { env: a.env },
    );

    const atlas = (await loadConfig({ env: a.env, profileId: 'atlas' })).config;
    const nova = (await loadConfig({ env: a.env, profileId: 'nova' })).config;
    await ensureState(statePaths(atlas));
    await ensureState(statePaths(nova));

    const target = { mode: 'append' as const, path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Sync' };
    const forAtlas = await prepareProposal(
      atlas,
      await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), atlas), atlas),
      { target },
    );
    const forNova = await prepareProposal(
      nova,
      await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), nova), nova),
      { target },
    );

    expect(forAtlas.candidates.length).toBeGreaterThan(0);
    expect(forNova.candidates).toEqual([]);
    expect(forNova.proposal.changes.every((c) => c.category === 'article')).toBe(true);
    expect(forAtlas.proposal.changes.some((c) => c.category === 'concept-card')).toBe(true);
  });

  it('writes no operational state inside the knowledge bundle', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const config = await s.config();

    const doc = await extractSource(
      await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), config),
      config,
    );
    const report = await prepareProposal(config, doc, {
      target: { mode: 'append', path: asBundlePath('flows/run-a-delivery-job.md'), heading: 'Sync' },
    });
    await saveProposal(config, report.proposal);
    await grantApproval(config, report.proposal, report.proposal.changes.map((c) => c.id), 'human:testuser');
    await applyProposal(config, report.proposal);

    const entries = await readdir(s.vault);
    expect(entries).not.toContain('.okb-state');
    expect(entries).not.toContain('proposals');
    expect(config.stateHome.startsWith(s.vault)).toBe(false);
  });
});
