import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposeCategory } from '../src/categories/assign.js';
import { combineProposals } from '../src/proposal/combine.js';
import { computeProposalHash } from '../src/proposal/model.js';
import { proposeConfidentiality } from '../src/security/confidential.js';
import { demoBrain } from './helpers/brain.js';

const FOLDER = '2 Produits/Atlas/Code/atlas-api';

describe('one proposal for several notes', () => {
  it('puts the changes of several proposals into one, each change named apart, its hash valid', async () => {
    const { config, kb } = await demoBrain();
    const { loadBundleFor } = await import('../src/kb/bundle.js');
    const paths = (await loadBundleFor(config)).entries.filter((e) => e.path.startsWith(`${FOLDER}/`) && !e.reserved).slice(0, 2).map((e) => e.path);
    const one = combineProposals(config, [await proposeCategory(config, paths[0]!, 'decision'), await proposeConfidentiality(config, paths[1]!, 'secret')]);
    expect(one.changes.map((c) => c.path)).toEqual(paths);
    expect(new Set(one.changes.map((c) => c.id)).size).toBe(2);
    expect(Object.keys(one.baseline).sort()).toEqual([...paths].sort());
    const { status: _s, contentHash, ...rest } = one;
    expect(contentHash).toBe(computeProposalHash(rest));
    void kb;
  }, 60_000);

  it('refuses two changes to the same note', async () => {
    const { config } = await demoBrain();
    const { loadBundleFor } = await import('../src/kb/bundle.js');
    const path = (await loadBundleFor(config)).entries.find((e) => e.path.startsWith(`${FOLDER}/`) && !e.reserved)!.path;
    const proposals = [await proposeCategory(config, path, 'decision'), await proposeConfidentiality(config, path, 'secret')];
    expect(() => combineProposals(config, [proposals[0]!, proposals[1]!])).toThrow(/changed by both/);
  }, 60_000);
});

describe('the explorer in the web app', () => {
  it('lists each note with its date, its stars and whether it is 🔒; changes the type or the confidentiality of several notes in one proposal', async () => {
    const { serve } = await import('../src/web/serve.js');
    const { config, env, kb } = await demoBrain();
    await writeFile(resolve(kb, FOLDER, 'Coffre.md'), '---\ntitle: Coffre\ndescription: x\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2026-09-01T10:00:00Z\nx_okb:\n  confidentiality: secret\n---\n\n# Coffre\n\nRien.\n');
    const { server, url } = await serve(config, { port: 0, env });
    try {
      const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
      const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: JSON.stringify(body) });
      const { notes } = (await (await fetch(`${url}/api/notes`)).json()) as { notes: { path: string; at: string | null; stars: number | null; secret: boolean; category: string }[] };
      const coffre = notes.find((n) => n.path.endsWith('Coffre.md'))!;
      expect(coffre).toMatchObject({ secret: true, at: '2026-09-01T10:00:00Z' });
      expect(notes.filter((n) => typeof n.stars === 'number').length).toBeGreaterThan(10);
      const two = notes.filter((n) => n.path.startsWith(`${FOLDER}/`) && n.category !== 'decision' && !n.secret).slice(0, 2).map((n) => n.path);
      const typed = (await (await post('/api/categories/set', { paths: two, category: 'decision' })).json()) as { proposalId: string; notes: number };
      expect(typed).toMatchObject({ ok: true, notes: 2 });
      const locked = (await (await post('/api/notes/confidentiality', { paths: [...two, coffre.path], level: 'secret' })).json()) as { proposalId: string; notes: number; skipped: string[] };
      // Already 🔒: left out, the others in one proposal.
      expect(locked).toMatchObject({ ok: true, notes: 2, skipped: [coffre.path] });
      const none = await (await post('/api/notes/confidentiality', { paths: [coffre.path], level: 'secret' })).json() as { error?: unknown };
      expect(none.error).toBeTruthy();
    } finally {
      server.closeAllConnections(); server.close();
    }
  }, 90_000);
});
