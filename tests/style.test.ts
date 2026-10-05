import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { loadConfig } from '../src/config/load.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { maintain } from '../src/maintain/maintain.js';
import { compressBlockIds, expandBlockRanges, renderAnalysis, validateAnalysis } from '../src/pipeline/analysis.js';
import { prepareProposal } from '../src/pipeline/ingest.js';
import { saveProposal } from '../src/proposal/store.js';
import { checkRevision, proposeRevision } from '../src/revise/revise.js';
import { runSetup } from '../src/setup/setup.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { formatLocator, type NormalizedDoc } from '../src/sources/types.js';
import { renderBrief } from '../src/style/brief.js';
import { resolveStyle, type WritingStyle } from '../src/style/resolve.js';
import { asBundlePath } from '../src/util/paths.js';
import type { OkbConfig } from '../src/config/schema.js';
import { FIXTURE_SOURCES, makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(boxes.splice(0).map((s) => s.cleanup()));
});

async function env(extra: Record<string, unknown> = {}) {
  const s = await makeSandbox({ profileId: 'reader', answerLanguage: 'fr', ...extra });
  boxes.push(s);
  return { s, config: await s.config() };
}

async function source(config: OkbConfig, file: string): Promise<NormalizedDoc> {
  return extractSource(await acquire(resolve(FIXTURE_SOURCES, file), config), config);
}

function pedagogicalStyle(config: OkbConfig, set: string[] = []): WritingStyle {
  return resolveStyle({ ...config, writing: { ...config.writing, preset: 'pedagogique' } }, { set }).style;
}

describe('writing style configuration', () => {
  it('starts from the standard preset and the answer language', async () => {
    const { config } = await env();
    const { style, reader, adjustments } = resolveStyle(config);
    expect(style).toMatchObject({ preset: 'standard', language: 'fr', analogies: 'off', emojis: 'off' });
    expect(reader.level).toBe('intermediate');
    expect(adjustments).toEqual([]);
  });

  it('applies profile overrides on top of the preset and reports them', async () => {
    const { config } = await env({ writing: { preset: 'pedagogique', emojis: 'off', instructions: ['Jamais infantilisant.'] } });
    const { style, adjustments } = resolveStyle(config);
    expect(style).toMatchObject({ preset: 'pedagogique', analogies: 'when-useful', emojis: 'off', examples: 'project' });
    expect(style.instructions).toEqual(['Jamais infantilisant.']);
    expect(adjustments).toEqual([{ key: 'emojis', value: 'off', from: 'configuration' }]);
  });

  it('adjusts one request without touching the profile', async () => {
    const { s, config } = await env({ writing: { preset: 'pedagogique', emojis: 'off' } });
    const once = resolveStyle(config, { set: ['detail=thorough', 'language=en'], notes: ['Mention the retry key.'] });
    expect(once.style).toMatchObject({ detail: 'thorough', language: 'en', emojis: 'off' });
    expect(once.style.instructions).toContain('Mention the retry key.');
    expect(once.adjustments.filter((a) => a.from === 'request').map((a) => a.key)).toEqual(['detail', 'language']);
    const profile = YAML.parse(await readFile(resolve(s.home, 'profiles', 'reader', 'profile.yaml'), 'utf8'));
    expect(profile.writing).toEqual({ preset: 'pedagogique', emojis: 'off' });
  });

  it('treats a one-off preset as a fresh starting point', async () => {
    const { config } = await env({ writing: { preset: 'pedagogique', emojis: 'off', instructions: ['Court.'] } });
    const { style } = resolveStyle(config, { preset: 'expert' });
    expect(style).toMatchObject({ preset: 'expert', analogies: 'off', defineTerms: 'off', language: 'fr' });
    expect(style.instructions).toEqual(['Court.']);
  });

  it('refuses unknown settings and values instead of guessing', async () => {
    const { config } = await env();
    expect(() => resolveStyle(config, { set: ['humour=high'] })).toThrow(/unknown style setting/);
    expect(() => resolveStyle(config, { set: ['emojis=lots'] })).toThrow(/invalid value "lots" for emojis/);
    expect(() => resolveStyle(config, { preset: 'casual' })).toThrow(/unknown writing preset/);
  });

  it('keeps reader knowledge and concept assist separate from style, per domain', async () => {
    const { config } = await env({ reader: { level: 'expert', byDomain: { 'ia-agentique': 'beginner' } } });
    const tuned: OkbConfig = { ...config, conceptAssist: { ...config.conceptAssist, byDomain: { 'ia-agentique': 'pedagogical' }, known: ['TypeScript'] } };
    const inDomain = resolveStyle(tuned, { domain: 'ia-agentique' });
    expect(inDomain.reader).toEqual({ level: 'beginner', domain: 'ia-agentique', from: 'domain' });
    expect(inDomain.conceptAssist).toEqual({ level: 'pedagogical', knownTerms: ['TypeScript'] });
    expect(resolveStyle(tuned).reader.level).toBe('expert');
    expect(inDomain.style.preset).toBe('standard');
  });

  it('lets a KB declare a house style over the personal one', async () => {
    const { s } = await env({ writing: { preset: 'pedagogique' } });
    await writeFixture(resolve(s.vault, '.okb', 'kb.yaml'), 'writing:\n  emojis: off\n  language: en\n');
    const { config } = await loadConfig({ env: s.env, profileId: 'reader' });
    expect(resolveStyle(config).style).toMatchObject({ preset: 'pedagogique', emojis: 'off', language: 'en' });
  });

  it('preserves writing and reader preferences across a later setup', async () => {
    const { s } = await env({ writing: { preset: 'pedagogique', tone: 'neutral' }, reader: { level: 'beginner' } });
    await runSetup({ profileId: 'reader', kbRoot: s.vault, conceptAssist: 'off', writingPreset: 'expert' }, { env: s.env });
    const profile = YAML.parse(await readFile(resolve(s.home, 'profiles', 'reader', 'profile.yaml'), 'utf8'));
    expect(profile.writing).toEqual({ preset: 'expert', tone: 'neutral' });
    expect(profile.reader).toEqual({ level: 'beginner' });
  });

  it('renders a short brief that always carries the common rules', async () => {
    const { config } = await env({ writing: { preset: 'pedagogique' }, reader: { level: 'beginner' } });
    const fr = renderBrief(resolveStyle(config));
    expect(fr).toContain('Règles communes (non modifiables)');
    expect(fr).toContain('indique toujours où elle s’arrête');
    expect(fr).toContain('Ne suppose aucune connaissance');
    expect(Buffer.byteLength(fr)).toBeLessThan(4096);
    const expert = renderBrief(resolveStyle(config, { preset: 'expert', set: ['language=en'] }));
    expect(expert).toContain('Common rules (not configurable)');
    expect(expert).toContain('No analogies.');
    expect(expert).toContain('Quotes, excerpts and code stay identical');
  });
});

