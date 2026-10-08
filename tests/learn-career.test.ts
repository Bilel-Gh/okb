import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { achievementsIn, careerLeaks, careerPrep, careerStatus, exportCareer } from '../src/career/career.js';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { addObjective, collectCards, dueCards, finishObjective, gradeCard, listObjectives, parseRating, qaPairs, quizMaterial, skillsMap } from '../src/learn/learn.js';
import { runSetup } from '../src/setup/setup.js';

const made: string[] = [];
afterEach(async () => { for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });

const note = (title: string, type: string, body: string, extra = '') => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title} en une phrase.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  brain:\n    type: ${type}\n${extra}---\n\n# ${title}\n\n${body}\n`;

async function brain(extra: Record<string, string> = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-learn-')));
  made.push(dir);
  const kb = resolve(dir, 'kb');
  await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 2, repos: 2, tickets: 6, meetings: 2, concepts: 6 }));
  for (const [p, c] of Object.entries(extra)) { await mkdir(resolve(kb, p, '..'), { recursive: true }); await writeFile(resolve(kb, p), c); }
  const env = { ...process.env, OKB_HOME: resolve(dir, 'home'), OKB_PROFILE: 'travail', HOME: dir };
  await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: 'human:test', answerLanguage: 'fr', displayName: 'Travail', brain: { preset: 'work', names: 'fr' } }, { env });
  const { config } = await loadConfig({ env, profileId: 'travail' });
  return { dir, env, config, bundle: await loadBundleFor(config) };
}

const TRAINING = note('Formation OData', 'training', [
  '## 🃏 À réviser', '',
  '- Q : Que renvoie `$count` ? — R : le nombre d’éléments de la collection.',
  '- **Q** : Quel verbe crée une entité ?', '- **R** : POST.',
  '', '```', 'Q : dans un bloc de code — R : ignorée', '```',
].join('\n'));

