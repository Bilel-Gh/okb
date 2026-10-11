import { resolve } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startOnboarding } from '../src/setup/onboarding.js';
import { loadConfig } from '../src/config/load.js';
import { listProjects } from '../src/projects/projects.js';
import { closeDbs } from '../src/state/db.js';
import { enabledModules } from '../src/modules/catalog.js';
const dirs: string[] = [];
afterEach(async () => { closeDbs(); await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
describe('First result without AI (F3.0-02..04)', () => {
  it('creates a personal space and the first project without an agent, plugin install or shell launcher', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'okb-onboarding-')); dirs.push(dir);
    const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_AI: 'none', OKB_PROFILE: '' };
    const result = await startOnboarding({ profile: 'other', name: 'Mes activités', project: 'Sortie des enfants', language: 'fr', folder: resolve(dir, 'notes') }, env);
    const { config } = await loadConfig({ env, profileId: result.id });
    expect((await listProjects(config, env)).map((p) => p.title)).toContain('Sortie des enfants');
    expect(result.steps.map((s) => s.step)).not.toContain('plugin'); expect(result.steps.map((s) => s.step)).not.toContain('launcher');
    expect(result.project.next).toBeTruthy();
  });
  it('refuses to adopt a folder containing someone’s notes implicitly', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'okb-onboarding-')); dirs.push(dir);
    await writeFile(resolve(dir, 'important.md'), 'My existing notes');
    await expect(startOnboarding({ profile: 'student', name: 'Cours', project: 'Examen', language: 'fr', folder: dir }, { ...process.env, OKB_HOME: resolve(dir, 'home') })).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
  });
  it('keeps the developer module when the person adds a non-developer space', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'okb-onboarding-')); dirs.push(dir);
    const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_AI: 'none', OKB_PROFILE: '' };
    await startOnboarding({ profile: 'dev', name: 'Travail', project: 'Application', language: 'fr' }, env);
    await startOnboarding({ profile: 'other', name: 'Personnel', project: 'Activités', language: 'fr' }, env);
    expect(await enabledModules(env)).toContain('dev');
  });
});