describe('dossier version 2', () => {
  async function fixture(styleSet: string[] = []) {
    const { s, config } = await env({ writing: { preset: 'pedagogique' } });
    const notes = await source(config, 'dispatcher-notes.md');
    const code = await source(config, 'dispatch.ts');
    const style = pedagogicalStyle(config, styleSet);
    const assign = code.blocks.find((b) => b.text.includes('export function assignJob'))!;
    const intro = notes.blocks.find((b) => b.text.startsWith('The dispatcher assigns'))!;
    const analysis = {
      version: 2,
      sources: [notes.source.sha256, code.source.sha256],
      style,
      reviewedBlockIds: [...notes.blocks, ...code.blocks].map((b) => b.id),
      sections: [{
        heading: '🎯 À quoi sert le répartiteur',
        claims: [
          { id: 'one-job', text: 'Le répartiteur attribue un seul travail par robot.', kind: 'reported', evidence: [{ blockId: intro.id, quote: 'The dispatcher assigns one job per robot.' }] },
          { id: 'same-key', text: 'Une requête rejouée avec la même clé renvoie le même travail.', kind: 'reported', evidence: [
            { blockId: assign.id, quote: 'if (existing) return existing;' },
            { blockId: intro.id, quote: 'the\ncustomer service retries aggressively' },
          ] },
        ],
        aids: [
          { type: 'analogy', text: 'Comme un ticket de vestiaire : présenter deux fois le même ticket rend le même manteau.', limits: 'Un vestiaire ne crée rien ; ici le premier passage crée le travail.', basedOn: ['same-key'] },
          { type: 'diagram', mermaid: 'flowchart LR\n  R[Requête] --> K{Clé connue ?}\n  K -- oui --> S[Même travail]\n  K -- non --> N[Nouveau travail]', caption: 'Rejouer une requête', basedOn: ['same-key'] },
        ],
      }],
      openQuestions: ['Combien de temps une clé est-elle conservée ?'],
      related: [
        { path: 'concepts/idempotence.md', relation: 'prerequisite' },
        { path: 'flows/run-a-delivery-job.md', relation: 'deeper', why: 'le parcours complet d’une livraison' },
        { path: 'flows/not-written-yet.md', relation: 'next' },
      ],
    };
    return { s, config, notes, code, style, analysis, assign };
  }

  it('reads source code with exact line ranges and the enclosing symbol', async () => {
    const { config } = await env();
    const code = await source(config, 'dispatch.ts');
    expect(code.source).toMatchObject({ kind: 'code', support: 'full' });
    expect(code.source.title).toMatch(/tests\/fixtures\/sources\/dispatch\.ts$/);
    const assign = code.blocks.find((b) => b.text.includes('export function assignJob'))!;
    expect(formatLocator(assign.locator)).toBe('assignJob, l.6–14');
    expect(assign.text).toContain('\n\n  const job');
    const raw = await readFile(resolve(FIXTURE_SOURCES, 'dispatch.ts'), 'utf8');
    for (const b of code.blocks) expect(raw).toContain(b.text);
    const { segment } = await import('../src/sources/adapters/code.js');
    const long = ['export function big() {', ...Array.from({ length: 60 }, (_, i) => `  const local${i} = ${i};`), '}'].join('\n');
    const parts = segment(long, 's');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => (p.locator as { symbol?: string }).symbol)).toEqual(parts.map(() => 'big'));
  });

  it('accepts aids wired to claims across several sources', async () => {
    const f = await fixture();
    const a = validateAnalysis(f.analysis, [f.notes, f.code]);
    expect(a.version).toBe(2);
  });

  it('refuses aids that rephrase nothing, styles that contradict the content and partial coverage', async () => {
    const f = await fixture();
    const orphanAid = structuredClone(f.analysis);
    orphanAid.sections[0]!.aids[0]!.basedOn = ['nowhere'];
    expect(() => validateAnalysis(orphanAid, [f.notes, f.code])).toThrow(/unknown claims/);
    const noAnalogies = { ...structuredClone(f.analysis), style: { ...f.style, analogies: 'off' } };
    expect(() => validateAnalysis(noAnalogies, [f.notes, f.code])).toThrow(/analogies off/);
    const fenced = structuredClone(f.analysis);
    (fenced.sections[0]!.aids[1] as { mermaid: string }).mermaid = '```mermaid\nflowchart LR\n```';
    expect(() => validateAnalysis(fenced, [f.notes, f.code])).toThrow(/bare Mermaid/);
    const noLimits = structuredClone(f.analysis);
    delete (noLimits.sections[0]!.aids[0] as { limits?: string }).limits;
    expect(() => validateAnalysis(noLimits, [f.notes, f.code])).toThrow(/invalid analysis dossier/);
    expect(() => validateAnalysis({ ...f.analysis, reviewedBlockIds: f.notes.blocks.map((b) => b.id) }, [f.notes, f.code])).toThrow(/every extracted block/);
    // The same declaration as ranges: shorter to write, checked the same way.
    const ranged = compressBlockIds([...f.notes.blocks, ...f.code.blocks].map((b) => b.id));
    expect(ranged.length).toBeLessThan(f.notes.blocks.length + f.code.blocks.length);
    expect(() => validateAnalysis({ ...f.analysis, reviewedBlockIds: ranged }, [f.notes, f.code])).not.toThrow();
    expect(() => validateAnalysis({ ...f.analysis, reviewedBlockIds: [...ranged, f.notes.blocks[0]!.id] }, [f.notes, f.code])).toThrow(/every extracted block/);
    expect(expandBlockRanges(['s#2-4', 'x#9'])).toEqual(['s#2', 's#3', 's#4', 'x#9']);
    expect(compressBlockIds(['s#0', 's#1', 's#2', 's#5', 't#1'])).toEqual(['s#0-2', 's#5', 't#1']);
    expect(() => validateAnalysis(f.analysis, [f.notes])).toThrow(/different source bytes/);
  });

  it('renders the recorded style: labels, landmarks, analogy limits, diagram and citations to each file', async () => {
    const f = await fixture();
    const a = validateAnalysis(f.analysis, [f.notes, f.code]);
    const md = renderAnalysis(a, [f.notes, f.code], { fromPath: asBundlePath('flows/dispatch.md') });
    expect(md).toContain('> ℹ️ Source rapportée');
    expect(md).toContain('> [!TIP]\n> **🧭 Analogie** — Comme un ticket de vestiaire');
    expect(md).toContain('> **Limite de l’analogie :** Un vestiaire ne crée rien');
    expect(md).toContain('```mermaid\nflowchart LR');
    expect(md).toContain('## ❓ Questions ouvertes');
    expect(md).toMatch(/\[\^dispatch-[0-9a-f]{10}-same-key\]: .*dispatch\.ts — assignJob, l\.6–14 ; Acme Robotics — dispatcher notes — /);
    const plain = renderAnalysis(validateAnalysis({ ...f.analysis, style: { ...f.style, emojis: 'off', language: 'en' } }, [f.notes, f.code]), [f.notes, f.code]);
    expect(plain).not.toMatch(/🧭|ℹ️|❓/);
    expect(plain).toContain('**Where the analogy stops:**');
    expect(plain).toContain('## Open questions');
  });

  it('creates a styled multi-source note whose links resolve, and says which related notes are missing', async () => {
    const f = await fixture();
    const report = await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('flows/dispatch.md'), title: 'Le répartiteur', description: 'Ce que garantit le répartiteur.', type: 'Guide' },
      analysis: f.analysis,
      conceptAssistLevel: 'off',
    });
    const p = report.proposal;
    expect(p.sourceUris).toHaveLength(2);
    expect(p.notes.join('\n')).toContain('flows/not-written-yet.md does not exist yet');
    const content = p.changes.find((c) => c.id === 'c-article')!.createDocument!.content;
    expect(content).toContain('type: Guide');
    expect(content).toContain('description: Ce que garantit le répartiteur.');
    expect(content).toMatch(/writing:\n\s+preset: pedagogique\n\s+language: fr/);
    expect(content).toContain('prereqs:\n    - concepts/idempotence.md');
    expect(content).toContain('**À lire avant :** [Idempotence](../concepts/idempotence.md)');
    expect(content).toContain('- [Run a delivery job](run-a-delivery-job.md) — le parcours complet d’une livraison');
    expect(content).not.toContain('not-written-yet');
    await saveProposal(f.config, p);
    await grantApproval(f.config, p, p.changes.map((c) => c.id), 'human:testuser');
    await applyProposal(f.config, p);
    const written = await readFile(resolve(f.s.vault, 'flows', 'dispatch.md'), 'utf8');
    expect(written.split('\n---\n')[1]).toBe(content.split('\n---\n')[1]);
    expect(written).toContain('ingested:');
  });

  it('flags notes written in another style without rewriting them', async () => {
    const f = await fixture();
    const p = (await prepareProposal(f.config, [f.notes, f.code], {
      target: { mode: 'create', path: asBundlePath('flows/dispatch.md'), title: 'Dispatch' }, analysis: f.analysis, conceptAssistLevel: 'off',
    })).proposal;
    await saveProposal(f.config, p);
    await grantApproval(f.config, p, p.changes.map((c) => c.id), 'human:testuser');
    await applyProposal(f.config, p);
    const before = await readFile(resolve(f.s.vault, 'flows', 'dispatch.md'), 'utf8');
    const report = await maintain({ ...f.config, writing: { ...f.config.writing, preset: 'expert' } });
    expect(report.issues.filter((i) => i.code === 'STYLE_DIFFERS').map((i) => i.path)).toEqual(['flows/dispatch.md']);
    expect(await readFile(resolve(f.s.vault, 'flows', 'dispatch.md'), 'utf8')).toBe(before);
  });
});

