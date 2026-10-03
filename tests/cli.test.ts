import { spawn } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_SOURCES, makeSandbox, type Sandbox } from './helpers/sandbox.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const PACKAGE_ROOT = resolve(TEST_ROOT, '..');
const BIN = resolve(PACKAGE_ROOT, 'dist', 'cli', 'index.js');

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

type Run = { code: number; stdout: string; stderr: string };

function okb(args: readonly string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 0, stdout, stderr }));
  });
}

function json<T>(run: Run): T {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new Error(`not JSON (exit ${run.code}):\n${run.stdout}\n${run.stderr}`);
  }
}

beforeAll(async () => {
  await access(BIN, constants.R_OK).catch(() => {
    throw new Error(`dist build missing at ${BIN}. Run \`npm run build\` before the test suite.`);
  });
});

describe('packaged CLI', () => {
  it('runs from the built entry point and reports its version', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const run = await okb(['version'], s.env);
    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('fails clearly when no profile is installed, and succeeds after setup', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);

    const missing = await okb(['config', 'show', '--profile', 'ghost'], s.env);
    expect(missing.code).toBe(78);
    expect(missing.stderr).toContain('E_CONFIG');
    expect(missing.stderr).toContain('okb setup');

    const created = await okb(
      ['setup', '--profile', 'nova', '--kb-root', s.vault, '--concept-assist', 'pedagogical', '--json'],
      s.env,
    );
    expect(created.code).toBe(0);
    const shown = json<{ config: { conceptAssist: { level: string } } }>(
      await okb(['config', 'show', '--profile', 'nova', '--json'], s.env),
    );
    expect(shown.config.conceptAssist.level).toBe('pedagogical');
  });

  it('refuses to guess the concept-assist level', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const run = await okb(['setup', '--profile', 'x', '--kb-root', s.vault], s.env);
    expect(run.code).toBe(78);
    expect(run.stderr).toContain('recommended');
  });

  it('walks ingest → review → approve → apply → rollback', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const source = resolve(FIXTURE_SOURCES, 'weekly-sync.vtt');
    const target = resolve(s.vault, 'flows', 'run-a-delivery-job.md');
    const before = await readFile(target, 'utf8');

    const ingest = json<{ proposalId: string; changes: { id: string; category: string }[] }>(
      await okb(
        ['ingest', source, '--append', 'flows/run-a-delivery-job.md', '--heading', 'Weekly sync', '--json'],
        s.env,
      ),
    );
    expect(ingest.changes.length).toBeGreaterThan(0);
    expect(await readFile(target, 'utf8')).toBe(before);

    const review = json<{ diffs: { path: string; diff: string }[] }>(
      await okb(['review', ingest.proposalId, '--diff', '--json'], s.env),
    );
    expect(review.diffs.some((d) => d.diff.includes('+# Weekly sync'))).toBe(true);

    const notApproved = await okb(['apply', ingest.proposalId, '--json'], s.env);
    expect(notApproved.code).toBe(77);
    expect(notApproved.stdout).toContain('E_NOT_APPROVED');
    expect(await readFile(target, 'utf8')).toBe(before);

    const articleOnly = ingest.changes.find((c) => c.category === 'article')!.id;
    const approved = await okb(
      ['review', ingest.proposalId, '--approve', '--only', articleOnly, '--json'],
      s.env,
    );
    expect(approved.code).toBe(0);

    const applied = json<{ receipt: { id: string; results: { path: string }[] } }>(
      await okb(['apply', ingest.proposalId, '--only', articleOnly, '--json'], s.env),
    );
    expect(applied.receipt.results.map((r) => r.path)).toEqual(['flows/run-a-delivery-job.md']);
    expect(await readFile(target, 'utf8')).toContain('# Weekly sync');

    const rolledBack = await okb(['apply', '--rollback', applied.receipt.id, '--json'], s.env);
    expect(rolledBack.code).toBe(0);
    expect(await readFile(target, 'utf8')).toBe(before);
  });

  it('answers a question with located evidence, and admits when it cannot', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);

    const hit = json<{ hits: unknown[]; evidence: { path: string; line: number }[] }>(
      await okb(['ask', 'dispatcher idempotence', '--json'], s.env),
    );
    expect(hit.hits.length).toBeGreaterThan(0);
    expect(hit.evidence[0]!.line).toBeGreaterThan(0);

    const miss = json<{ hits: unknown[]; notes: string[] }>(
      await okb(['ask', 'submarine pricing model', '--json'], s.env),
    );
    expect(miss.hits).toEqual([]);
    expect(miss.notes.join(' ')).toMatch(/invented/);
  });

  it('reports support, context and health through doctor', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const report = json<{
      ok: boolean;
      checks: { name: string; status: string }[];
      support: { kind: string; enabled: boolean }[];
      context: { alwaysOn: { bytes: number } };
    }>(await okb(['doctor', '--json'], s.env));

    expect(report.ok).toBe(true);
    expect(report.support.map((s2) => s2.kind).sort()).toEqual(['docx', 'html', 'markdown', 'pdf', 'vtt']);
    expect(report.context.alwaysOn.bytes).toBeGreaterThan(0);
    expect(report.checks.find((c) => c.name === 'runtime')?.status).toBeTruthy();
  });

  it('generates a navigable index tree that resolves in every renderer', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);

    const planned = json<{ proposalId: string; files: { path: string; status: string }[] }>(
      await okb(['nav', '--json'], s.env),
    );
    expect(planned.files.some((f) => f.path === 'concepts/index.md')).toBe(true);

    const denied = await okb(['apply', planned.proposalId, '--json'], s.env);
    expect(denied.code).toBe(77);
    expect((await okb(['review', planned.proposalId, '--approve'], s.env)).code).toBe(0);
    expect((await okb(['apply', planned.proposalId], s.env)).code).toBe(0);
    const concepts = await readFile(resolve(s.vault, 'concepts', 'index.md'), 'utf8');
    expect(concepts).toContain('* [Dispatcher](dispatcher.md)');
    expect(concepts).not.toContain('---');

    const home = await readFile(resolve(s.vault, 'index.md'), 'utf8');
    expect(home).toContain('okf_version: "0.2"');
    expect(home).toContain('(concepts/dispatcher.md)');

    const links = json<{ ok: boolean; issues: { level: string }[] }>(
      await okb(['links', 'check', '--json'], s.env),
    );
    expect(links.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('moves a note and keeps every inbound reference working', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);

    const plan = json<{ proposalId: string; inbound: unknown[]; outbound: unknown[] }>(
      await okb(['links', 'move', 'concepts/dispatcher.md', 'reference/fleet/dispatcher.md', '--json'], s.env),
    );
    expect(plan.inbound.length).toBeGreaterThan(0);

    expect((await okb(['review', plan.proposalId, '--approve'], s.env)).code).toBe(0);
    expect((await okb(['apply', plan.proposalId], s.env)).code).toBe(0);
    expect(await readdir(resolve(s.vault, 'concepts'))).not.toContain('dispatcher.md');

    const after = json<{ issues: { level: string; code: string }[] }>(
      await okb(['links', 'check', '--json'], s.env),
    );
    expect(after.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('routes requests, including the ones it must stay out of', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const ingest = json<{ skill: string }>(await okb(['route', 'Ingest notes.vtt please', '--json'], s.env));
    expect(ingest.skill).toBe('okb-ingest');

    const none = json<{ skill: string }>(
      await okb(['route', 'Review this pull request', '--json'], s.env),
    );
    expect(none.skill).toBe('none');
  });

  it('bounds extraction output and resumes from a cursor', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const source = resolve(FIXTURE_SOURCES, 'weekly-sync.vtt');

    const first = json<{ runId: string; blocks: unknown[]; truncation: { truncated: boolean; nextCursor: string } }>(
      await okb(['ingest', source, '--extract-only', '--limit', '2', '--json'], s.env),
    );
    expect(first.blocks).toHaveLength(2);
    expect(first.truncation.truncated).toBe(true);

    const second = json<{ blocks: { id: string }[] }>(
      await okb(
        ['ingest', source, '--extract-only', '--limit', '2', '--run', first.runId, '--resume', '--json'],
        s.env,
      ),
    );
    expect((second.blocks[0] as { id: string }).id).not.toBe((first.blocks[0] as { id: string }).id);
  });

  it('bounds the entire extraction envelope, including corrections and JSON formatting', async () => {
    const s=await makeSandbox({profileId:'bounded'});sandboxes.push(s);
    const source=resolve(s.dir,'long.vtt');
    const {writeFile}=await import('node:fs/promises');
    const cues=Array.from({length:80},(_,i)=>`00:${String(i%60).padStart(2,'0')}:00.000 --> 00:${String(i%60).padStart(2,'0')}:01.000\nActually, correction: ${'the queue broker handles requests. '.repeat(25)}`);
    await writeFile(source,'WEBVTT\n\n'+cues.join('\n\n'));
    const first=await okb(['ingest',source,'--extract-only','--json'],s.env);
    const page=json<{runId:string;truncation:{truncated:boolean;nextCursor:string}}>(first);
    expect(first.code).toBe(0);expect(page.truncation.truncated).toBe(true);
    expect(Math.ceil(Buffer.byteLength(first.stdout,'utf8')/3.8)).toBeLessThanOrEqual(4000);
    const next=await okb(['ingest',source,'--extract-only','--json','--run',page.runId,'--cursor',page.truncation.nextCursor],s.env);
    expect(next.code).toBe(0);expect(Math.ceil(Buffer.byteLength(next.stdout,'utf8')/3.8)).toBeLessThanOrEqual(4000);
  });

  it('rejects an unsupported source with a non-zero exit code', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const { writeFile } = await import('node:fs/promises');
    const path = resolve(s.dir, 'thing.bin');
    await writeFile(path, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    const run = await okb(['ingest', path, '--create', 'flows/x.md', '--json'], s.env);
    expect(run.code).toBe(69);
    expect(run.stdout).toContain('E_UNSUPPORTED');
  });
});
