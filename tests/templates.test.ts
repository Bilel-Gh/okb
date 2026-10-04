import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { saveProposal } from '../src/proposal/store.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { resolveStyle } from '../src/style/resolve.js';
import { getTemplate, loadTemplates, renderSkeleton } from '../src/templates/registry.js';
import { BUILTIN_TEMPLATES, type NoteTemplate } from '../src/templates/builtin.js';
import { asBundlePath } from '../src/util/paths.js';
import type { OkbConfig } from '../src/config/schema.js';
import type { NormalizedDoc } from '../src/sources/types.js';
import { FIXTURE_SOURCES, makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(boxes.splice(0).map((s) => s.cleanup()));
});

async function setup(extra: Record<string, unknown> = {}) {
  const s = await makeSandbox({ profileId: 'tpl', answerLanguage: 'fr', conceptAssist: 'pedagogical', writing: { preset: 'pedagogique' }, ...extra });
  boxes.push(s);
  const config = await s.config();
  const notes = await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'dispatcher-notes.md'), config), config);
  const code = await extractSource(await acquire(resolve(FIXTURE_SOURCES, 'dispatch.ts'), config), config);
  return { s, config, notes, code };
}

const block = (doc: NormalizedDoc, needle: string) => doc.blocks.find((b) => b.text.includes(needle))!;

function guideDossier(config: OkbConfig, notes: NormalizedDoc, code: NormalizedDoc, sections?: unknown[], concepts: unknown[] = []) {
  const intro = block(notes, 'The dispatcher assigns');
  const assign = block(code, 'export function assignJob');
  return {
    version: 2,
    template: 'guide',
    sources: [notes.source.sha256, code.source.sha256],
    style: resolveStyle(config).style,
    reviewedBlockIds: [...notes.blocks, ...code.blocks].map((b) => b.id),
    sections: sections ?? [
      { role: 'purpose', claims: [{ id: 'one-job', text: 'Le répartiteur attribue un seul travail par robot.', kind: 'reported', evidence: [{ blockId: intro.id, quote: 'The dispatcher assigns one job per robot.' }] }] },
      { heading: 'Une section libre', claims: [{ id: 'retries', text: 'Les sous-agents ne sont pas concernés ; le service client rejoue souvent ses requêtes.', kind: 'reported', evidence: [{ blockId: intro.id, quote: 'customer service retries aggressively' }] }] },
      { role: 'how', claims: [{ id: 'same-key', text: 'Une requête rejouée avec la même clé renvoie le même travail.', kind: 'reported', evidence: [{ blockId: assign.id, quote: 'if (existing) return existing;' }] }] },
    ],
    concepts,
  };
}

function richConcept(notes: NormalizedDoc, code: NormalizedDoc, term = 'Clé de rejeu', aliases = ['clés de rejeu']) {
  const intro = block(notes, 'The dispatcher assigns');
  const assign = block(code, 'export function assignJob');
  return {
    term,
    aliases,
    definition: 'identifiant porté par une requête pour qu’un rejeu renvoie le même travail au lieu d’en créer un second',
    evidence: [{ blockId: assign.id, quote: 'a retried request with the same key returns the same job' }],
    sections: [
      { role: 'how', claims: [{ id: 'key-lookup', text: 'Le répartiteur cherche d’abord la clé parmi les travaux connus.', kind: 'reported', evidence: [{ blockId: assign.id, quote: 'const existing = jobs.get(key);' }] }] },
      { role: 'pitfalls', claims: [{ id: 'key-retries', text: 'Elle compte parce que le service client rejoue beaucoup ses requêtes.', kind: 'reported', evidence: [{ blockId: intro.id, quote: 'customer service retries aggressively' }] }] },
    ],
    aids: [
      { type: 'analogy', text: 'Comme un ticket de vestiaire : le même ticket rend le même manteau.', limits: 'Le vestiaire ne crée rien ; ici, le premier passage crée le travail.', basedOn: ['definition'] },
      { type: 'example', text: 'Rejouer deux fois la requête de clé k1 renvoie le même travail.', basedOn: ['key-lookup'] },
      { type: 'diagram', mermaid: 'flowchart LR\n  R[Requête] --> K{Clé connue ?}\n  K -- oui --> M[Même travail]', caption: 'le rejeu', basedOn: ['key-lookup', 'definition'] },
    ],
  };
}