describe('cards come from the notes', () => {
  it('reads « Q : … — R : … » lines and Q/R pairs, never inside code', () => {
    expect(qaPairs('- Q : A ? — R : B.\n**Q** : C ?\n**R** : D.\n```\nQ : x — R : y\n```\nQ: E? — A: F.')).toEqual([
      { q: 'A ?', a: 'B.' }, { q: 'C ?', a: 'D.' }, { q: 'E?', a: 'F.' },
    ]);
  });

  it('makes a card of every concept and every question, none of a secret note', async () => {
    const { config, bundle } = await brain({
      '4 Activité/Formations/Formation OData.md': TRAINING,
      '3 Boîte à outils/Concepts/Secret.md': note('Secret', 'concept', 'Texte.', '  confidentiality: secret\n'),
    });
    const cards = collectCards(config, bundle);
    expect(cards.some((c) => c.kind === 'concept' && c.front === 'C’est quoi « OData » ?')).toBe(true);
    expect(cards.filter((c) => c.title === 'Formation OData').map((c) => c.front)).toEqual(['Que renvoie `$count` ?', 'Quel verbe crée une entité ?']);
    expect(cards.some((c) => c.title === 'Secret')).toBe(false);
    // Ids are stable: the same note gives the same cards.
    expect(collectCards(config, await loadBundleFor(config)).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  }, 60_000);
});

describe('spaced review', () => {
  it('offers new cards within the daily limit, schedules them after an answer, and maps mastery by subject', async () => {
    const { config, bundle } = await brain({ '4 Activité/Formations/Formation OData.md': TRAINING });
    const now = new Date('2026-10-07T09:00:00Z');
    const first = await dueCards(config, bundle, { now, newPerDay: 3 });
    expect(first.fresh.length).toBe(3);
    expect(first.due).toEqual([]);
    const card = first.fresh[0]!;
    expect(parseRating('bien')).toBe(parseRating('good'));
    const graded = await gradeCard(config, card.id, parseRating('easy')!, now);
    expect(graded.interval).toBeGreaterThanOrEqual(1);
    const after = await dueCards(config, bundle, { now, newPerDay: 3 });
    expect(after.counts.newLeft).toBe(2);
    expect(after.fresh.map((c) => c.id)).not.toContain(card.id);
    const later = await dueCards(config, bundle, { now: new Date(graded.due), newPerDay: 0 });
    expect(later.due.map((c) => c.id)).toEqual([card.id]);
    const map = await skillsMap(config, bundle);
    expect(map.reduce((a, m) => a + m.cards, 0)).toBe(collectCards(config, bundle).length);
    expect(map.some((m) => m.levels.learning + m.levels.known + m.levels.mastered === 1)).toBe(true);
  }, 60_000);

  it('gives a quiz its material and keeps learning objectives', async () => {
    const { config, bundle } = await brain();
    const quiz = quizMaterial(config, bundle, { folder: '2 Produits/Atlas/Code/atlas-api' });
    expect(quiz.notes.length).toBeGreaterThan(2);
    expect(quiz.notes.every((n) => n.path.startsWith('2 Produits/Atlas/Code/atlas-api/'))).toBe(true);
    const o = await addObjective(config, { text: 'Comprendre OData', by: '2026-12-01' });
    await finishObjective(config, o.id);
    expect((await listObjectives(config))[0]).toMatchObject({ text: 'Comprendre OData', by: '2026-12-01' });
    expect((await listObjectives(config))[0]?.doneAt).not.toBeNull();
  }, 60_000);
});

const ACHIEVEMENTS = note('Réalisations 2026', 'achievements', [
  '## 🏆 Réalisations', '',
  '### 2026-09-20 — Les exports ne perdent plus de lignes', '',
  '- **Situation** : exports coupés pour Atlas.', '- **Tâche** : rendre l’export fiable.', '- **Action** : pagination, test (ABC-123).',
  '- **Résultat** : 14 200 lignes au lieu de 10 000, 12 000 € de litiges évités.', '- **Compétences** : débogage, Node.js.', '- **Preuves** : [ABC-123](../../ticket.md).',
  '', '### 2026-06-02 — Présentation à l’équipe', '', '- **Situation** : nouvelle équipe.', '- **Action** : une démo. Contact : chef@example.com',
].join('\n'));

describe('the career side', () => {
  it('reads STAR stories, their skills and what is missing', async () => {
    const entries = achievementsIn('x.md', 'Réalisations', ACHIEVEMENTS, false);
    expect(entries.map((e) => [e.date, e.star.length, e.hasProof])).toEqual([['2026-09-20', 4, true], ['2026-06-02', 2, false]]);
    expect(entries[0]!.skills).toEqual(['débogage', 'Node.js']);
    const { bundle, config } = await brain({ '4 Activité/Carrière/Réalisations/2026.md': ACHIEVEMENTS });
    const status = careerStatus(bundle, new Date('2026-10-07'));
    expect(status.achievements.length).toBe(2);
    expect(status.hints.map((h) => h.key)).toEqual(expect.arrayContaining(['incompleteStar', 'noGoals']));
    const prep = await careerPrep(config, bundle, '2026-09-01', new Date('2026-10-07'));
    expect(prep.achievements.map((a) => a.title)).toEqual(['Les exports ne perdent plus de lignes']);
  }, 60_000);

  it('finds what would leak before a portable copy, and copies only once it is clean', async () => {
    const { dir, config, bundle } = await brain({ '4 Activité/Carrière/Réalisations/2026.md': ACHIEVEMENTS });
    const leaks = await careerLeaks(config, bundle, ['équipe']);
    const kinds = new Set(leaks.map((l) => l.kind));
    for (const k of ['product', 'ticket', 'email', 'amount', 'custom']) expect(kinds, k).toContain(k);
    await expect(exportCareer(config, bundle, resolve(dir, 'carriere'))).rejects.toMatchObject({ key: 'careerLeaks' });
    expect(await readdir(resolve(dir, 'carriere')).catch(() => null)).toBeNull();

    const clean = await brain({ '4 Activité/Carrière/Réalisations/2026.md': note('Réalisations 2026', 'achievements', '## 🏆 Réalisations\n\n### 2026-09-20 — Un export fiable\n\n- **Situation** : un export de données coupé.\n- **Résultat** : des fichiers complets. [preuve](../../x.md)\n') });
    expect(await careerLeaks(clean.config, clean.bundle)).toEqual([]);
    const out = resolve(clean.dir, 'carriere');
    const r = await exportCareer(clean.config, clean.bundle, out);
    expect(r.written).toEqual(['2026.md']);
    const copied = await readFile(resolve(out, '2026.md'), 'utf8');
    expect(copied).toContain('[preuve]'.slice(1, -1));
    expect(copied).not.toContain('](../../x.md)');
  }, 60_000);
});
