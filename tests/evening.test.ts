import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OkbConfig } from '../src/config/schema.js';
import { invoke } from '../src/engine/registry.js';
import { eveningView, sayYes, type Presence } from '../src/evening/evening.js';
import { capture } from '../src/inbox/inbox.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeRootConfig } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { closeDbs } from '../src/state/db.js';
import { addSuggestion, contextFor, loadQueue, setStatus } from '../src/suggest/suggest.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());

const note = (title: string) => `---\ntype: Procedure\ntitle: ${title}\ndescription: ${title}, en une phrase.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2027-03-01T10:00:00Z\nx_okb:\n  v: 1\n  brain:\n    type: method\n---\n\n# ${title}\n\n1. Une étape.\n`;

/** A change an assistant prepared: one new note, waiting for the person's yes. */
async function change(config: OkbConfig, title: string): Promise<string> {
  const proposal = proposeFiles(config, await loadBundleFor(config), new Map([[`3 Boîte à outils/Méthodes/${title}.md`, note(title)]]), `write ${title}`);
  await saveProposal(config, proposal);
  return proposal.id;
}
async function card(config: OkbConfig, title: string): Promise<string> {
  const bundle = await loadBundleFor(config);
  return (await addSuggestion(config, { type: 'concept', title, why: 'the person asked what it is', signal: 'asked' }, await contextFor(config, bundle))).suggestion.id;
}
const yes = (answers: Presence[] = []) => { const asked: { changes: number; files: number }[] = []; return { asked, confirm: async (s: { changes: number; files: number }) => { asked.push(s); return answers.shift() ?? 'confirmed'; } }; };
const exists = (path: string) => access(path).then(() => true, () => false);

