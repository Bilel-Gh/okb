import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { loadConfig } from '../src/config/load.js';
import { commitStyle, productView, reviewContext, shipFacts } from '../src/dev/dev.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import type { RepoEntry } from '../src/repo/registry.js';
import { runSetup } from '../src/setup/setup.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

const note = (title: string, type: string) => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  brain:\n    type: ${type}\n---\n\n# ${title}\n\nTexte.\n`;

async function brain(extra: Record<string, string> = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-dev-')));
  made.push(dir);
  const kb = resolve(dir, 'kb');
  await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 2, repos: 3, tickets: 10, meetings: 4, concepts: 8 }));
  for (const [p, c] of Object.entries(extra)) { await mkdir(resolve(kb, p, '..'), { recursive: true }); await writeFile(resolve(kb, p), c); }
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  return { dir, env, config, bundle: await loadBundleFor(config) };
}

const repoEntry = (path: string): RepoEntry => ({ id: 'atlas-api', name: 'atlas-api', path, remote: null, kb: 'travail', addedAt: '2026-10-01', product: 'Atlas' });

describe('before a review', () => {
  it('reads the team’s rules, the repository’s conventions and its traps — not another repository’s', async () => {
    const { config, bundle } = await brain({
      '3 Boîte à outils/Règles d’équipe/Nommer les branches.md': note('Nommer les branches', 'team-rule'),
      '3 Boîte à outils/Règles d’équipe/Leçons de revue.md': note('Leçons de revue', 'review-lessons'),
      '2 Produits/Atlas/Code/atlas-api/atlas-api — Conventions.md': note('atlas-api — Conventions', 'conventions'),
      '2 Produits/Atlas/Support/Erreur — jeton expiré.md': note('Erreur — jeton expiré', 'known-error'),
      '2 Produits/Boréal/Code/boreal-web/boreal-web — Conventions.md': note('boreal-web — Conventions', 'conventions'),
    });
    const review = await reviewContext(config, bundle, { repo: repoEntry('/nowhere'), files: ['src/billing/tax.ts'] });
    expect(review.rules.map((r) => [r.title, r.level])).toEqual([['atlas-api — Conventions', 'repo'], ['Leçons de revue', 'shared'], ['Nommer les branches', 'shared']]);
    expect(review.lessons?.title).toBe('Leçons de revue');
    expect(review.traps.map((r) => r.title)).toContain('Erreur — jeton expiré');
    expect(review.traps.every((r) => !r.path.includes('Boréal'))).toBe(true);
  }, 60_000);
});

describe('before a commit or a pull request', () => {
  it('learns the team’s commit style', () => {
    const style = commitStyle(['feat(export): paginate', 'fix: rounding of VAT', 'Merge branch x', 'ABC-12: add the export', 'chore: update deps']);
    expect(style.conventional).toBe(0.75);
    expect(style.ticketPrefix).toBe(0.25);
    expect(style.language).toBe('en');
    expect(commitStyle(['Ajout de la pagination', 'Correction du calcul de la TVA']).language).toBe('fr');
  });

  it('gathers the branch’s commits, files and the PR template, and keeps credit lines off by default', async () => {
    const { dir, env } = await brain();
    const repo = resolve(dir, 'atlas-api');
    await mkdir(resolve(repo, '.github'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=dev@example.test', '-c', 'user.name=Dev', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    await writeFile(resolve(repo, 'README.md'), '# atlas-api\n');
    await writeFile(resolve(repo, '.github', 'pull_request_template.md'), '## Pourquoi\n\n## Comment tester\n');
    git('add', '.');
    git('commit', '-q', '-m', 'chore: initial');
    git('checkout', '-q', '-b', 'feature/ABC-1-export');
    await writeFile(resolve(repo, 'export.ts'), 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feat(export): paginate the CSV export');
    const facts = await shipFacts(repoEntry(repo), { ticket: null, ticketNote: null, env });
    expect(facts.branch).toBe('feature/ABC-1-export');
    expect(facts.base).toBe('main');
    expect(facts.commits.map((c) => c.subject)).toEqual(['feat(export): paginate the CSV export']);
    expect(facts.files.map((f) => f.path)).toEqual(['export.ts']);
    expect(facts.prTemplate?.path).toBe('.github/pull_request_template.md');
    expect(facts.style.conventional).toBe(1);
    expect(facts.attribution).toBe('off');
  }, 60_000);
});

describe('a product seen whole', () => {
  it('says which kinds of note it has and which are still missing', async () => {
    const { bundle } = await brain();
    const view = productView({ preset: 'work', lang: 'fr' }, bundle, 'Atlas');
    expect(view.notes).toBeGreaterThan(10);
    expect(view.sides.map((s) => s.name)).toContain('Code');
    expect([...view.have, ...view.missing].map((k) => k.type)).toEqual(expect.arrayContaining(['feature', 'context', 'known-error']));
    expect(view.missing.length).toBeGreaterThan(0);
  }, 60_000);
});
