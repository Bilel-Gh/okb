import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach } from 'vitest';
import { demoNotes, writeDemo } from '../../src/brain/demo.js';
import { loadConfig } from '../../src/config/load.js';
import { runSetup } from '../../src/setup/setup.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

/** A fictitious work brain (French names): 2 products, 2 repositories with their pages, nothing registered. */
export async function demoBrain(size: Partial<{ products: number; repos: number; tickets: number; meetings: number; concepts: number }> = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-brain-')));
  made.push(dir);
  const kb = resolve(dir, 'kb');
  await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 2, repos: 2, tickets: 4, meetings: 1, concepts: 3, ...size }));
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  return { dir, kb, env, config };
}
