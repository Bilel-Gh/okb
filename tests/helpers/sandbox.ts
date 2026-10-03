import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/load.js';
import type { OkbConfig } from '../../src/config/schema.js';
import { runSetup, type SetupAnswers } from '../../src/setup/setup.js';
import { ensureState, statePaths } from '../../src/state/paths.js';

export const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_VAULT = resolve(TEST_ROOT, 'fixtures', 'vault-acme');
export const FIXTURE_SOURCES = resolve(TEST_ROOT, 'fixtures', 'sources');

export type Sandbox = {
  readonly dir: string;
  readonly home: string;
  readonly vault: string;
  readonly env: NodeJS.ProcessEnv;
  config(): Promise<OkbConfig>;
  cleanup(): Promise<void>;
};

/**
 * Every test gets its own OKB_HOME and its own copy of the fictional vault, so
 * two profiles can be exercised side by side without sharing a byte.
 */
export async function makeSandbox(
  answers: Partial<SetupAnswers> & { profileId: string },
  options: { copyVault?: boolean; extraProfileYaml?: string } = {},
): Promise<Sandbox> {
  const dir = await mkdtemp(resolve(tmpdir(), 'okb-test-'));
  const home = resolve(dir, 'home');
  const vault = resolve(dir, 'vault');

  if (options.copyVault !== false) {
    await cp(FIXTURE_VAULT, vault, { recursive: true });
  }

  const env: NodeJS.ProcessEnv = { ...process.env, OKB_HOME: home, OKB_PROFILE: answers.profileId };
  delete env.OKB_KB_ROOT;
  delete env.OKB_CONCEPT_ASSIST;
  delete env.OKB_APPLY_MODE;
  delete env.OKB_STATE_HOME;
  delete env.OKB_ORG_CONFIG;

  await runSetup(
    {
      kbRoot: vault,
      conceptAssist: 'targeted',
      humanActor: 'human:testuser',
      displayName: 'Test User',
      ...answers,
    },
    { env },
  );

  return {
    dir,
    home,
    vault,
    env,
    async config() {
      const { config } = await loadConfig({ env, profileId: answers.profileId });
      await ensureState(statePaths(config));
      return config;
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function writeFixture(path: string, content: string | Uint8Array): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
