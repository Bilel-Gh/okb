import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { available, invoke, OPERATIONS, jsonSchemaOf } from '../src/engine/registry.js';
import { MODULES, setModule } from '../src/modules/catalog.js';
import { OkbError } from '../src/util/errors.js';
import { demoBrain } from './helpers/brain.js';

const note = async (kb: string, path: string, front: string[], body: string) => {
  await mkdir(dirname(resolve(kb, path)), { recursive: true });
  await writeFile(resolve(kb, path), `---\n${front.join('\n')}\n---\n\n${body}\n`);
};
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);

describe('one engine: the contract of an operation (F2.0-17)', () => {
  it('every operation has a unique id, a known module, an effect and an input that MCP can describe', () => {
    const ids = OPERATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const op of OPERATIONS) {
      expect(MODULES.map((m) => m.id), op.id).toContain(op.module);
      expect(['read', 'state', 'propose'], op.id).toContain(op.effect);
      const schema = jsonSchemaOf(op.input);
      expect(schema.type, op.id).toBe('object');
    }
    expect(ids).toEqual(expect.arrayContaining(['notes.find', 'notes.read', 'kb.status', 'suggestions.list', 'suggestions.add', 'repos.list']));
  });

  it('nothing an agent can call approves, applies or decides for the person', () => {
    for (const op of OPERATIONS) expect(op.id, op.id).not.toMatch(/approve|apply|decide|accept|undo/);
  });

  it('an invalid input is refused before anything runs, naming the field', async () => {
    const { config, env } = await demoBrain();
    const e = await failure(invoke('notes.find', { query: '' }, { config, env, actor: 'person' }));
    expect(e).toBeInstanceOf(OkbError);
    expect(e.code).toBe('E_INVALID');
    expect(e.key).toBe('invalidInput');
    expect(e.params).toMatchObject({ field: 'query' });
    const unknown = await failure(invoke('notes.nope', {}, { config, env, actor: 'person' }));
    expect(unknown.code).toBe('E_NOT_FOUND');
  });
});

describe('one engine: the modules (F2.0-25)', () => {
  it('a module turned off hides its operations and refuses them; the core stays', async () => {
    const { config, env } = await demoBrain();
    expect((await available(env)).map((o) => o.id)).toContain('repos.list');
    await setModule('dev', false, env);
    const ids = (await available(env)).map((o) => o.id);
    expect(ids).not.toContain('repos.list');
    expect(ids).toContain('notes.read');
    const e = await failure(invoke('repos.list', {}, { config, env, actor: 'person' }));
    expect(e.code).toBe('E_CONFIG');
    expect(e.key).toBe('moduleOff');
  });
});

describe('one engine: the operations', () => {
  it('notes.find: the same rules for everyone, and a 🔒 note is shown to the person only', async () => {
    const { config, env, kb } = await demoBrain();
    await note(kb, '2 Produits/Coffre.md', ['type: Guide', 'title: Coffre zorglub', 'description: Le coffre.', 'x_okb:', '  confidentiality: secret'], '# Coffre zorglub\n\nRien.');
    const person = await invoke('notes.find', { query: 'zorglub' }, { config, env, actor: 'person' });
    expect(person.hits.map((h) => h.path)).toContain('2 Produits/Coffre.md');
    expect(person.hits[0]).toHaveProperty('stars');
    const agent = await invoke('notes.find', { query: 'zorglub' }, { config, env, actor: 'agent' });
    expect(agent.hits.map((h) => h.path)).not.toContain('2 Produits/Coffre.md');
    expect(agent.hidden).toBe(1);
  });

  it('notes.read: a note by its path, never a 🔒 one for an agent, never outside the KB', async () => {
    const { config, env, kb } = await demoBrain();
    await note(kb, '2 Produits/Coffre.md', ['type: Guide', 'title: Coffre', 'description: Le coffre.', 'x_okb:', '  confidentiality: secret'], '# Coffre\n\nRien.');
    await note(kb, '2 Produits/Ouvert.md', ['type: Guide', 'title: Ouvert', 'description: Ouvert.'], '# Ouvert\n\nTout.');
    const open = await invoke('notes.read', { path: '2 Produits/Ouvert.md' }, { config, env, actor: 'agent' });
    expect(open).toMatchObject({ path: '2 Produits/Ouvert.md', title: 'Ouvert', secret: false });
    expect(open.body).toContain('Tout.');
    expect((await invoke('notes.read', { path: '2 Produits/Coffre.md' }, { config, env, actor: 'person' })).secret).toBe(true);
    expect((await failure(invoke('notes.read', { path: '2 Produits/Coffre.md' }, { config, env, actor: 'agent' }))).code).toBe('E_SECRET');
    expect((await failure(invoke('notes.read', { path: '../outside.md' }, { config, env, actor: 'person' }))).code).toBe('E_NOT_FOUND');
  });

  it('suggestions.add then suggestions.list: a card waits for the person’s yes', async () => {
    const { config, env } = await demoBrain();
    const added = await invoke('suggestions.add', { type: 'concept', title: 'Idempotence', why: 'Le mot revient dans trois tickets.' }, { config, env, actor: 'agent' });
    expect(added.created).toBe(true);
    expect(added.suggestion.status).toBe('pending');
    const listed = await invoke('suggestions.list', {}, { config, env, actor: 'agent' });
    expect(listed.suggestions.map((s) => s.title)).toContain('Idempotence');
  });
});
