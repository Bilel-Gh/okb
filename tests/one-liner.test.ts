import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glossary, termsOfNote } from '../src/brain/views.js';
import { layoutOf } from '../src/brain/layout.js';
import { conceptsWithoutOneLiner, oneLiner } from '../src/concepts/one-liner.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { scoreBundle } from '../src/scores/scores.js';
import { demoBrain } from './helpers/brain.js';

describe('a concept in one sentence', () => {
  it('takes the first sentence under « En une phrase »', () => {
    expect(oneLiner('# SLA\n\n## 🎯 En une phrase\n\nUn contrat qui fixe le niveau de service promis. Il dit aussi les pénalités.\n\n## Exemple\n\nTexte.', 'SLA'))
      .toEqual({ text: 'Un contrat qui fixe le niveau de service promis.', reason: 'ok' });
  });

  it('falls back on « En bref » and drops a leading « Term : »', () => {
    expect(oneLiner('## En bref\n\nSLA : un contrat qui fixe le niveau de service.', 'SLA'))
      .toEqual({ text: 'Un contrat qui fixe le niveau de service.', reason: 'ok' });
    expect(oneLiner('## In one sentence\n\nIdempotence — calling twice changes nothing more than calling once.', 'Idempotence'))
      .toEqual({ text: 'Calling twice changes nothing more than calling once.', reason: 'ok' });
  });

  it('keeps the readable text of bold, links and inline code', () => {
    expect(oneLiner('## En une phrase\n\n**SLA** est un [contrat](x.md) de service avec un `délai` garanti.', 'SLA').text)
      .toBe('SLA est un contrat de service avec un délai garanti.');
  });

  it('refuses a sentence that is too long, too short, or missing', () => {
    const long = `## En une phrase\n\n${Array.from({ length: 30 }, (_, i) => `mot${i}`).join(' ')}.`;
    expect(oneLiner(long, 'X')).toEqual({ text: null, reason: 'too-long' });
    expect(oneLiner('## En une phrase\n\nSLA.', 'SLA')).toEqual({ text: null, reason: 'too-short' });
    expect(oneLiner('## Exemple\n\nUn exemple concret ici.', 'SLA')).toEqual({ text: null, reason: 'missing' });
  });

  it('never reads a code block as the sentence', () => {
    expect(oneLiner('## En une phrase\n\n```\nnot a sentence at all here\n```\n\nLe vrai texte qui explique la notion.', 'X').text)
      .toBe('Le vrai texte qui explique la notion.');
  });
});

describe('concept cards in a brain', () => {
  const card = (title: string, body: string) => `---\ntype: Concept\ntitle: ${title}\ndescription: ${title} expliqué en une minute.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  brain:\n    type: concept\n---\n\n# ${title}\n\n${body}\n`;

  async function brainWith() {
    const b = await demoBrain();
    const dir = resolve(b.kb, '3 Boîte à outils', 'Concepts');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'Notion Alpha.md'), card('Notion Alpha', '## 🎯 En une phrase\n\nRefaire la même action ne change rien de plus.'));
    await writeFile(resolve(dir, 'Notion Beta.md'), card('Notion Beta', '## Exemple\n\nUne commande en plusieurs étapes.'));
    return { ...b, bundle: await loadBundleFor(b.config) };
  }

  it('gives each glossary entry its one-line definition, or none', async () => {
    const { config, bundle } = await brainWith();
    const entries = glossary(layoutOf(config), bundle);
    expect(entries.find((e) => e.term === 'Notion Alpha')!.oneLiner).toBe('Refaire la même action ne change rien de plus.');
    expect(entries.find((e) => e.term === 'Notion Beta')!.oneLiner).toBeNull();
  }, 60_000);

  it('lists the cards without a valid sentence, and the quality score says so', async () => {
    const { config, bundle } = await brainWith();
    const missing = conceptsWithoutOneLiner(config, bundle);
    expect(missing.some((m) => m.title === 'Notion Beta' && m.reason === 'missing')).toBe(true);
    expect(missing.some((m) => m.title === 'Notion Alpha')).toBe(false);
    const scores = await scoreBundle(config, bundle);
    expect(scores.find((s) => s.path.endsWith('Notion Beta.md'))!.notes).toContain('no one-line definition');
    expect(scores.find((s) => s.path.endsWith('Notion Alpha.md'))!.notes).not.toContain('no one-line definition');
  }, 60_000);
});