describe('the proportional yes (F2.0-13)', () => {
  it('what the person writes passes at once: nothing they capture, note or keep waits for a yes', async () => {
    const { config, env } = await demoBrain();
    const person = { config, env, actor: 'person' as const };
    await capture(config, { text: 'Le quota passe à 500 lundi.', tags: [] });
    const project = await invoke('projects.create', { title: 'Sortie de juin' }, person);
    await invoke('journal.add', { text: 'Le car est réservé.', project: project.id }, person);
    await invoke('actions.add', { text: 'Envoyer le programme' }, person);
    await invoke('documents.add', { name: 'devis.txt', data: Buffer.from('480 euros').toString('base64') }, person);
    const evening = await eveningView(config, env);
    expect([evening.cards, evening.changes, evening.apart]).toEqual([[], [], []]);
  });

  it('the evening gathers what an assistant proposed: the notes to write with their cost, the changes ready', async () => {
    const { config, env } = await demoBrain();
    const c1 = await card(config, 'Idempotence');
    const c2 = await card(config, 'Percentile');
    await setStatus(config, c2, 'later', 'person', undefined, env);
    const p1 = await change(config, 'Rejouer chaque appel');
    const evening = await invoke('evening.view', {}, { config, env, actor: 'person' });
    expect(evening.cards.map((c) => [c.id, c.title])).toEqual([[c1, 'Idempotence']]);
    expect(evening.changes).toEqual([{ id: p1, title: expect.stringContaining('Rejouer chaque appel'), files: 1, created: 1, updated: 0 }]);
    expect(evening.tokens).toBe(evening.cards[0]!.tokens);
    expect(evening.budget.daily).toBeGreaterThan(0);
  });

  it('« oui à tout, sauf… »: one confirmation for the lot; what is left out stays as it was', async () => {
    const { config, env, kb } = await demoBrain();
    const [a, b] = [await change(config, 'Rejouer chaque appel'), await change(config, 'Mesurer avant de corriger')];
    const [c1, c2] = [await card(config, 'Idempotence'), await card(config, 'Percentile')];
    const { asked, confirm } = yes();
    const done = await sayYes(config, env, { changes: [a], cards: [c1] }, confirm);
    expect(asked).toEqual([{ changes: 1, files: 1, titles: [expect.stringContaining('Rejouer chaque appel')] }]);
    expect(done).toMatchObject({ presence: 'confirmed', changes: [{ id: a, ok: true }], cards: [{ id: c1, ok: true }] });
    expect(await exists(resolve(kb, '3 Boîte à outils/Méthodes/Rejouer chaque appel.md'))).toBe(true);
    expect(await exists(resolve(kb, '3 Boîte à outils/Méthodes/Mesurer avant de corriger.md'))).toBe(false);
    expect((await loadProposal(config, b)).status).toBe('prepared');
    expect((await loadQueue(config)).map((s) => [s.id, s.status, s.decidedBy]).sort()).toEqual([[c1, 'accepted', 'person'], [c2, 'pending', undefined]].sort());
    // The evening now shows what is left.
    const left = await eveningView(config, env);
    expect([left.changes.map((x) => x.id), left.cards.map((x) => x.id)]).toEqual([[b], [c2]]);
  });

  it('nothing is approved without the person: a refusal changes nothing, and no dialog leaves the changes for the terminal', async () => {
    const { config, env, kb } = await demoBrain();
    const a = await change(config, 'Rejouer chaque appel');
    const c1 = await card(config, 'Idempotence');
    const refused = await sayYes(config, env, { changes: [a], cards: [c1] }, yes(['refused']).confirm);
    expect(refused).toEqual({ presence: 'refused', changes: [], cards: [] });
    expect((await loadQueue(config))[0]!.status).toBe('pending');
    // No way to ask (no screen): the cards are the person's click, the changes wait for `okb review`.
    const none = await sayYes(config, env, { changes: [a], cards: [c1] }, yes(['unavailable']).confirm);
    expect(none).toMatchObject({ presence: 'unavailable', changes: [{ id: a, ok: false, key: 'presenceUnavailable' }], cards: [{ id: c1, ok: true }] });
    expect(await exists(resolve(kb, '3 Boîte à outils/Méthodes/Rejouer chaque appel.md'))).toBe(false);
    // With only notes to accept, nothing is asked.
    const c2 = await card(config, 'Percentile');
    const { asked, confirm } = yes();
    expect((await sayYes(config, env, { changes: [], cards: [c2] }, confirm)).presence).toBe('not-needed');
    expect(asked).toEqual([]);
  });

  it('a change that no longer fits does not stop the others', async () => {
    const { config, env, kb } = await demoBrain();
    const [a, b] = [await change(config, 'Rejouer chaque appel'), await change(config, 'Mesurer avant de corriger')];
    // Someone wrote the first note in the meantime.
    await writeFile(resolve(kb, '3 Boîte à outils/Méthodes/Rejouer chaque appel.md'), note('Rejouer chaque appel').replace('Une étape', 'Une autre étape'));
    const done = await sayYes(config, env, { changes: [a, b], cards: [] }, yes().confirm);
    expect(done.changes.map((c) => [c.id, c.ok])).toEqual([[a, false], [b, true]]);
    expect(done.changes[0]!.error).toBeTruthy();
    expect(await exists(resolve(kb, '3 Boîte à outils/Méthodes/Mesurer avant de corriger.md'))).toBe(true);
  });

  it('a note beyond the day’s budget is not accepted, and the answer says so', async () => {
    const { config, env } = await demoBrain();
    const [c1, c2] = [await card(config, 'Idempotence'), await card(config, 'Percentile')];
    const cost = (await loadQueue(config))[0]!.cost.tokens;
    await writeRootConfig((root) => ({ ...root, budget: { daily: cost + 10 } }), env);
    const done = await sayYes(config, env, { changes: [], cards: [c1, c2] }, yes().confirm);
    expect(done.cards).toEqual([{ id: c1, ok: true }, { id: c2, ok: false, reason: 'budget' }]);
    expect((await eveningView(config, env)).budget).toEqual({ daily: cost + 10, spent: cost });
  });

  it('the app: the evening is read freely; saying yes needs the page’s session, and without a screen to confirm no change is applied', async () => {
    const { config, env, kb } = await demoBrain();
    const a = await change(config, 'Rejouer chaque appel');
    const c1 = await card(config, 'Idempotence');
    const { serve } = await import('../src/web/server.js');
    const started = await serve(config, { port: 0, env: { ...env, OKB_WEB_APPROVAL: 'off' } });
    const off = process.env.OKB_WEB_APPROVAL;
    process.env.OKB_WEB_APPROVAL = 'off';
    try {
      const view = (await (await fetch(`${started.url}/api/evening`)).json()) as { changes: { id: string }[]; cards: { id: string }[] };
      expect([view.changes.map((x) => x.id), view.cards.map((x) => x.id)]).toEqual([[a], [c1]]);
      const post = (headers: Record<string, string>) => fetch(`${started.url}/api/evening/yes`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ changes: [a], cards: [c1] }) });
      expect((await post({})).status).toBe(403);
      const token = ((await (await fetch(`${started.url}/api/session`)).json()) as { token: string }).token;
      const done = (await (await post({ 'X-OKB-Token': token })).json()) as { presence: string; changes: { ok: boolean }[]; cards: { ok: boolean }[] };
      expect(done).toMatchObject({ presence: 'unavailable', changes: [{ ok: false }], cards: [{ ok: true }] });
      expect(await exists(resolve(kb, '3 Boîte à outils/Méthodes/Rejouer chaque appel.md'))).toBe(false);
    } finally {
      if (off === undefined) delete process.env.OKB_WEB_APPROVAL; else process.env.OKB_WEB_APPROVAL = off;
      started.server.closeAllConnections(); started.server.close();
    }
  });
});

