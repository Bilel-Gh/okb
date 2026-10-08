import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NOTE_TYPES } from '../src/brain/types.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { checkMermaid, diagramProblems } from '../src/markdown/mermaid.js';
import { proposeFiles } from '../src/proposal/files.js';
import { saveProposal } from '../src/proposal/store.js';
import { reviewOf } from '../src/repo/notes.js';
import { applyReadingProfile, readSettings } from '../src/settings/settings.js';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.js';
import { renderTemplateGuide, templateExample } from '../src/templates/registry.js';
import { asBundlePath } from '../src/util/paths.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(boxes.splice(0).map((s) => s.cleanup())); });

describe('the catalogue of templates', () => {
  it('has a template for every note type that names one, each starting with a brief', () => {
    const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    const missing = NOTE_TYPES.filter((t) => t.template && !ids.has(t.template)).map((t) => `${t.id} → ${t.template}`);
    expect(missing).toEqual([]);
    expect(ids.size).toBe(BUILTIN_TEMPLATES.length);
    for (const t of BUILTIN_TEMPLATES) {
      if (t.id === 'concept') continue;
      expect(t.sections[0]?.role, t.id).toBe('brief');
    }
  });

  it('prints the grid a good note checks, and every example belongs to a template', async () => {
    const ticket = BUILTIN_TEMPLATES.find((t) => t.id === 'ticket')!;
    expect(ticket.checks?.length).toBeGreaterThan(0);
    expect(renderTemplateGuide(ticket, 'fr')).toContain(ticket.checks![0]!.fr);
    const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    const files = await readdir(resolve(import.meta.dirname, '..', 'templates', 'examples'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(ids.has(f.replace(/\.(fr|en)\.md$/, '')), f).toBe(true);
    const example = await templateExample('ticket', 'fr');
    expect(example?.lang).toBe('fr');
    expect(example?.text).toMatch(/^---\n/);
    // No example in English yet: the French one is given rather than nothing.
    expect((await templateExample('ticket', 'en'))?.lang).toBe('fr');
    expect(await templateExample('no-such-template', 'fr')).toBeNull();
  });
});

describe('diagrams are checked before anyone reviews them', () => {
  const broken = '```mermaid\nflowchart LR\n  A[Commande --> B(\n```\n';
  const fine = '```mermaid\nflowchart LR\n  A[Commande] --> B[Facture]\n```\n';

  it('tells a diagram that parses from one that does not', async () => {
    expect(await checkMermaid('flowchart LR\n  A --> B')).toMatchObject({ ok: true });
    expect(await checkMermaid('sequenceDiagram\n  Alice->>Bob: bonjour')).toMatchObject({ ok: true });
    expect((await checkMermaid('flowchart LR\n  A[Commande --> B(')).ok).toBe(false);
    expect(await diagramProblems(`# Titre\n\n${fine}`)).toEqual([]);
    expect((await diagramProblems(`# Titre\n\n${broken}`))[0]?.line).toBe(3);
  }, 30_000);

  it('refuses a proposal whose diagram is broken, and keeps one whose diagram is fine', async () => {
    const s = await makeSandbox({ profileId: 'diag', answerLanguage: 'fr' });
    boxes.push(s);
    const config = await s.config();
    const bundle = await loadBundleFor(config);
    const doc = (body: string) => `---\ntype: Guide\ntitle: Flux\ndescription: Le flux de commande.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-10-01T10:00:00Z\n---\n\n# Flux\n\n${body}`;
    const bad = proposeFiles(config, bundle, new Map([[asBundlePath('guides/flux.md'), doc(broken)]]), 'test');
    await expect(saveProposal(config, bad)).rejects.toMatchObject({ key: 'mermaidInvalid' });
    const good = proposeFiles(config, bundle, new Map([[asBundlePath('guides/flux.md'), doc(fine)]]), 'test');
    await expect(saveProposal(config, good)).resolves.toBeTruthy();
  }, 30_000);
});

describe('the reading profile', () => {
  it('sets the four sliders at once', async () => {
    const s = await makeSandbox({ profileId: 'lecture', answerLanguage: 'fr' });
    boxes.push(s);
    const values = await applyReadingProfile('lecture', 'beginner-visual', s.env);
    expect(values['writing.diagrams']).toBe('prefer');
    const settings = new Map((await readSettings('lecture', s.env)).map((v) => [v.def.key, v.value]));
    expect(settings.get('reader.level')).toBe('beginner');
    expect(settings.get('writing.diagrams')).toBe('prefer');
    expect(settings.get('writing.examples')).toBe('project');
    await expect(applyReadingProfile('lecture', 'nope' as never, s.env)).rejects.toThrow(/unknown reading profile/);
  });

  it('keeps the reviewer’s grade within 0 to 20', () => {
    expect(reviewOf(17.6).score).toBe(18);
    expect(reviewOf(42).score).toBe(20);
    expect(reviewOf(-3)).toMatchObject({ score: 0, by: 'okb-quality-reviewer' });
  });
});

describe('the perfect examples', () => {
  it('have only diagrams that parse, and a brief first', async () => {
    const dir = resolve(import.meta.dirname, '..', 'templates', 'examples');
    for (const f of await readdir(dir)) {
      const body = await readFile(resolve(dir, f), 'utf8');
      expect(await diagramProblems(body), f).toEqual([]);
      if (!f.startsWith('concept.')) expect(body, f).toMatch(/\n## ⚡ (En bref|In short)\n/);
    }
  }, 60_000);
});
