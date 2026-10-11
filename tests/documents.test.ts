import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkIntegrity } from '../src/brain/integrity.js';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { closeDbs } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';
import { sha256 } from '../src/util/hash.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);
const b64 = (text: string | Uint8Array) => Buffer.from(text).toString('base64');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('documents: a file kept as it is (F2.0-10)', () => {
  it('keeps the file untouched in the space, reads its text for search, and ties it to a project', async () => {
    const { config, env, kb } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const project = await invoke('projects.create', { title: 'Sortie de juin' }, ctx);
    const text = '# Devis du transporteur\n\nLe car coûte 480 euros pour la journée. Réservation trois semaines avant.\n';
    const kept = await invoke('documents.add', { name: 'Devis transporteur.md', data: b64(text), project: project.id }, ctx);
    expect(kept.created).toBe(true);
    expect(kept.document).toMatchObject({ title: 'Devis transporteur', textRead: true, projectId: project.id, size: Buffer.byteLength(text) });
    expect(kept.document.id).toMatch(/^D-[a-z0-9]{6}$/);
    expect(kept.document.path).toMatch(/^_Documents\/\d{4}\/Devis transporteur\.md$/);
    expect(sha256(await readFile(resolve(kb, kept.document.path)))).toBe(sha256(text));

    const found = await invoke('documents.list', { query: 'reservation' }, ctx);
    expect(found.documents.map((d) => d.id)).toEqual([kept.document.id]);
    expect(found.documents[0]!.snippet).toContain('Réservation');
    expect((await invoke('documents.list', { project: project.id }, ctx)).documents).toHaveLength(1);
    expect((await invoke('documents.list', { query: 'quokka' }, ctx)).documents).toEqual([]);
    expect((await invoke('journal.list', { project: project.id }, ctx)).entries.map((e) => e.text).join(' ')).toContain('Devis transporteur');
  });

  it('a file whose text cannot be read is kept all the same', async () => {
    const { config, env, kb } = await demoBrain();
    const kept = await invoke('documents.add', { name: 'photo du tableau.png', data: b64(PNG) }, { config, env, actor: 'person' });
    expect(kept.document).toMatchObject({ title: 'photo du tableau', textRead: false, size: PNG.length });
    expect(new Uint8Array(await readFile(resolve(kb, kept.document.path)))).toEqual(PNG);
    expect((await invoke('documents.list', { query: 'tableau' }, { config, env, actor: 'person' })).documents).toHaveLength(1);
  });

  it('the same file twice is kept once; another file of the same name never overwrites the first', async () => {
    const { config, env, kb } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const first = await invoke('documents.add', { name: 'notes.txt', data: b64('première version') }, ctx);
    const again = await invoke('documents.add', { name: 'notes.txt', data: b64('première version') }, ctx);
    expect(again).toMatchObject({ created: false, document: { id: first.document.id } });
    const other = await invoke('documents.add', { name: 'notes.txt', data: b64('autre contenu') }, ctx);
    expect(other.created).toBe(true);
    expect(other.document.path).not.toBe(first.document.path);
    expect(await readFile(resolve(kb, first.document.path), 'utf8')).toBe('première version');
    expect((await readdir(resolve(kb, '_Documents', String(new Date().getFullYear())))).sort()).toEqual(['notes-2.txt', 'notes.txt']);
  });

  it('a name cannot leave the documents folder, and an oversized file is refused', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    const kept = await invoke('documents.add', { name: '../../evil/../secret.txt', data: b64('x') }, ctx);
    expect(kept.document.path).toMatch(/^_Documents\/\d{4}\/secret\.txt$/);
    const big = Buffer.alloc(config.sources.limits.maxBytes + 10, 97).toString('base64');
    expect((await failure(invoke('documents.add', { name: 'gros.txt', data: big }, ctx))).key).toBe('documentTooBig');
  });

  it('an assistant can search documents, not add one, and never sees a 🔒 one', async () => {
    const { config, env } = await demoBrain();
    const person = { config, env, actor: 'person' as const };
    const agent = { config, env, actor: 'agent' as const };
    const kept = await invoke('documents.add', { name: 'contrat.txt', data: b64('Le tarif du contrat est confidentiel.') }, person);
    expect((await failure(invoke('documents.add', { name: 'x.txt', data: b64('x') }, agent))).key).toBe('documentPersonOnly');
    expect((await invoke('documents.list', { query: 'tarif' }, agent)).documents).toHaveLength(1);
    await invoke('documents.update', { id: kept.document.id, secret: true }, person);
    expect((await invoke('documents.list', { query: 'tarif' }, agent)).documents).toEqual([]);
    expect((await invoke('documents.list', { query: 'tarif' }, person)).documents).toHaveLength(1);
    expect((await failure(invoke('documents.update', { id: kept.document.id, secret: false }, agent))).key).toBe('documentPersonOnly');
  });

  it('a search finds documents beside the notes, and a kept file is not an orphan to tidy', async () => {
    const { config, env } = await demoBrain();
    const ctx = { config, env, actor: 'person' as const };
    await invoke('documents.add', { name: 'zorglub.txt', data: b64('Le mot zorglub ne figure dans aucune note.') }, ctx);
    await invoke('documents.add', { name: 'schéma.png', data: b64(PNG) }, ctx);
    const found = await invoke('notes.find', { query: 'zorglub' }, ctx);
    expect(found.documents.map((d) => d.title)).toEqual(['zorglub']);
    const findings = await checkIntegrity(config, await loadBundleFor(config), { env, disk: false });
    expect(findings.filter((f) => f.code === 'orphan-file')).toEqual([]);
  });

  it('keeping a file from a path leaves the original where it is', async () => {
    const { config, env, dir } = await demoBrain();
    const source = resolve(dir, 'compte rendu.txt');
    await writeFile(source, 'Décision : on garde PostgreSQL.');
    const kept = await invoke('documents.add', { file: source }, { config, env, actor: 'person' });
    expect(kept.document.title).toBe('compte rendu');
    expect(await readFile(source, 'utf8')).toBe('Décision : on garde PostgreSQL.');
  });
});
