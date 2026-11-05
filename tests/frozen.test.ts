import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FROZEN, frozenFeatures } from '../src/modules/catalog.js';
import { writeSetting } from '../src/settings/settings.js';
import { makeSandbox } from './helpers/sandbox.js';
import { BIN } from './helpers/team.js';

const made: string[] = [];
afterEach(async () => { await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('frozen functions (chantier 7, D80)', () => {
  it('freezes career, progress, translation, exam, sharing, the assistant and the desktop app by default, and keeps the revision cards', async () => {
    const s = await makeSandbox({ profileId: 'alpha' }); made.push(s.dir);
    expect([...(await frozenFeatures(s.env))].sort()).toEqual([...DEFAULT_FROZEN].sort());
    expect(DEFAULT_FROZEN).not.toContain('learn');
    await writeSetting('', 'frozen', [], s.env);
    expect(await frozenFeatures(s.env)).toEqual(new Set());
    await writeSetting('', 'frozen', ['career'], s.env);
    expect([...(await frozenFeatures(s.env))]).toEqual(['career']);
  });

  it('keeps a frozen command working, out of okb help, and in okb help --all', async () => {
    const s = await makeSandbox({ profileId: 'alpha' }); made.push(s.dir);
    const env = { ...s.env, NO_COLOR: '1' };
    const help = execFileSync(process.execPath, [BIN, 'help'], { env, encoding: 'utf8' });
    expect(help).not.toMatch(/okb career\b/);
    expect(help).not.toMatch(/okb translate\b/);
    expect(help).toMatch(/okb ask\b/);
    expect(execFileSync(process.execPath, [BIN, 'help', '--all'], { env, encoding: 'utf8' })).toMatch(/okb career\b/);
    expect(JSON.parse(execFileSync(process.execPath, [BIN, 'career', '--json'], { env, encoding: 'utf8' })).ok).toBe(true);
  });
});
