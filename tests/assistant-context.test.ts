import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askAssistant, assistantSources, validateAnswer } from '../src/assistant/assistant.js';
import { locatedPassages } from '../src/assistant/passages.js';
import { createProject, updateProject } from '../src/projects/projects.js';
import { closeDbs } from '../src/state/db.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => { closeDbs(); await Promise.all(boxes.splice(0).map((b) => b.cleanup())); });
async function fixture() {
  const box = await makeSandbox({ profileId: 'context', language: 'fr' }); boxes.push(box);
  await writeFixture(resolve(box.vault, 'investigation.md'), '---\ntype: concept\ntitle: Investigation service Atlas\nstatus: stable\n---\n\n' + 'Un détail historique sans rapport.\n\n'.repeat(400) + '## Correction finale\n\nLe verrou QUASARLOCK doit être conservé 24 heures, car les retries tardifs causent un double effet.\n\nLe délai de dix minutes a été rejeté après le test multi-instance.\n');
  return { box, config: await box.config() };
}

describe('useful assistant context and bounded passages', () => {
  it('finds a unique relevant passage at the end of a long note and preserves its exact words', async () => {
    const { box, config } = await fixture();
    const sources = await assistantSources(config, box.env, 'QUASARLOCK');
    const note = sources.find((s) => s.path === 'investigation.md');
    expect(note?.quote).toContain('QUASARLOCK doit être conservé 24 heures');
    expect(note?.quote).toContain('dix minutes a été rejeté');
    expect(note!.quote.length).toBeLessThanOrEqual(4000);
    const { loadBundleFor } = await import('../src/kb/bundle.js');
    const body = (await loadBundleFor(config)).docs.get('investigation.md' as never)!.body;
    for (const passage of note!.passages!) { expect(passage.text).toBe(body.slice(passage.start, passage.end)); expect(passage.startLine).toBeGreaterThan(1); }
  });
  it('refuses a quote across synthetic selection boundaries, while accepting one raw located window', () => {
    const body = 'QUASARLOCK before.\n\n' + 'Unrelated history.\n'.repeat(300) + '\nCorrection finale : QUASARLOCK after.';
    const passages = locatedPassages(body, 'QUASARLOCK');
    const quote = passages.map((p) => p.text).join('\n\n[…]\n\n');
    const source = { id: 'S1', path: 'note.md', title: 'Note', kind: 'note' as const, quote, passages, hash: 'fixture' };
    const crossing = quote.slice(passages[0]!.text.length - 6, passages[0]!.text.length + 20);
    expect(quote).toContain(crossing);
    expect(() => validateAnswer({ statements: [{ text: 'Un raccourci inventé.', kind: 'notes', evidence: [{ source: 'S1', quote: crossing }] }], actions: [] }, [source])).toThrow(/contiguous/);
    expect(validateAnswer({ statements: [{ text: 'Correction.', kind: 'notes', evidence: [{ source: 'S1', quote: 'QUASARLOCK after.' }] }], actions: [] }, [source])).toBeTruthy();
  });
  it('reselects current evidence for a reformulated follow-up rather than losing the original subject', async () => {
    const { box, config } = await fixture();
    const run = async (request: { sources: { id: string; quote: string }[] }) => ({ answer: { statements: [{ text: 'La durée vient du test.', kind: 'notes', evidence: [{ source: request.sources[0]!.id, quote: 'QUASARLOCK doit être conservé 24 heures' }] }], actions: [] }, usage: { input: 1, output: 1 }, provider: 'fixture' });
    const first = await askAssistant(config, box.env, { question: 'QUASARLOCK' }, { run });
    const followup = await askAssistant(config, box.env, { question: 'Pourquoi cette durée ?', conversation: first.conversation.id }, { run });
    expect(followup.conversation.messages.at(-1)!.answer!.sources.some((s) => s.path === 'investigation.md')).toBe(true);
  });
  it('uses current project facts and keeps that project for a follow-up without sending unrelated work', async () => {
    const { box, config } = await fixture();
    const project = createProject(config, { title: 'Investiguer QUASARLOCK', where: 'Test à deux instances', next: 'Vérifier les retries tardifs' });
    createProject(config, { title: 'Autre travail', where: 'NE-PAS-INJECTER' });
    const prompts: string[] = [];
    const run = async (request: { prompt: string }) => { prompts.push(request.prompt); return { answer: { statements: [{ text: 'Je ne sais pas.', kind: 'unknown', evidence: [] }], actions: [] }, usage: { input: 1, output: 1 }, provider: 'fixture' }; };
    const first = await askAssistant(config, box.env, { question: 'Où j’en étais ?', project: project.id }, { run });
    updateProject(config, project.id, { next: 'Faire la recette' });
    await askAssistant(config, box.env, { question: 'Et ensuite ?', conversation: first.conversation.id }, { run });
    expect(prompts[0]).toContain('Vérifier les retries tardifs');
    expect(prompts[1]).toContain('Faire la recette');
    expect(prompts.join('')).not.toContain('NE-PAS-INJECTER');
  });
});
