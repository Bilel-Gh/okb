import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { redact } from '../src/config/redact.js';
import { runSetup } from '../src/setup/setup.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

async function sandbox(profileId: string, extra: Record<string, unknown> = {}): Promise<Sandbox> {
  const s = await makeSandbox({ profileId, ...extra });
  sandboxes.push(s);
  return s;
}

/** Merge extra settings into an existing profile file the way a user would. */
async function patchProfile(
  s: Sandbox,
  profileId: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const path = resolve(s.home, 'profiles', profileId, 'profile.yaml');
  const current = (YAML.parse(await readFile(path, 'utf8')) as Record<string, unknown>) ?? {};
  await writeFile(path, YAML.stringify({ ...current, ...patch }, { lineWidth: 0 }));
  return path;
}

describe('configuration', () => {
  it('fails with a readable message when no profile is installed', async () => {
    const s = await sandbox('alpha');
    await expect(loadConfig({ env: s.env, profileId: 'ghost' })).rejects.toMatchObject({
      code: 'E_CONFIG',
      message: expect.stringContaining('profile "ghost" is not installed'),
    });
  });

  it('points at the layer that supplied an invalid value', async () => {
    const s = await sandbox('alpha');
    await patchProfile(s, 'alpha', { context: { pageSize: 9999 } });

    await expect(loadConfig({ env: s.env, profileId: 'alpha' })).rejects.toMatchObject({
      code: 'E_CONFIG',
      message: expect.stringContaining('context.pageSize'),
    });
    const error = await loadConfig({ env: s.env, profileId: 'alpha' }).catch((e) => e);
    expect(error.message).toContain('set by profile');
  });

  it('applies layers lowest-to-highest: org < profile < kb-local < env < flags', async () => {
    const s = await sandbox('alpha');
    const orgPath = resolve(s.dir, 'org.yaml');
    await writeFile(orgPath, 'context:\n  pageSize: 5\nconceptAssist:\n  level: off\n');
    await mkdir(resolve(s.vault, '.okb'), { recursive: true });
    await writeFile(resolve(s.vault, '.okb', 'kb.yaml'), 'conceptAssist:\n  level: pedagogical\n');

    const base = await loadConfig({ env: s.env, profileId: 'alpha', orgConfigPath: orgPath });
    expect(base.config.context.pageSize).toBe(5);
    expect(base.config.conceptAssist.level).toBe('pedagogical'); // kb-local beats org

    const withEnv = await loadConfig({
      env: { ...s.env, OKB_CONCEPT_ASSIST: 'targeted' },
      profileId: 'alpha',
      orgConfigPath: orgPath,
    });
    expect(withEnv.config.conceptAssist.level).toBe('targeted'); // env beats kb-local

    const withFlags = await loadConfig({
      env: { ...s.env, OKB_CONCEPT_ASSIST: 'targeted' },
      profileId: 'alpha',
      orgConfigPath: orgPath,
      flags: { conceptAssist: { level: 'off' } },
    });
    expect(withFlags.config.conceptAssist.level).toBe('off'); // flags win
  });

  it('never lets a personal preference loosen an organisation policy', async () => {
    const s = await sandbox('alpha');
    const orgPath = resolve(s.dir, 'org.yaml');
    await writeFile(
      orgPath,
      [
        'policy:',
        '  allowDirectApply: false',
        '  allowWebConnector: false',
        '  allowedSourceKinds: [markdown, vtt]',
        '  maxConceptSuggestionsPerSource: 3',
        '  maxSourceBytes: 1000',
        '  allowedRemotes: ["git@example.org:team/kb.git"]',
      ].join('\n'),
    );
    const profilePath = resolve(s.home, 'profiles', 'alpha', 'profile.yaml');
    await patchProfile(s, 'alpha', {
      changes: { apply: 'allow-direct' },
      connectors: { web: { enabled: true } },
      sources: {
        enabled: ['markdown', 'vtt', 'pdf', 'docx', 'html'],
        limits: { maxBytes: 20_000_000 },
      },
      conceptAssist: { level: 'targeted', limits: { maxSuggestionsPerSource: 20 } },
      git: {
        allowedRemotes: ['git@example.org:team/kb.git', 'git@example.org:someone/private.git'],
      },
    });
    expect(profilePath).toContain('alpha');

    const { config, clamped } = await loadConfig({
      env: s.env,
      profileId: 'alpha',
      orgConfigPath: orgPath,
    });

    expect(config.changes.apply).toBe('require-approval');
    expect(config.connectors.web.enabled).toBe(false);
    expect(config.sources.enabled.sort()).toEqual(['markdown', 'vtt']);
    expect(config.sources.limits.maxBytes).toBe(1000);
    expect(config.conceptAssist.limits.maxSuggestionsPerSource).toBe(3);
    expect(config.git.allowedRemotes).toEqual(['git@example.org:team/kb.git']);
    expect(clamped.map((c) => c.path).sort()).toEqual([
      'changes.apply',
      'conceptAssist.limits.maxSuggestionsPerSource',
      'connectors.web.enabled',
      'git.allowedRemotes',
      'sources.enabled',
      'sources.limits.maxBytes',
    ]);
  });

  it('lists capabilities that stay off because nothing configured them', async () => {
    const s = await sandbox('alpha');
    const { disabled } = await loadConfig({ env: s.env, profileId: 'alpha' });
    expect(disabled).toContain('web-connector');
    expect(disabled).toContain('mcp-connectors');
    expect(disabled).toContain('git-push');
  });

  it('keeps custom keys and edited values across a re-install', async () => {
    const s = await sandbox('alpha');
    const profilePath = await patchProfile(s, 'alpha', {
      myTeamStuff: { ticketPrefix: 'ACME' },
      context: { pageSize: 7 },
    });

    await runSetup(
      { profileId: 'alpha', kbRoot: s.vault, conceptAssist: 'pedagogical' },
      { env: s.env },
    );

    const { config, ignoredKeys } = await loadConfig({ env: s.env, profileId: 'alpha' });
    expect(config.context.pageSize).toBe(7);
    expect(config.conceptAssist.level).toBe('pedagogical');
    expect(ignoredKeys).toContain('myTeamStuff');
    const raw = await readFile(profilePath, 'utf8');
    expect(raw).toContain('ticketPrefix: ACME');
  });

  it('redacts credentials by key name and by shape', () => {
    // okb-leak-fixture: the strings below are synthetic, used to test redaction.
    const safe = redact({
      git: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
      notes: 'paste ghp_abcdefghijklmnopqrstuvwxyz0123456789 here',
      nested: [{ apiKey: 'secret-value' }],
      kept: 'ordinary text',
    });
    expect(JSON.stringify(safe)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(JSON.stringify(safe)).not.toContain('secret-value');
    expect((safe as { kept: string }).kept).toBe('ordinary text');
  });
});