describe('okb concepts check', () => {
  it('lists the cards without a sentence and, asked to, makes a « complete » suggestion for each', async () => {
    const { json } = await import('./helpers/team.js');
    const b = await demoBrain();
    const dir = resolve(b.kb, '3 Boîte à outils', 'Concepts');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'Notion Beta.md'), `---\ntype: Concept\ntitle: Notion Beta\ndescription: x\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  brain:\n    type: concept\n---\n\n# Notion Beta\n\n## Exemple\n\nUn exemple.\n`);
    const r = await json(['concepts', 'check'], b.env, b.dir);
    expect(r.ok).toBe(true);
    expect(r.missing.map((m: { title: string }) => m.title)).toContain('Notion Beta');
    const s = await json(['concepts', 'check', '--suggest'], b.env, b.dir);
    const card = s.suggestions.find((x: { title: string }) => x.title === 'Notion Beta');
    expect(card).toMatchObject({ recommendation: 'complete', signal: 'concept', status: 'pending' });
  }, 60_000);
});

describe('the home page counts the concept cards of a brain (audit)', () => {
  it('counts concept cards wherever the brain files them, not only in a « concepts » folder', async () => {
    const { computeStatus } = await import('../src/status/status.js');
    const { config } = await demoBrain();
    const status = await computeStatus(config);
    expect(status.concepts).toBeGreaterThan(0);
  }, 60_000);
});

describe('a suggestion completes a note of its own kind first (seen on the demo)', () => {
  it('a concept suggestion points at the concept card rather than a ticket that mentions the word', async () => {
    const { buildCard, contextFor } = await import('../src/suggest/suggest.js');
    const { config } = await demoBrain({ concepts: 40, tickets: 40 });
    const bundle = await loadBundleFor(config);
    const card = buildCard(config, { type: 'concept', title: "Idempotence d'un webhook", why: 'demandé deux fois' }, await contextFor(config, bundle));
    expect(card.recommendation).not.toBe('create');
    const target = bundle.byPath.get(card.target!);
    expect((target?.ext as { brain?: { type?: string } }).brain?.type).toBe('concept');
  }, 60_000);
});

describe('the concept cards a note shows on hover', () => {
  const entry = (term: string, path: string, aliases: string[] = []) => ({ term, path: path as never, description: '', aliases, theme: null, oneLiner: `${term} en une phrase claire.` });
  const cards = [entry('SLA', 'c/SLA.md', ['accord de service']), entry('Revue hebdo', 'c/revue-hebdo.md'), entry('OData', 'c/OData.md')];

  it('takes the cards whose words the note uses, and the cards it links whatever the words', () => {
    const body = 'Notre accord de service. Voir [la revue](../c/revue-hebdo.md).';
    const found = termsOfNote(cards, 'n/note.md', body, new Set(['c/revue-hebdo.md']));
    expect(found.map((t) => t.term)).toEqual(['SLA', 'Revue hebdo']);
  });

  it('never the note itself', () => {
    expect(termsOfNote(cards, 'c/SLA.md', 'Le SLA.', new Set())).toEqual([]);
  });
});

describe('a sentence with abbreviations (M2)', () => {
  it('does not stop at « p. ex. », « e.g. » or « M. »', () => {
    expect(oneLiner('## En une phrase\n\nUn délai garanti, p. ex. Une réponse en 2 h. Le reste suit.', 'SLA').text)
      .toBe('Un délai garanti, p. ex. Une réponse en 2 h.');
    expect(oneLiner('## In one sentence\n\nA promised level of service, e.g. Replies within two hours. More below.', 'SLA').text)
      .toBe('A promised level of service, e.g. Replies within two hours.');
  });
});
