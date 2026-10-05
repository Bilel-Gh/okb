import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { writeFixture, TEST_ROOT } from './sandbox.js';
import { dirs, FIXTURE, git } from './repo.js';

/** The built CLI, run like a person would, with OKB's interaction and event log off. */
export const BIN = resolve(TEST_ROOT, '..', 'dist', 'cli', 'index.js');

export function run(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...env, OKB_LANG: 'fr', OKB_NO_INTERACTIVE: '1', OKB_NO_EVENTS: '1' }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? 0, stdout, stderr }));
  });
}

export async function json(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) {
  const r = await run([...args, '--json'], env, cwd);
  try { return JSON.parse(r.stdout); } catch { throw new Error(`${args.join(' ')} → ${r.stdout}${r.stderr}`); }
}

export async function repo(dir: string, files: Record<string, string>, subject: string): Promise<void> {
  for (const [path, content] of Object.entries(files)) await writeFixture(resolve(dir, path), content);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', subject);
}

/** A fictional team folder: three repositories (one two levels down) and a KB kept beside them. */
export async function team() {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-team-')));
  dirs.push(base);
  const ws = resolve(base, 'acme');
  const orders = resolve(ws, 'orders-service');
  await cp(FIXTURE, orders, { recursive: true });
  git(orders, 'init', '-q');
  git(orders, 'add', '-A');
  git(orders, 'commit', '-qm', 'ORD-1: orders service on CAP');
  for (const b of ['feature/ORD-12-cancel', 'bugfix/ord-15-total', 'feature/ORD-20-export', 'chore/node-18']) git(orders, 'branch', b);
  await repo(resolve(ws, 'libs', 'pricing-rules'), { 'package.json': JSON.stringify({ name: '@acme/pricing-rules', version: '2.1.0' }), 'README.md': '# Pricing rules\n' }, 'ORD-3: pricing rules');
  await repo(resolve(ws, 'billing-service'), { 'package.json': JSON.stringify({ name: '@acme/billing-service', version: '1.0.0' }), 'README.md': '# Billing\n\nInvoices for the web shop.\n' }, 'Billing service');
  await mkdir(resolve(ws, 'team-kb', '.okb'), { recursive: true });
  await writeFile(resolve(ws, 'team-kb', '.okb', 'owner.yaml'), 'profile: other\n');
  git(resolve(ws, 'team-kb'), 'init', '-q');
  return { base, ws, orders, billing: resolve(ws, 'billing-service') };
}
