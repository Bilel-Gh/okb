import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import { assertPersonSetting, writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';
import { TEST_ROOT } from './helpers/sandbox.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const hook = resolve(TEST_ROOT, '..', 'plugin', 'hooks', 'guard-approval.mjs');
function run(command: string): Promise<string> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [hook], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.on('close', () => done(out));
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
  });
}

describe('who decides that the agent writes directly (F2.0-52, D71)', () => {
  it('keeps « nothing enters without my yes » by default', async () => {
    const { config } = await workKb();
    expect(config.changes.agentWrites).toBe('proposal');
    expect(config.review).toEqual({ offer: true, auto: 'never' });
  });

  it('lets the person switch to « the agent files, I review later »', async () => {
    const { s, config } = await workKb();
    await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', s.env);
    expect((await loadConfig({ env: s.env, profileId: config.profile.id })).config.changes.agentWrites).toBe('review-later');
  });

  it('refuses the setting to an agent', () => {
    expect(() => assertPersonSetting('changes.agentWrites', 'agent')).toThrow(/person/);
    expect(() => assertPersonSetting('review.auto', 'agent')).toThrow(/person/);
    expect(() => assertPersonSetting('writing.preset', 'agent')).not.toThrow();
    expect(() => assertPersonSetting('changes.agentWrites', 'person')).not.toThrow();
  });

  it('the hook refuses a tool that edits the setting in the profile', async () => {
    for (const command of [
      "sed -i '' 's/agentWrites: proposal/agentWrites: review-later/' ~/.okb/profiles/travail/profile.yaml",
      'okb settings set changes.agentWrites=review-later',
      "printf 'changes:\\n  agentWrites: review-later\\n' >> profile.yaml",
    ]) expect(JSON.parse(await run(command)).hookSpecificOutput.permissionDecision, command).toBe('deny');
    expect(await run('okb settings set writing.preset=expert')).toBe('');
  });
});