async function localTemplate(s: Sandbox, template: NoteTemplate, filename = `${template.id}.yaml`) {
  await writeFixture(resolve(s.vault, '.okb', 'templates', filename), YAML.stringify(template));
}

describe('note templates', () => {
  it('ships six templates, each with required landmarks, and a skeleton for hand-written notes', async () => {
    const { config } = await setup();
    const all = await loadTemplates(config);
    expect(all.map((t) => t.id)).toEqual(['guide', 'concept', 'procedure', 'process', 'tool', 'automation', 'experience', 'decision', 'meeting', 'tutorial', 'client-case', 'path', 'repo-overview', 'repo-architecture', 'repo-start', 'repo-interfaces', 'repo-delivery', 'repo-codemap', 'repo-ticket']);
    for (const t of all) expect(t.sections.some((s) => s.required)).toBe(true);
    const skeleton = renderSkeleton(await getTemplate(config, 'experience'), 'fr', true);
    expect(skeleton).toContain('## 🧩 Contexte');
    expect(skeleton).toContain('template: experience');
  });

  it('lets a KB replace a template with its own house structure', async () => {
    const { s, config } = await setup();
    await writeFixture(resolve(s.vault, '.okb', 'templates', 'guide.yaml'), [
      'id: guide', 'okfType: Guide', 'folder: guides',
      'label: { fr: Guide maison, en: House guide }', 'when: { fr: toujours, en: always }',
      'sections:', '  - { role: purpose, emoji: "🏁", heading: { fr: Objectif, en: Goal }, required: true, guide: { fr: g, en: g } }',
    ].join('\n'));
    const t = await getTemplate(config, 'guide');
    expect(t.label.fr).toBe('Guide maison');
    expect(t.sections.map((x) => x.role)).toEqual(['purpose']);
  });

  it('rejects malformed local templates instead of accepting ambiguous structure or unsafe folders', async () => {
    const { s, config } = await setup();
    const guide = BUILTIN_TEMPLATES.find((t) => t.id === 'guide')!;
    await localTemplate(s, { ...guide, sections: [guide.sections[0]!, guide.sections[0]!] });
    await expect(loadTemplates(config)).rejects.toMatchObject({ code: 'E_CONFIG', detail: { issues: expect.arrayContaining([expect.objectContaining({ message: 'duplicate role "purpose"' })]) } });
    await localTemplate(s, { ...guide, folder: '../outside' });
    await expect(loadTemplates(config)).rejects.toMatchObject({ code: 'E_CONFIG' });
    await localTemplate(s, guide, 'mismatch.yaml');
    await localTemplate(s, guide);
    await expect(loadTemplates(config)).rejects.toThrow(/must declare id "mismatch"/);
  });

  it('reports invalid template YAML and rejects two local files with the same id', async () => {
    const { s, config } = await setup();
    const guide = BUILTIN_TEMPLATES.find((t) => t.id === 'guide')!;
    await writeFixture(resolve(s.vault, '.okb', 'templates', 'guide.yaml'), 'id: [broken');
    await expect(loadTemplates(config)).rejects.toMatchObject({ code: 'E_CONFIG', message: expect.stringContaining('invalid YAML') });
    await localTemplate(s, guide);
    await localTemplate(s, guide, 'guide.yml');
    await expect(loadTemplates(config)).rejects.toThrow(/duplicate local note template/);
  });

  it('keeps source and definition mandatory and rejects unsupported roles for concept templates', async () => {
    const { s, config } = await setup();
    const concept = BUILTIN_TEMPLATES.find((t) => t.id === 'concept')!;
    await localTemplate(s, { ...concept, sections: concept.sections.filter((section) => section.role !== 'source') });
    await expect(loadTemplates(config)).rejects.toMatchObject({ code: 'E_CONFIG' });
    await localTemplate(s, { ...concept, sections: [...concept.sections, { ...concept.sections[0]!, role: 'invented' }] });
    await expect(loadTemplates(config)).rejects.toMatchObject({ code: 'E_CONFIG' });
  });

  it('renders role sections with the template headings and records the template', async () => {
    const f = await setup();
    const p = (await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/dispatch.md'), title: 'Le répartiteur' },
      analysis: guideDossier(f.config, f.notes, f.code), conceptAssistLevel: 'off',
    })).proposal;
    const content = p.changes.find((c) => c.id === 'c-article')!.createDocument!.content;
    expect(content).toContain('type: Guide');
    expect(content).toContain('template: guide');
    expect(content.indexOf('## 🎯 À quoi ça sert')).toBeLessThan(content.indexOf('## Une section libre'));
    expect(content.indexOf('## Une section libre')).toBeLessThan(content.indexOf('## 🔍 Comment ça marche'));
  });

  it('refuses a missing required role, a role out of order, a role with its own heading or an unknown role', async () => {
    const f = await setup();
    const base = guideDossier(f.config, f.notes, f.code);
    const sections = base.sections as { role?: string; heading?: string }[];
    const attempt = (secs: unknown[]) => prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/x.md'), title: 'X' }, analysis: { ...base, sections: secs }, conceptAssistLevel: 'off',
    });
    await expect(attempt([sections[0]])).rejects.toThrow(/requires: how/);
    await expect(attempt([sections[2], sections[0]])).rejects.toThrow(/out of order/);
    await expect(attempt([{ ...sections[0], heading: 'Mon titre' }, sections[2]])).rejects.toThrow(/takes its heading from the template/);
    await expect(attempt([sections[0], { ...sections[2], role: 'steps' }])).rejects.toThrow(/has no role "steps"/);
    await expect(prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/y.md'), title: 'Y' }, analysis: { ...base, template: 'concept' }, conceptAssistLevel: 'off',
    })).rejects.toThrow(/concepts array/);
  });

  it('reports a note that lost a required section of its template', async () => {
    const f = await setup();
    await writeFixture(resolve(f.s.vault, 'guides', 'hand.md'), '---\ntype: Guide\ntitle: Main\ndescription: d\nstatus: draft\ngenerated: { by: "human:x", at: 2026-01-01T00:00:00Z }\nx_okb:\n  v: 1\n  template: guide\n---\n\n## 🎯 À quoi ça sert\n\nTexte.\n');
    const { maintain } = await import('../src/maintain/maintain.js');
    const report = await maintain(f.config);
    expect(report.issues.find((i) => i.path === 'guides/hand.md')).toMatchObject({ code: 'TEMPLATE_DRIFT', message: expect.stringContaining('how') });
  });

  it('can require a template for every new note', async () => {
    const f = await setup();
    const strict: OkbConfig = { ...f.config, kb: { ...f.config.kb, requireTemplate: true } };
    const { template: _ignored, ...withoutTemplate } = guideDossier(f.config, f.notes, f.code, [{ heading: 'Libre', claims: [{ id: 'one-job', text: 'Un travail par robot.', kind: 'reported', evidence: [{ blockId: block(f.notes, 'The dispatcher assigns').id, quote: 'one job per robot' }] }] }]);
    await expect(prepareProposal(strict, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/z.md'), title: 'Z' }, analysis: withoutTemplate, conceptAssistLevel: 'off',
    })).rejects.toThrow(/requires every new note to follow a template/);
  });
});

