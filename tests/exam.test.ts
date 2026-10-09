import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiRequest, AiResult } from '../src/ai/provider.js';
import { brainRepos } from '../src/knowledge/brain-repos.js';
import { addExamQuestion, examScore, jsonBlock, lastExam, planExam, removeExamQuestion, runExam, type ExamRepo } from '../src/knowledge/exam.js';
import { writeRootConfig } from '../src/kb/registry.js';
import { addRepo } from '../src/repo/registry.js';
import { scanAndStore } from '../src/repo/scan.js';
import { demoBrain } from './helpers/brain.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();

/** A stand-in for the model: it answers each question, then grades; every request is kept. */
function stubAi(grade: (id: string) => string = () => 'right') {
  const sent: AiRequest[] = [];
  const ask = async (req: AiRequest): Promise<AiResult> => {
    sent.push(req);
    const ids = [...req.prompt.matchAll(/^### (\S+)/gm)].map((m) => m[1]!);
    const text = req.system.includes('grade')
      ? JSON.stringify({ grades: ids.map((id) => ({ id, grade: grade(id), why: `because ${id}` })) })
      : `Here you are:\n\`\`\`json\n${JSON.stringify({ answers: ids.map((id) => ({ id, answer: `answer to ${id}` })) })}\n\`\`\``;
    return { text, tokens: { input: 1000, output: 200 }, provider: 'fake' };
  };
  return { ask, sent };
}

const card = (title: string, body: string, extra = '') => `---\ntitle: ${title}\ndescription: ${title}.\nstatus: stable\n${extra}generated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\n---\n\n# ${title}\n\n${body}\n`;

async function demo() {
  const b = await demoBrain();
  const repos = await brainRepos(b.config, b.env);
  const repo = repos.find((r) => r.folder) as ExamRepo;
  return { ...b, repo };
}

describe('the score of an exam', () => {
  it('counts a right answer whole and a partial one half, over the graded questions only', () => {
    expect(examScore([{ grade: 'right' }, { grade: 'partial' }, { grade: 'wrong' }, { grade: 'ungraded' }])).toBe(50);
    expect(examScore([{ grade: 'right' }, { grade: 'right' }])).toBe(100);
  });

  it('has no score when nothing could be graded', () => {
    expect(examScore([{ grade: 'ungraded' }])).toBeNull();
    expect(examScore([])).toBeNull();
  });
});

describe('reading the model’s answer', () => {
  it('finds the JSON in a fenced block or in prose', () => {
    expect(jsonBlock('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(jsonBlock('Result {"grades":[]} done')).toEqual({ grades: [] });
  });

  it('gives null rather than a guess', () => {
    expect(jsonBlock('no json here')).toBeNull();
    expect(jsonBlock('{broken')).toBeNull();
  });
});

describe('the exam of a repository', () => {
  it('asks the fixed onboarding questions, plus the team’s own, and says what it will cost before anything is sent', async () => {
    const { config, env, repo } = await demo();
    await addExamQuestion(config, repo, 'Quelle base de données utilise-t-il ?', 'PostgreSQL');
    const plan = await planExam(config, repo, { env });
    expect(plan.questions.filter((q) => !q.custom)).toHaveLength(25);
    const mine = plan.questions.find((q) => q.custom)!;
    expect(mine).toMatchObject({ text: 'Quelle base de données utilise-t-il ?', expected: 'PostgreSQL', reference: 'expected' });
    expect(plan.tokens).toBeGreaterThan(0);
    // An unlinked repository has no code to check against: its fixed questions cannot be graded.
    expect(plan.questions.filter((q) => !q.custom).every((q) => q.reference === 'none')).toBe(true);
    await removeExamQuestion(config, repo, mine.id);
    expect((await planExam(config, repo, { env })).questions.some((q) => q.custom)).toBe(false);
  }, 60_000);

  it('answers only from the repository’s own notes, never a 🔒 note, and grades against the expected answer', async () => {
    const { config, env, kb, repo } = await demo();
    await writeFile(resolve(kb, repo.folder!, 'Base de données.md'), card('Base de données', 'La base de données du service est PostgreSQL, version 16, hébergée à part.'));
    await writeFile(resolve(kb, repo.folder!, 'Accès base.md'), card('Accès base', 'Mot de passe de la base de données : ZEBRE-SECRET-42.', 'x_okb:\n  confidentiality: secret\n'));
    await mkdir(resolve(kb, '9 Ailleurs'), { recursive: true });
    await writeFile(resolve(kb, '9 Ailleurs', 'Autre base.md'), card('Autre base', 'Une autre base de données : ORNITHORYNQUE, pour un autre produit.'));
    await addExamQuestion(config, repo, 'Quelle base de données utilise-t-il ?', 'PostgreSQL');
    const { ask, sent } = stubAi();
    const result = await runExam(config, repo, { env, ask });
    const all = sent.map((r) => r.system + r.prompt).join('\n');
    expect(all).toContain('PostgreSQL, version 16');
    expect(all).not.toContain('ZEBRE-SECRET-42');
    expect(all).not.toContain('ORNITHORYNQUE');
    const mine = result.items.find((i) => i.custom)!;
    expect(mine).toMatchObject({ grade: 'right', reference: 'expected', answer: `answer to ${mine.id}` });
    expect(mine.notes.some((n) => n.endsWith('Base de données.md'))).toBe(true);
    // Fixed questions of an unlinked repository: answered, but not graded.
    expect(result.items.filter((i) => !i.custom && i.found > 0).every((i) => i.grade === 'ungraded')).toBe(true);
    expect(result.score).toBe(100);
  }, 60_000);

  it('a question the notes cannot answer counts as wrong, without asking the model', async () => {
    const { config, env, repo } = await demo();
    await addExamQuestion(config, repo, 'Xylophone quantique zygomatique ?', 'Rien');
    const { ask, sent } = stubAi();
    const result = await runExam(config, repo, { env, ask, only: ['custom'] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ grade: 'wrong', found: 0, why: 'not-found' });
    expect(sent).toHaveLength(0);
    expect(result.score).toBe(0);
  }, 60_000);

  it('keeps each result, the last one first', async () => {
    const { config, env, repo } = await demo();
    await addExamQuestion(config, repo, 'Quelle base de données utilise-t-il ?', 'PostgreSQL');
    expect(await lastExam(config, repo)).toBeNull();
    await runExam(config, repo, { env, ask: stubAi(() => 'wrong').ask, only: ['custom'], now: new Date('2026-10-01T10:00:00Z') });
    await runExam(config, repo, { env, ask: stubAi(() => 'right').ask, only: ['custom'], now: new Date('2026-10-02T10:00:00Z') });
    const last = await lastExam(config, repo);
    expect(last?.at).toBe('2026-10-02T10:00:00.000Z');
    expect(last?.history.map((h) => h.at.slice(0, 10))).toEqual(['2026-10-02', '2026-10-01']);
  }, 60_000);

  it('stops before sending anything when the day’s budget would be passed', async () => {
    const { config, env, kb, repo } = await demo();
    await writeFile(resolve(kb, repo.folder!, 'Base de données.md'), card('Base de données', 'La base de données du service est PostgreSQL.'));
    await addExamQuestion(config, repo, 'Quelle base de données utilise-t-il ?', 'PostgreSQL');
    await writeRootConfig((r) => ({ ...r, budget: { daily: 10 } }), env);
    const { ask, sent } = stubAi();
    await expect(runExam(config, repo, { env, ask, only: ['custom'] })).rejects.toMatchObject({ key: 'budgetExceeded' });
    expect(sent).toHaveLength(0);
  }, 60_000);
});

describe('the exam of a repository linked to its code', () => {
  it('grades the onboarding questions against the code the scan points to', async () => {
    const { config, s } = await workKb();
    const root = await gitFixture();
    const { repo: entry } = await addRepo({ path: root, kb: config.profile.id });
    await scanAndStore(config, entry);
    const folder = resolve(s.vault, 'repos', entry.id);
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, 'Démarrer.md'), card('Démarrer', 'Pour lancer le service en local : `npm run watch` (cds watch), puis ouvrir le port 4004.', `x_okb:\n  repo:\n    id: ${entry.id}\n`));
    const repo: ExamRepo = { id: entry.id, name: entry.name, folder: null };
    const plan = await planExam(config, repo, { env: process.env });
    expect(plan.questions.find((q) => q.id === 'q-run-local')?.reference).toBe('code');
    const { ask, sent } = stubAi((id) => (id === 'q-run-local' ? 'partial' : 'right'));
    const result = await runExam(config, repo, { env: process.env, ask, only: ['q-run-local'] });
    const judge = sent.find((r) => r.system.includes('grade'))!;
    expect(judge.prompt).toContain('package.json');
    expect(judge.prompt).toContain('cds watch');
    expect(result.items[0]).toMatchObject({ id: 'q-run-local', grade: 'partial', reference: 'code' });
    expect(result.score).toBe(50);
  }, 120_000);
});

describe('okb repo exam', () => {
  it('shows the plan and the cost first, runs on --yes, and keeps the result', async () => {
    const { json } = await import('./helpers/team.js');
    const { config, env, kb, dir, repo } = await demo();
    await writeFile(resolve(kb, repo.folder!, 'Base de données.md'), card('Base de données', 'La base de données du service est PostgreSQL, version 16.'));
    const fake = { ...env, OKB_AI: 'fake' };
    const added = await json(['repo', 'exam', repo.name, '--add', 'Quelle base de données utilise-t-il ?', '--expect', 'PostgreSQL version 16'], fake, dir);
    expect(added).toMatchObject({ ok: true, question: { text: 'Quelle base de données utilise-t-il ?' } });
    const plan = await json(['repo', 'exam', repo.name, '--only', 'custom'], fake, dir);
    expect(plan).toMatchObject({ ok: true, questions: [{ reference: 'expected' }] });
    expect(plan.tokens).toBeGreaterThan(0);
    expect(await lastExam(config, repo)).toBeNull();
    const ran = await json(['repo', 'exam', repo.name, '--only', 'custom', '--yes'], fake, dir);
    expect(ran).toMatchObject({ ok: true, exam: { score: 100, counts: { right: 1 } } });
    expect((await json(['repo', 'exam', repo.name, '--last'], fake, dir)).exam.score).toBe(100);
  }, 120_000);
});
