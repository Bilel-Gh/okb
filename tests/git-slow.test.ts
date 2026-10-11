import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ROOT } from './helpers/sandbox.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

/** Ask `gitRoot` from a process whose `git` answers after `sleep` seconds. */
async function rootWithSlowGit(sleep: number, options: string): Promise<string> {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-slowgit-')));
  made.push(dir);
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const repo = resolve(dir, 'repo');
  await mkdir(repo, { recursive: true });
  execFileSync(real, ['init', '-q', repo]);
  await mkdir(resolve(dir, 'bin'));
  await writeFile(resolve(dir, 'bin', 'git'), `#!/bin/sh\nsleep ${sleep}\nexec ${real} "$@"\n`);
  await chmod(resolve(dir, 'bin', 'git'), 0o755);
  const script = `
    const { gitRoot } = await import(${JSON.stringify(resolve(TEST_ROOT, '..', 'dist', 'repo', 'git.js'))});
    try { console.log(JSON.stringify({ root: await gitRoot(${JSON.stringify(repo)}, ${options}) })); }
    catch (e) { console.log(JSON.stringify({ key: e.key ?? null, message: e.message })); }`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, PATH: `${resolve(dir, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
  return out.trim().replace(repo, '<repo>');
}

describe('a slow Git is not « not a Git repository »', () => {
  it('waits a second time, longer, before concluding anything', async () => {
    // Git takes 1.5 s; the first wait is 0.4 s, the second 10 s.
    expect(await rootWithSlowGit(1.5, '{ timeout: 400, patience: 10000 }')).toBe('{"root":"<repo>"}');
  });

  it('when Git still does not answer, says so instead of saying the folder is not a repository', async () => {
    expect(JSON.parse(await rootWithSlowGit(3, '{ timeout: 300, patience: 600, strict: true }'))).toMatchObject({ key: 'gitSlow' });
    // Where the answer is only a hint (a tip on the home screen), no repository is assumed, without an error.
    expect(await rootWithSlowGit(3, '{ timeout: 300, patience: 600 }')).toBe('{"root":null}');
  });

  it('a folder outside Git is still told at once', async () => {
    const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-nogit-')));
    made.push(dir);
    const { gitRoot } = await import('../src/repo/git.js');
    expect(await gitRoot(dir, { strict: true })).toBeNull();
  });
});