describe('style revision of an existing note', () => {
  const NOTE = [
    '---',
    'type: Guide',
    'title: Retries',
    'description: How retries work.',
    'status: stable',
    'generated: { by: "human:testuser", at: 2026-01-15T10:00:00Z }',
    'verified:',
    '  - by: "human:reviewer"',
    '    at: 2026-02-01T00:00:00Z',
    'x_okb:',
    '  v: 1',
    '  custom: kept',
    '---',
    '',
    'A retried request reuses its key.[^s1]',
    '',
    '> "Never create a second job." — Dana',
    '',
    '```ts',
    'if (existing) return existing;',
    '```',
    '',
    'Call `assignJob` once.',
    '',
    '[^s1]: weekly sync — 00:42.',
    '',
  ].join('\n');

  async function withNote() {
    const { s, config } = await env();
    await writeFile(resolve(s.vault, 'flows', 'retries.md'), NOTE);
    return { s, config, bundle: await loadBundleFor(config) };
  }

  it('keeps quotes, code and citations byte-identical while the prose changes', async () => {
    const f = await withNote();
    const body = NOTE.split('---\n').slice(2).join('---\n');
    const revised = body.replace('A retried request reuses its key.', '🔁 **En bref :** une requête rejouée réutilise sa clé.');
    const style = pedagogicalStyle(f.config);
    const { proposal, check } = proposeRevision(f.config, f.bundle, { path: asBundlePath('flows/retries.md'), revised, reason: 'style pédagogique', style });
    expect(check.missing).toEqual([]);
    expect(check.kept).toMatchObject({ quote: 1, code: 1, 'inline-code': 1, footnote: 1, citation: 1 });
    const after = proposal.changes[0]!.replaceDocument!.content;
    expect(after).toContain('status: draft');
    expect(after).toContain('custom: kept');
    expect(after).toContain('prior_verified:');
    expect(after).toMatch(/writing:\n\s+preset: pedagogique/);
    expect(after).toContain('verified: []');
    await saveProposal(f.config, proposal);
    await grantApproval(f.config, proposal, ['c-revision'], 'human:testuser');
    await applyProposal(f.config, proposal);
    expect(await readFile(resolve(f.s.vault, 'flows', 'retries.md'), 'utf8')).toBe(after);
  });

  it('refuses a revision that rewords a quote, drops code or loses a citation', async () => {
    const f = await withNote();
    const body = NOTE.split('---\n').slice(2).join('---\n');
    const style = pedagogicalStyle(f.config);
    const attempt = (revised: string) => proposeRevision(f.config, f.bundle, { path: asBundlePath('flows/retries.md'), revised, reason: 'test', style });
    expect(() => attempt(body.replace('Never create a second job.', 'Do not create a second job.'))).toThrow(/protected element/);
    expect(() => attempt(body.replace('if (existing) return existing;', 'if (found) return found;'))).toThrow(/protected element/);
    expect(() => attempt(body.replace('[^s1]', ''))).toThrow(/protected element/);
    expect(() => attempt(NOTE.replace('status: stable', 'status: deprecated'))).toThrow(/cannot change frontmatter "status"/);
    expect(() => attempt(body)).toThrow(/identical/);
    expect(checkRevision(body, body.replace('`assignJob`', 'assignJob')).missing).toEqual([{ kind: 'inline-code', text: 'assignJob' }]);
  });

  it('keeps every section of the note, emojis aside', async () => {
    const f = await withNote();
    const body = '\n## 🎯 À quoi ça sert\n\nTexte.[^s1]\n\n> "Never create a second job." — Dana\n\n```ts\nif (existing) return existing;\n```\n\nCall `assignJob` once.\n\n[^s1]: weekly sync — 00:42.\n';
    await writeFile(resolve(f.s.vault, 'flows', 'sections.md'), NOTE.split('---\n').slice(0, 2).join('---\n') + '---\n' + body);
    const bundle = await loadBundleFor(f.config);
    const attempt = (revised: string) => proposeRevision(f.config, bundle, { path: asBundlePath('flows/sections.md'), revised, reason: 'test' });
    expect(() => attempt(body.replace('## 🎯 À quoi ça sert', '## Pourquoi'))).toThrow(/removes or renames section/);
    expect(attempt(body.replace('## 🎯 À quoi ça sert', '## À quoi ça sert').replace('Texte.', 'Texte plus simple.')).proposal.changes).toHaveLength(1);
  });

  it('allows new wording in teaching callouts while protecting their citations and code', async () => {
    const f = await withNote();
    const body = NOTE.split('---\n').slice(2).join('---\n') + [
      '\n> [!NOTE]',
      '> **Example** — Retry with `job-key`.[^aid]',
      '>',
      '> ```sh',
      '> okb doctor',
      '> ```',
      '',
      '[^aid]: dispatcher notes — retries.',
      '',
    ].join('\n');
    const path = asBundlePath('flows/callout.md');
    await writeFile(resolve(f.s.vault, path), NOTE.slice(0, NOTE.indexOf('A retried')) + body);
    const bundle = await loadBundleFor(f.config);
    const attempt = (revised: string) => proposeRevision(f.config, bundle, { path, revised, reason: 'simplifier' });
    expect(attempt(body.replace('Retry with', 'Rejouer avec')).check.missing).toEqual([]);
    expect(() => attempt(body.replace('`job-key`', 'job-key'))).toThrow(/protected element/);
    expect(() => attempt(body.replace('okb doctor', 'okb maintain'))).toThrow(/protected element/);
    expect(() => attempt(body.replace('[^aid]', ''))).toThrow(/protected element/);
    const after = body.replace('> **Example** — Retry with `job-key`.[^aid]', '> **Example** — Retry with `job-key`.');
    expect(checkRevision(body, after).missing).toEqual([{ kind: 'citation', text: 'aid' }]);
  });

  it('never revises a generated index', async () => {
    const f = await withNote();
    expect(() => proposeRevision(f.config, f.bundle, { path: asBundlePath('index.md'), revised: '# Index\n', reason: 'x' })).toThrow(/generated index/);
  });
});
