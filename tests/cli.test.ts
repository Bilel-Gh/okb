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

  it('changes a setting written as key=value or as key value', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    expect((await okb(['settings', 'set', 'writing.preset=expert'], s.env)).code).toBe(0);
    expect((await okb(['settings', 'set', 'profile.displayName', 'Acme Robotics'], s.env)).code).toBe(0);
    const profile = await readFile(resolve(s.home, 'profiles', 'alpha', 'profile.yaml'), 'utf8');
    expect(profile).toContain('preset: expert');
    expect(profile).toContain('displayName: Acme Robotics');
    const bad = await okb(['settings', 'set', 'writing.preset'], s.env);
    expect(bad.code).not.toBe(0);
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
    expect(report.support.map((s2) => s2.kind).sort()).toEqual(['code', 'docx', 'html', 'markdown', 'pdf', 'vtt']);
    expect(report.context.alwaysOn.bytes).toBeGreaterThan(0);
    expect(report.checks.find((c) => c.name === 'runtime')?.status).toBeTruthy();
  });

  it('tells which profile and KB the commands use', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const info = json<{ profile: string; kbRoot: string; changes: { agentWrites: string }; review: { offer: boolean } }>(await okb(['profile', '--json'], s.env));
    expect(info.profile).toBe('alpha');
    expect(info.kbRoot).toBe(s.vault);
    // D71: the skills read how this KB files the agent's notes.
    expect(info.changes.agentWrites).toBe('proposal');
    expect(info.review.offer).toBe(true);
  });

  it('journals a session, then gives the focus and the next step to a new session', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    expect((await okb(['focus', '--context'], s.env)).stdout).toBe('');
    expect((await okb(['focus', 'init'], s.env)).code).toBe(0);
    const done = json<{ captured: { id: string }[]; next: string }>(await okb(
      ['done', '--summary', 'Atelier fictif', '--did', 'Relu la note', '--keep', 'Une idée à garder.', '--keep', 'Une autre.', '--next', 'Écrire la procédure', '--json'], s.env));
    expect(done.captured).toHaveLength(2);
    expect(done.next).toBe('Écrire la procédure');
    const context = (await okb(['focus', '--context'], s.env)).stdout;
    expect(context).toContain('active profile "alpha"');
    expect(context).toContain('next time: Écrire la procédure');
    const info = json<{ focus: { exists: boolean } }>(await okb(['profile', '--json'], s.env));
    expect(info.focus.exists).toBe(true);
    const missing = await okb(['skillify', 'nope.md'], s.env);
    expect(missing.code).not.toBe(0);
  });

  it('speaks to people: tour, status, offers, typo suggestions and errors in French', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const tour = await okb(['tour', '--yes'], s.env);
    expect(tour.code).toBe(0);
    expect(tour.stdout).toContain('Throwaway KB deleted');
    const status = json<{ profile: string; line: string; pending: unknown[] }>(await okb(['status', '--json'], s.env));
    expect(status.line).toContain('📚 alpha');
    const offer = json<{ suggestion: { intent: string; command: string } }>(await okb(['route', '--suggest', '--json', 'ok fin de session'], s.env));
    expect(offer.suggestion).toMatchObject({ intent: 'done', command: '/okb:done' });
    const fr = { ...s.env, OKB_LANG: 'fr' };
    const typo = await okb(['revew'], fr);
    expect(typo.stderr).toContain('Tu voulais dire okb review');
    const missing = await okb(['review', '42'], fr);
    expect(missing.stderr).toContain('Proposition introuvable');
    expect(missing.stderr).toContain('okb explain E_NOT_FOUND');
    expect((await okb(['explain', 'E_STALE'], fr)).stdout).toContain('La KB a changé entre-temps');
    const help = await okb(['help', 'review'], fr);
    expect(help.stdout).toContain('okb review 1');
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
    // Running the same steps again explains that the work is done, writes nothing.
    const again = await okb(['review', planned.proposalId, '--approve'], s.env);
    expect(again.code).toBe(75);
    expect(again.stderr).toContain('already applied');
    const shown = await okb(['review', planned.proposalId], s.env);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain('Already applied');
    expect((await okb(['apply', planned.proposalId], s.env)).stderr).toContain('already applied');
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

  it('prints the writing brief for one request without changing the profile', async () => {
    const s = await makeSandbox({ profileId: 'writer', answerLanguage: 'fr', writing: { preset: 'pedagogique' } } as never);
    sandboxes.push(s);
    const profileBefore = await readFile(resolve(s.home, 'profiles', 'writer', 'profile.yaml'), 'utf8');
    const brief = json<{ style: { preset: string; detail: string; emojis: string }; persisted: boolean; brief: string }>(
      await okb(['style', '--set', 'detail=thorough', '--note', 'Cite les fichiers, avec leurs lignes.', '--json'], s.env),
    );
    expect(brief.style).toMatchObject({ preset: 'pedagogique', detail: 'thorough', emojis: 'landmarks' });
    expect(brief.persisted).toBe(false);
    expect(brief.brief).toContain('Cite les fichiers, avec leurs lignes.');
    expect(await readFile(resolve(s.home, 'profiles', 'writer', 'profile.yaml'), 'utf8')).toBe(profileBefore);
    const presets = json<{ presets: { id: string }[] }>(await okb(['style', 'presets', '--json'], s.env));
    expect(presets.presets.map((p) => p.id)).toEqual(['standard', 'pedagogique', 'expert']);
    const bad = await okb(['style', '--set', 'tone=sarcastic', '--json'], s.env);
    expect(bad.code).not.toBe(0);
  });

  it('gives the brief of one kind of note, and takes the simple words for style and length', async () => {
    const s = await makeSandbox({ profileId: 'writer', answerLanguage: 'fr' });
    sandboxes.push(s);
    type Brief = { style: { preset: string; detail: string }; type: string | null; brief: string };
    const concept = json<Brief>(await okb(['style', '--type', 'concept', '--json'], s.env));
    expect([concept.style.detail, concept.type]).toEqual(['essential', 'concept']);
    const wished = json<Brief>(await okb(['style', '--type', 'concept', '--style', 'simplifié', '--length', 'détaillée', '--json'], s.env));
    expect(wished.style).toMatchObject({ preset: 'pedagogique', detail: 'thorough' });
    const kinds = json<{ types: { type: string; detail: string; productDetail: string | null }[] }>(await okb(['style', 'types', '--json'], s.env));
    expect(kinds.types.find((k) => k.type === 'guide')).toMatchObject({ detail: 'thorough', productDetail: 'thorough' });
    expect((await okb(['style', '--length', 'énorme', '--json'], s.env)).code).not.toBe(0);
  });

  it('prepares a version 2 dossier template covering several sources', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const run = json<{ path: string; sources: { sha256: string; totalBlocks: number }[]; style: { preset: string } }>(
      await okb(['ingest', resolve(FIXTURE_SOURCES, 'dispatcher-notes.md'), '--with', resolve(FIXTURE_SOURCES, 'dispatch.ts'), '--template', '--json'], s.env),
    );
    expect(run.sources).toHaveLength(2);
    const template = JSON.parse(await readFile(run.path, 'utf8'));
    expect(template).toMatchObject({ version: 2, sources: run.sources.map((x) => x.sha256), style: { preset: 'standard' }, related: [] });
  });

  it('discards a prepared proposal without touching the KB', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const prepared = json<{ proposalId: string }>(
      await okb(['ingest', resolve(FIXTURE_SOURCES, 'dispatcher-notes.md'), '--create', 'flows/raw.md', '--json'], s.env),
    );
    expect((await okb(['review', prepared.proposalId, '--approve', '--json'], s.env)).code).toBe(0);
    const approval = resolve(s.home, 'profiles/alpha/state/approvals', `${prepared.proposalId}.json`);
    await expect(access(approval)).resolves.toBeUndefined();
    const discarded = await okb(['review', prepared.proposalId, '--discard', '--json'], s.env);
    expect(json<{ discarded: string }>(discarded).discarded).toBe(prepared.proposalId);
    const list = json<{ proposals: { id: string; status: string }[] }>(await okb(['review', '--list', '--all', '--json'], s.env));
    expect(list.proposals.find((p) => p.id === prepared.proposalId)?.status).toBe('superseded');
    expect((await okb(['review', prepared.proposalId, '--discard', '--json'], s.env)).code).not.toBe(0);
    await expect(access(approval)).rejects.toThrow();
    expect((await okb(['review', prepared.proposalId, '--approve', '--json'], s.env)).code).not.toBe(0);
    expect((await okb(['apply', prepared.proposalId, '--json'], s.env)).code).not.toBe(0);
    await expect(readFile(resolve(s.vault, 'flows', 'raw.md'))).rejects.toThrow();
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
