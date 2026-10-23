import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { addEntry } from '../src/projects/journal.js';
import { proposeFiles } from '../src/proposal/files.js';
import { loadProposal, saveProposal } from '../src/proposal/store.js';
import { closeDbs } from '../src/state/db.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());

describe('« Ce qui s’est passé »: the few facts that matter since yesterday (F2.4-25)', () => {
  it('shows decisions, done and filed notes with their context, newest first, five at most, without commits', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const p = await invoke('projects.create', { title: 'Cache des sessions' }, ctx);
    const t0 = Date.now();
    addEntry(config, { text: 'fix: typo', kind: 'commit', project: p.id }, new Date(t0 - 6000));
    addEntry(config, { text: 'On garde PostgreSQL', kind: 'decision', project: p.id }, new Date(t0 - 5000));
    for (let i = 0; i < 4; i++) addEntry(config, { text: `Étape ${i}`, kind: 'done', project: p.id }, new Date(t0 - 4000 + i * 100));
    await writeOwner(config.kb.root, config.profile.id);
    const proposal = proposeFiles(config, await loadBundleFor(config), new Map([['Cas/devise.md', '---\ntype: Guide\ntitle: "Conversion de devise"\ndescription: Un cas.\nstatus: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n---\n\n# Conversion de devise\n\nTexte.\n']]), 'test');
    await saveProposal(config, proposal);
    const saved = await loadProposal(config, proposal.id);
    await grantApproval(config, saved, saved.changes.map((c) => c.id), config.profile.humanActor);
    await applyProposal(config, saved, { env });

    const today = await invoke('today.view', {}, ctx);
    expect(today.happened).toHaveLength(5);
    expect(today.happened[0]).toMatchObject({ kind: 'filed', text: 'Conversion de devise', path: 'Cas/devise.md' });
    expect(today.happened.map((h) => h.text)).not.toContain('fix: typo');
    expect(today.happened.slice(1).map((h) => h.text)).toEqual(['Étape 3', 'Étape 2', 'Étape 1', 'Étape 0']);
    expect(today.happened[1]).toMatchObject({ kind: 'done', project: { id: p.id, title: 'Cache des sessions' } });
  });

  it('is empty on a calm day', async () => {
    const { config, env } = await demoBrain();
    const today = await invoke('today.view', {}, { config, env, actor: 'person' as const });
    expect(today.happened).toEqual([]);
  });
});

describe('review fixes of lot C (D75)', () => {
  it('I5: a busy day of commits does not push the decisions out of the feed', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const p = await invoke('projects.create', { title: 'Gros chantier' }, ctx);
    const t0 = Date.now();
    addEntry(config, { text: 'On garde Kafka', kind: 'decision', project: p.id }, new Date(t0 - 100_000));
    for (let i = 0; i < 80; i++) addEntry(config, { text: `commit ${i}`, kind: 'commit', project: p.id }, new Date(t0 - 50_000 + i));
    const today = await invoke('today.view', {}, ctx);
    expect(today.happened.map((h) => h.text)).toContain('On garde Kafka');
  });

  it('I6: a ticket todo the agent ticks shows in the feed with its ticket, credited to the agent', async () => {
    const { config, env } = await demoBrain();
    const person = { config, env, actor: 'person' as const }; const agent = { config, env, actor: 'agent' as const };
    const { openDb } = await import('../src/state/db.js');
    const now = new Date().toISOString();
    openDb(config).run("INSERT INTO projects (id, module, kind, title, status, ref, created_at, updated_at) VALUES ('P-tk0001', 'dev', 'ticket', 'Le panier', 'active', 'DEMO-30', ?, ?)", now, now);
    const a = await invoke('actions.add', { text: 'Tester le yen', workRef: 'DEMO-30' }, person);
    await invoke('actions.update', { id: a.id, status: 'done' }, agent);
    const entries = await invoke('journal.list', {}, person);
    expect(entries.entries.find((e) => e.text === 'Tester le yen')).toMatchObject({ kind: 'done', source: 'ai', projectId: 'P-tk0001' });
  });
});