describe('concept cards from the concept template', () => {
  async function prepared() {
    const f = await setup();
    const dossier = guideDossier(f.config, f.notes, f.code, undefined, [richConcept(f.notes, f.code), {
      ...richConcept(f.notes, f.code, 'Répartiteur', ['répartiteurs']),
      definition: 'service qui attribue un travail à chaque robot et retrouve le travail existant d’une clé de rejeu',
      evidence: [{ blockId: block(f.notes, 'The dispatcher assigns').id, quote: 'The dispatcher assigns one job per robot.' }],
      sections: [], aids: [], seeAlso: [],
    }]);
    dossier.sections = [
      { role: 'purpose', claims: [{ id: 'one-job', text: 'Le répartiteur attribue un seul travail par robot ; les clés de rejeu évitent les doublons.', kind: 'reported', evidence: [{ blockId: block(f.notes, 'The dispatcher assigns').id, quote: 'The dispatcher assigns one job per robot.' }] }] },
      { role: 'how', claims: [{ id: 'same-key', text: 'Une requête rejouée renvoie le même travail.', kind: 'reported', evidence: [{ blockId: block(f.code, 'export function assignJob').id, quote: 'if (existing) return existing;' }] }] },
    ];
    const report = await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/dispatch.md'), title: 'Le répartiteur' }, analysis: dossier,
    });
    return { ...f, p: report.proposal };
  }

  it('writes a card with every landmark of the concept template, in the profile style', async () => {
    const { p } = await prepared();
    const change = p.changes.find((c) => c.path === 'concepts/cle-de-rejeu.md')!;
    const card = change.createDocument!.content;
    if (process.env.PRINT_CARD) (await import('node:fs')).writeFileSync(process.env.PRINT_CARD, card);
    for (const heading of ['## 🎯 En une phrase', '## 🧭 Pour se le représenter', '## 🔍 Comment ça marche', '## 💡 Exemple', '## 🗺️ Schéma', '## ⚠️ À ne pas confondre', '## 📌 Ce que dit la source']) {
      expect(card).toContain(heading);
    }
    expect(card).toContain('**Clé de rejeu** — identifiant porté par une requête');
    expect(card).toContain('**Limite de l’analogie :**');
    expect(card).toMatch(/template: concept/);
    expect(card).toMatch(/aliases:\n\s+- Clé de rejeu\n\s+- clés de rejeu/);
    expect(card).toMatch(/\[\^dispatch-[0-9a-f]{10}-key-lookup\]: .*assignJob, l\.6–14/);
    expect(change.evidenceIds).toEqual(expect.arrayContaining(p.evidence.filter((e) => e.quote.includes('customer service retries aggressively')).map((e) => e.id)));
  });

  it('lets a card name a card created by the same proposal in “see also”', async () => {
    const f = await setup();
    const dossier = guideDossier(f.config, f.notes, f.code, undefined, [{ ...richConcept(f.notes, f.code), seeAlso: ['concepts/repartiteur.md'] }, {
      ...richConcept(f.notes, f.code, 'Répartiteur', ['répartiteurs']),
      definition: 'service qui attribue un travail à chaque robot',
      evidence: [{ blockId: block(f.notes, 'The dispatcher assigns').id, quote: 'The dispatcher assigns one job per robot.' }],
      sections: [], aids: [], seeAlso: [],
    }]);
    const report = await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/dispatch.md'), title: 'Le répartiteur' }, analysis: dossier,
    });
    const card = report.proposal.changes.find((c) => c.path === 'concepts/cle-de-rejeu.md')!.createDocument!.content;
    expect(card).toMatch(/Voir aussi[\s\S]*\[Répartiteur\]\(repartiteur\.md\)/);
  });

  it('links the article through aliases (plurals) and links new cards to each other', async () => {
    const { s, config, p } = await prepared();
    const links = p.changes.filter((c) => c.kind === 'insert-links');
    expect(links.some((c) => c.path === 'guides/dispatch.md' && c.insertLinks!.insertions[0]!.original === 'clés de rejeu')).toBe(true);
    const cross = links.find((c) => c.path === 'concepts/repartiteur.md');
    expect(cross?.insertLinks!.insertions[0]!.target).toBe('concepts/cle-de-rejeu.md');
    expect(cross?.dependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^c-concept-/)]));
    await saveProposal(config, p);
    await grantApproval(config, p, p.changes.map((c) => c.id), 'human:testuser');
    const receipt = await applyProposal(config, p);
    expect(receipt.results.map((r) => r.path)).toEqual(expect.arrayContaining(['concepts/cle-de-rejeu.md', 'concepts/repartiteur.md', 'guides/dispatch.md']));
    expect(s.vault).toBeTruthy();
  });

  it('refuses a concept aid that rephrases nothing the concept says', async () => {
    const f = await setup();
    const concept = richConcept(f.notes, f.code);
    concept.aids = [{ type: 'example', text: 'x', basedOn: ['same-key'] }] as never;
    await expect(prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/w.md'), title: 'W' }, analysis: guideDossier(f.config, f.notes, f.code, undefined, [concept]),
    })).rejects.toThrow(/based on unknown claims: same-key/);
  });

  it('renders English headings without emojis and keeps citations on analogies and captionless diagrams', async () => {
    const f = await setup();
    const concept = richConcept(f.notes, f.code);
    concept.aids[2] = { ...concept.aids[2]!, caption: '' } as typeof concept.aids[number];
    const analysis = { ...guideDossier(f.config, f.notes, f.code, undefined, [concept]), style: resolveStyle(f.config, { set: ['language=en-GB', 'emojis=off'] }).style };
    const p = (await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/en.md'), title: 'Dispatcher' }, analysis,
    })).proposal;
    const card = p.changes.find((c) => c.category === 'concept-card' && c.path === 'concepts/cle-de-rejeu.md')!.createDocument!.content;
    expect(card).toContain('## In one sentence');
    expect(card).toContain('## What the source says');
    expect(card).not.toContain('## 🎯');
    expect(card).toMatch(/> \*\*Analogy\*\* — .*\[\^dispatch-[0-9a-f]{10}-definition\]/);
    expect(card).toMatch(/## Diagram\n\n\[\^dispatch-[0-9a-f]{10}-key-lookup\]\[\^dispatch-[0-9a-f]{10}-definition\]\n\n```mermaid/);
  });

  it('uses the KB-local concept order and heading, and enforces required rich sections', async () => {
    const f = await setup();
    const template = await getTemplate(f.config, 'concept');
    const source = template.sections.find((s) => s.role === 'source')!;
    const definition = template.sections.find((s) => s.role === 'definition')!;
    await localTemplate(f.s, { ...template, sections: [
      { ...source, heading: { fr: 'Preuves exactes', en: 'Exact evidence' } }, definition,
      ...template.sections.filter((s) => !['definition', 'source'].includes(s.role)).map((s) => ({ ...s, required: s.role === 'how' })),
    ] });
    const prepare = (concept: unknown) => prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/local.md'), title: 'Local' }, analysis: guideDossier(f.config, f.notes, f.code, undefined, [concept]),
    });
    const p = (await prepare(richConcept(f.notes, f.code))).proposal;
    const card = p.changes.find((c) => c.path === 'concepts/cle-de-rejeu.md')!.createDocument!.content;
    expect(card.indexOf('## 📌 Preuves exactes')).toBeLessThan(card.indexOf('## 🎯 En une phrase'));
    await expect(prepare({ ...richConcept(f.notes, f.code), sections: [], aids: [] })).rejects.toThrow(/requires role "how"/);
  });

  it('names every source behind a multi-source concept claim and records their resources', async () => {
    const f = await setup();
    const concept = richConcept(f.notes, f.code);
    concept.sections[0]!.claims[0]!.evidence.push({ blockId: block(f.notes, 'The dispatcher assigns').id, quote: 'The dispatcher assigns one job per robot.' });
    const p = (await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/multi.md'), title: 'Multi' }, analysis: guideDossier(f.config, f.notes, f.code, undefined, [concept]),
    })).proposal;
    const card = p.changes.find((c) => c.path === 'concepts/cle-de-rejeu.md')!.createDocument!.content;
    const footnote = card.split('\n').find((l) => /^\[\^.*-key-lookup\]:/.test(l))!;
    expect(footnote).toContain(`${f.code.source.title} —`);
    expect(footnote).toContain(`${f.notes.source.title} —`);
    expect(card).toContain(`urn:sha256:${f.notes.source.sha256}`);
    expect(card).toContain(`urn:sha256:${f.code.source.sha256}`);
  });

  it('publishes a short exact excerpt without reducing the full concept evidence', async () => {
    const f = await setup();
    const concept = richConcept(f.notes, f.code);
    const full = concept.evidence[0]!.quote;
    const short = 'same key returns the same job';
    const prepare = (evidence: unknown[]) => prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/short-quote.md'), title: 'Short quote' },
      analysis: guideDossier(f.config, f.notes, f.code, undefined, [{ ...concept, evidence }]),
    });
    const report = await prepare([{ ...concept.evidence[0], displayQuote: short }]);
    const card = report.proposal.changes.find((c) => c.path === 'concepts/cle-de-rejeu.md')!.createDocument!.content;
    expect(card).toContain(`> ${short}\n`);
    expect(card).not.toContain(`> ${full}\n`);
    expect(report.candidates.find((c) => c.rich?.term === concept.term)?.evidenceQuotes).toEqual([{ ...concept.evidence[0], displayQuote: short }]);
    expect(report.proposal.evidence.some((e) => e.quote.includes(full))).toBe(true);
    await expect(prepare([{ ...concept.evidence[0], displayQuote: 'same key always creates another job' }])).rejects.toThrow(/displayQuote is not a verbatim excerpt/);
    await expect(prepare([{ ...concept.evidence[0], displayQuote: ' ' }])).rejects.toThrow(/invalid analysis dossier/);
    await expect(prepare([{ ...concept.evidence[0], quote: 'invented support', displayQuote: 'invented' }])).rejects.toThrow(/quote is not a verbatim excerpt/);
  });

  it('rejects reserved ids, repeated roles, unsafe related paths and aids disabled by the recorded style', async () => {
    const f = await setup();
    const prepare = (concept: unknown, style = resolveStyle(f.config).style) => prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('guides/invalid.md'), title: 'Invalid' }, analysis: { ...guideDossier(f.config, f.notes, f.code, undefined, [concept]), style },
    });
    const concept = richConcept(f.notes, f.code);
    await expect(prepare({ ...concept, sections: [concept.sections[0], { ...concept.sections[0], claims: [{ ...concept.sections[0]!.claims[0], id: 'other-key' }] }] })).rejects.toThrow(/repeats a section role/);
    await expect(prepare({ ...concept, sections: [{ role: 'how', claims: [{ ...concept.sections[0]!.claims[0], id: 'definition' }] }], aids: [] })).rejects.toThrow(/reserved claim id/);
    await expect(prepare({ ...concept, seeAlso: ['../outside.md'] })).rejects.toThrow(/escapes the bundle/);
    await expect(prepare({ ...concept, seeAlso: ['concepts/not-a-note.txt'] })).rejects.toThrow(/must be a Markdown note/);
    await expect(prepare(concept, resolveStyle(f.config, { set: ['analogies=off'] }).style)).rejects.toThrow(/turns analogies off/);
    await expect(prepare({ ...concept, aids: [concept.aids[1]] }, resolveStyle(f.config, { set: ['examples=none'] }).style)).rejects.toThrow(/turns examples off/);
    await expect(prepare({ ...concept, aids: [concept.aids[2]] }, resolveStyle(f.config, { set: ['diagrams=off'] }).style)).rejects.toThrow(/turns diagrams off/);
  });
});
