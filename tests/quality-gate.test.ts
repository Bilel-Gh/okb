import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';
import type { Bundle } from '../src/kb/bundle.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeOwner } from '../src/kb/registry.js';
import { proposeFiles } from '../src/proposal/files.js';
import { computeProposalHash, type Change } from '../src/proposal/model.js';
import { saveProposal } from '../src/proposal/store.js';
import { checkProposal, describeProblems } from '../src/quality/gate.js';
import { keepProposal } from '../src/review/keep.js';
import { writeSetting } from '../src/settings/settings.js';
import { closeDbs } from '../src/state/db.js';
import type { BundlePath } from '../src/util/paths.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const GOOD = 'Le service des commandes convertit le montant en euros avant d’appliquer la remise du client. '
  + 'Sans cette conversion, une remise en pourcentage sur un montant en dollars donne un total faux de quelques centimes. '
  + 'La correction tient dans la fonction de calcul du total, et le test de non régression couvre les trois devises.';

const note = (title: string, body: string) => `---\ntype: Guide\ntitle: "${title}"\ndescription: Une note.\nstatus: draft\n---\n\n# ${title}\n\n${body}\n`;

function article(path: string, content: string, over: Partial<Change> = {}): Change {
  return { id: `c-${path}`, kind: 'create-document', path: path as BundlePath, label: 'note', rationale: 'scribe', contentKey: path, evidenceIds: ['ev-1'], dependsOn: [], category: 'article', createDocument: { content }, ...over };
}

function bundle(files: Record<string, string>): Bundle {
  const entries = Object.entries(files).map(([path, text]) => ({ path, reserved: false, title: /title: "([^"]+)"/.exec(text)?.[1] ?? path }));
  const docs = new Map(Object.entries(files).map(([path, text]) => [path, { body: text.split('---').slice(2).join('---') }]));
  return { root: '/kb', snapshot: { files: new Map() }, docs, entries, byPath: new Map(), unreadable: [] } as unknown as Bundle;
}

const KB = bundle({ 'cas/a.md': note('A', 'Rien à voir.'), 'cas/b.md': note('B', 'Autre chose.'), 'guides/c.md': note('C', 'Encore autre chose.') });

describe('the quality gate (D78)', () => {
  it('lets a clear, cited, well placed and new note through', () => {
    expect(checkProposal({ changes: [article('cas/remise-en-devise.md', note('Remise en devise', GOOD))] }, KB)).toEqual({ pass: true, problems: [], rewritable: false });
  });

  it('stops a dash used as punctuation, but not one inside a quote', () => {
    const dashed = checkProposal({ changes: [article('cas/x.md', note('X', `${GOOD} La remise — appliquée trop tôt — fausse le total.`))] }, KB);
    expect(dashed.problems.map((p) => p.code)).toEqual(['dash']);
    expect(dashed.rewritable).toBe(true);
    const quoted = checkProposal({ changes: [article('cas/x.md', note('X', `${GOOD}\n\n> la remise — appliquée trop tôt`))] }, KB);
    expect(quoted.pass).toBe(true);
  });

  it('stops a sentence too long to read, a note too short and a template left half filled', () => {
    const long = `${GOOD} ${Array.from({ length: 50 }, (_, i) => `mot${i}`).join(' ')}.`;
    expect(checkProposal({ changes: [article('cas/x.md', note('X', long))] }, KB).problems.map((p) => p.code)).toEqual(['long-sentence']);
    expect(checkProposal({ changes: [article('cas/x.md', note('X', 'Trop court.'))] }, KB).problems.map((p) => p.code)).toEqual(['too-short']);
    expect(checkProposal({ changes: [article('cas/x.md', note('X', `${GOOD} Voir {{lien}}.`))] }, KB).problems.map((p) => p.code)).toEqual(['placeholder']);
  });

  it('stops what cites nothing, what is left at the root and what says again an existing note: those are not rewritten', () => {
    const r = checkProposal({ changes: [
      article('cas/x.md', note('X', GOOD), { evidenceIds: [] }),
      article('y.md', note('Y', GOOD)),
      article('cas/autre.md', note('A', GOOD)),
    ] }, KB);
    expect(r.problems.map((p) => [p.code, p.path])).toEqual([['no-evidence', 'cas/x.md'], ['placement', 'y.md'], ['duplicate', 'cas/autre.md']]);
    expect(r.rewritable).toBe(false);
    const twin = bundle({ ...Object.fromEntries([...KB.entries].map((e) => [e.path, note(e.title, 'x')])), 'cas/deja.md': note('Déjà là', GOOD) });
    expect(checkProposal({ changes: [article('cas/nouveau.md', note('Nouveau titre', GOOD))] }, twin).problems).toEqual([{ code: 'duplicate', path: 'cas/nouveau.md', detail: 'cas/deja.md' }]);
  });

  it('asks a concept for its one-line summary', () => {
    const card = (body: string) => article('concepts/remise.md', `---\ntype: Concept\ntitle: "Remise"\n---\n\n# Remise\n\n${body}\n`, { category: 'concept-card' });
    expect(checkProposal({ changes: [card('## En une phrase\n\nUne remise est une baisse du prix accordée à un client.\n')] }, KB).pass).toBe(true);
    expect(checkProposal({ changes: [card('Du texte sans résumé.')] }, KB).problems.map((p) => p.code)).toEqual(['concept-summary']);
  });

  it('says each problem in one line a writer can act on', () => {
    expect(describeProblems([{ code: 'dash', path: 'cas/x.md', detail: 'a — b' }])[0]).toMatch(/^quality gate \(D78\): dash in cas\/x\.md: .*comma.*\(a — b\)$/);
  });

  it('keeps a note that fails the gate out of the KB, even when the agent files at once', async () => {
    const { s, config } = await workKb();
    await writeSetting(config.profile.id, 'changes.agentWrites', 'review-later', s.env);
    const c = (await loadConfig({ env: s.env, profileId: config.profile.id })).config;
    await writeOwner(c.kb.root, c.profile.id);
    for (const p of ['cas/a.md', 'cas/b.md', 'guides/c.md']) { await mkdir(dirname(resolve(c.kb.root, p)), { recursive: true }); await writeFile(resolve(c.kb.root, p), note(p, 'Texte.')); }
    const prepare = async (path: string, body: string) => {
      const base = proposeFiles(c, await loadBundleFor(c), new Map([[path, note('Remise', body).replace('status: draft\n', 'status: draft\ngenerated:\n  by: agent:claude\n  at: 2026-10-22T00:00:00Z\n')]]), 'agent');
      const draft = { ...base, changes: base.changes.map((ch) => ({ ...ch, category: 'article' as const, evidenceIds: ['ev-1'] })) };
      const p = { ...draft, contentHash: computeProposalHash(draft) };
      await saveProposal(c, p);
      return p.id;
    };
    const bad = await keepProposal(c, await prepare('cas/remise.md', `${GOOD} Le total — faux — est corrigé.`), s.env);
    expect(bad).toMatchObject({ applied: [], problems: [expect.objectContaining({ code: 'dash' })] });
    expect(bad.waiting).toBeTruthy();
    const good = await keepProposal(c, await prepare('cas/remise.md', GOOD), s.env);
    expect(good).toMatchObject({ applied: ['cas/remise.md'], problems: [] });
  });
});
