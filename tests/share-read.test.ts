import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { loadConfig } from '../src/config/load.js';
import { invoke } from '../src/engine/registry.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { listProposals, loadProposal } from '../src/proposal/store.js';
import { runSetup } from '../src/setup/setup.js';
import { listDrawers, markShared, sendDrawer, setupSharing } from '../src/share/drawers.js';
import { brainsMap, commonGlossary, findShared, keepShared, readShared } from '../src/share/read.js';
import { receiveShared, sendShared } from '../src/share/sync.js';
import { closeDbs } from '../src/state/db.js';
import { sha256 } from '../src/util/hash.js';
import { writeSetting } from '../src/settings/settings.js';
import { OkbError } from '../src/util/errors.js';
import { nextRoutes } from '../src/web/api-next.js';
import { engineRoutes } from '../src/web/api-engine.js';

const made: string[] = [];
afterEach(async () => { closeDbs(); for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);
const note = (title: string, body: string, kind = 'method', type = 'Guide') => `---\ntype: ${type}\ntitle: ${title}\ndescription: ${title}, en une phrase.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2027-01-05T10:00:00Z\nx_okb:\n  v: 1\n  id: n-${title.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8)}\n  brain:\n    type: ${kind}\n---\n\n# ${title}\n\n${body}\n`;

/** Alice and Bob, each with their OKB and their brain; `shared` is the folder each of them reaches (one folder, or one clone each). */
async function colleagues(options: { git?: boolean } = {}) {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-shared-')));
  made.push(dir);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (options.git) execFileSync('git', ['init', '-q', '--bare', '-b', 'main', resolve(dir, 'remote.git')]);
  const person = async (name: string) => {
    const kb = resolve(dir, name, 'kb');
    await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 1, repos: 1, tickets: 1, meetings: 1, concepts: 3 }));
    const env = { ...process.env, OKB_HOME: resolve(dir, name, 'home'), OKB_PROFILE: 'travail', HOME: resolve(dir, name) };
    await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: `human:${name}`, answerLanguage: 'fr', displayName: `Travail de ${name}`, brain: { preset: 'work', names: 'fr' } }, { env });
    const shared = options.git ? resolve(dir, name, 'commun') : resolve(dir, 'commun');
    if (options.git) {
      execFileSync('git', ['clone', '-q', resolve(dir, 'remote.git'), shared]);
      git(shared, 'config', 'user.email', `${name}@example.test`); git(shared, 'config', 'user.name', name); git(shared, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    } else await mkdir(shared, { recursive: true });
    const config = async () => (await loadConfig({ env, profileId: 'travail' })).config;
    const put = async (path: string, text: string) => { await mkdir(dirname(resolve(kb, path)), { recursive: true }); await writeFile(resolve(kb, path), text); };
    await setupSharing(await config(), env, { folder: shared, drawer: name, allowed: true });
    return { kb, env, shared, config, put };
  };
  const alice = await person('alice');
  const bob = await person('bob');
  await alice.put('3 Boîte à outils/Méthodes/Isoler chaque appel.md', note('Isoler chaque appel', 'Rejouer chaque appel seul et noter son temps : la lenteur se voit tout de suite.'));
  await alice.put('3 Boîte à outils/Concepts/Quorum.md', note('Quorum', 'Le nombre de voix qu’il faut pour décider.', 'concept', 'Concept'));
  await bob.put('3 Boîte à outils/Méthodes/Mesurer avant de corriger.md', note('Mesurer avant de corriger', 'Un chiffre avant, un chiffre après.'));
  await bob.put('3 Boîte à outils/Concepts/Quorum.md', note('Quorum', 'La majorité nécessaire pour valider une écriture.', 'concept', 'Concept'));
  await markShared(await alice.config(), ['3 Boîte à outils']);
  await markShared(await bob.config(), ['3 Boîte à outils']);
  return { dir, alice, bob, git };
}

describe('the notes of the others (F2.1-04, F2.1-05)', () => {
  it('a search finds the colleague’s notes too, each marked with who shared it; never one’s own drawer', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    await sendDrawer(await bob.config(), bob.env);
    const hits = await findShared(await bob.config(), bob.env, 'isoler appel lenteur');
    expect(hits.map((h) => [h.drawer, h.by, h.title])).toEqual([['alice', 'Travail de alice', 'Isoler chaque appel']]);
    expect(hits[0]!.snippet).toContain('lenteur');
    // The same through the engine, beside the person's own notes.
    const found = await invoke('notes.find', { query: 'isoler appel lenteur' }, { config: await bob.config(), env: bob.env, actor: 'agent' });
    expect(found.shared.map((h) => [h.by, h.title])).toEqual([['Travail de alice', 'Isoler chaque appel']]);
    expect((await findShared(await bob.config(), bob.env, 'mesurer avant corriger')).map((h) => h.title)).toEqual([]);
  });

  it('a shared note is read as it is; nothing outside a drawer can be asked for', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const read = await readShared(await bob.config(), bob.env, 'alice', '3 Boîte à outils/Méthodes/Isoler chaque appel.md');
    expect(read).toMatchObject({ title: 'Isoler chaque appel', by: 'Travail de alice', drawer: 'alice' });
    expect(read.markdown).toContain('Rejouer chaque appel seul');
    for (const path of ['../alice/drawer.json', '../../alice/kb/Accueil.md', '/etc/hosts']) expect((await failure(readShared(await bob.config(), bob.env, 'alice', path))).code, path).toBe('E_NOT_FOUND');
    expect((await failure(readShared(await bob.config(), bob.env, '../alice/kb', 'Accueil.md'))).code).toBe('E_NOT_FOUND');
  });

  it('only the manifest’s unchanged, shareable notes are searched or read', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const extra = '3 Boîte à outils/Méthodes/Not shared.md';
    await writeFile(resolve(alice.shared, 'alice', extra), note('Not shared', 'UNLISTEDPRIVATECONTENT'));
    const config = await bob.config();
    expect(await findShared(config, bob.env, 'UNLISTEDPRIVATECONTENT')).toEqual([]);
    expect((await failure(readShared(config, bob.env, 'alice', extra))).code).toBe('E_NOT_FOUND');
    const path = '3 Boîte à outils/Méthodes/Isoler chaque appel.md';
    await writeFile(resolve(alice.shared, 'alice', path), note('Isoler chaque appel', 'ALTEREDCONTENT'));
    expect(await findShared(config, bob.env, 'ALTEREDCONTENT')).toEqual([]);
    expect((await failure(readShared(config, bob.env, 'alice', path))).code).toBe('E_NOT_FOUND');
    expect((await failure(keepShared(config, bob.env, { drawer: 'alice', path }))).code).toBe('E_NOT_FOUND');
  });

  it('bad manifests are ignored by readers and never treated as an empty owned drawer by writers', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const file = resolve(alice.shared, 'alice', 'drawer.json');
    await writeFile(file, JSON.stringify({ kind: 'okb-drawer', v: 1, notes: [{ path: '../../outside.md' }] }));
    expect(await listDrawers(await bob.config(), bob.env)).toEqual([]);
    expect((await failure(sendDrawer(await alice.config(), alice.env))).code).toBe('E_INVALID');
  });

  it('even a matching manifest cannot expose a 🔒 note, a private note or a secret from a colleague', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const manifestPath = resolve(alice.shared, 'alice', 'drawer.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const path = '3 Boîte à outils/Méthodes/Isoler chaque appel.md';
    const text = note('Isoler chaque appel', 'NOTFORSHARING').replace('  v: 1', '  v: 1\n  confidentiality: secret');
    await writeFile(resolve(alice.shared, 'alice', path), text);
    manifest.notes.find((n: {path: string}) => n.path === path).sha256 = sha256(text);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const config = await bob.config();
    expect(await findShared(config, bob.env, 'NOTFORSHARING')).toEqual([]);
    expect((await failure(readShared(config, bob.env, 'alice', path))).code).toBe('E_NOT_FOUND');
    expect(JSON.stringify(await commonGlossary(config, bob.env, await loadBundleFor(config)))).not.toContain('NOTFORSHARING');
  });

  it('the assistant finds shared excerpts with unambiguous attribution through the web route too', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const config = await bob.config();
    const routes = nextRoutes(async () => config);
    const result = await routes['GET /api/ask']!({ env: bob.env }, new URLSearchParams({ q: 'isoler appel lenteur' }), {}) as { passages: {n: number; text: string; shared?: {drawer: string; by: string}}[] };
    const shared = result.passages.filter((p) => p.shared);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared[0]!).toMatchObject({ shared: { drawer: 'alice', by: 'Travail de alice' } });
    expect(shared[0]!.text).toContain('lenteur');
    expect(new Set(result.passages.map((p) => p.n)).size).toBe(result.passages.length);
  });

  it('the web preview and send share the same freshness check; an agent cannot change or preview outgoing shares', async () => {
    const { alice } = await colleagues();
    const config = await alice.config();
    const ctx = { config, env: alice.env, actor: 'agent' as const };
    for (const [op, input] of [['share.status', {}], ['share.preview', {}], ['share.mark', { paths: ['3 Boîte à outils'] }], ['share.unmark', { paths: ['3 Boîte à outils'] }], ['share.send', {}], ['share.receive', {}]] as const) {
      expect((await failure(invoke(op, input, ctx))).code, op).toBe('E_NOT_APPROVED');
    }
    const routes = engineRoutes(async () => config);
    const preview = await routes['GET /api/share/preview']!({ env: alice.env }, new URLSearchParams(), {}) as { previewHash: string };
    await alice.put('3 Boîte à outils/Méthodes/New.md', note('New', 'A note added since the preview.'));
    expect((await failure(routes['POST /api/share/send']!({ env: alice.env }, new URLSearchParams(), { previewHash: preview.previewHash }))).code).toBe('E_STALE');
  });

  it('an existing sharing setup cannot import work straight into a brain that became baggage', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    await writeSetting('travail', 'kb.space', 'baggage', bob.env);
    const config = await bob.config();
    expect((await failure(keepShared(config, bob.env, { drawer: 'alice', path: '3 Boîte à outils/Méthodes/Isoler chaque appel.md' }))).key).toBe('spaceBaggageStays');
    expect((await listProposals(config))).toEqual([]);
  });

  it('unavailable sharing does not hide or block personal results and is reported explicitly', async () => {
    const { bob } = await colleagues();
    const config = await bob.config();
    await rm(bob.shared, { recursive: true });
    const result = await invoke('notes.find', { query: 'mesurer avant corriger' }, { config, env: bob.env, actor: 'person' });
    expect(result.hits.map((h) => h.title)).toContain('Mesurer avant de corriger');
    expect(result.shared).toEqual([]);
    expect(result.sharedIssue).toMatchObject({ code: 'E_NOT_FOUND' });
    const answer = await nextRoutes(async () => config)['GET /api/ask']!({ env: bob.env }, new URLSearchParams({ q: 'mesurer avant corriger' }), {}) as { passages: unknown[]; sharedIssue?: {code: string} };
    expect(answer.passages.length).toBeGreaterThan(0);
    expect(answer.sharedIssue).toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('« Garder dans mon cerveau » prepares a proposal that says where the note came from', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const config = await bob.config();
    const kept = await keepShared(config, bob.env, { drawer: 'alice', path: '3 Boîte à outils/Méthodes/Isoler chaque appel.md' });
    expect(kept.target).toBe('3 Boîte à outils/Méthodes/Isoler chaque appel.md');
    expect((await listProposals(config)).map((p) => p.id)).toEqual([kept.proposal]);
    const text = JSON.stringify(await loadProposal(config, kept.proposal));
    expect(text).toContain('Rejouer chaque appel seul');
    expect(text).toMatch(/shared:\\n\s+by: Travail de alice/);
    // The note's identity in Alice's brain does not come along: Bob's brain gives its own.
    expect(text).not.toContain('n-isolerch');
  });

  it('a note the person already has is not overwritten: the same is said, a different one too', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const refused = await failure(keepShared(await bob.config(), bob.env, { drawer: 'alice', path: '3 Boîte à outils/Concepts/Quorum.md' }));
    expect(refused.key).toBe('shareDiffers');
    await bob.put('3 Boîte à outils/Méthodes/Isoler chaque appel.md', await readFile(resolve(alice.kb, '3 Boîte à outils/Méthodes/Isoler chaque appel.md'), 'utf8'));
    expect((await failure(keepShared(await bob.config(), bob.env, { drawer: 'alice', path: '3 Boîte à outils/Méthodes/Isoler chaque appel.md' }))).key).toBe('shareAlreadyHave');
  });
});

describe('two brains side by side (F2.1-06, F2.1-07)', () => {
  it('the map says what each knows, what both know, and what both use without a card', async () => {
    const { alice, bob } = await colleagues();
    await alice.put('3 Boîte à outils/Méthodes/Note ZQX a.md', note('Note ZQX a', 'Le module ZQX recalcule les totaux.'));
    await alice.put('3 Boîte à outils/Méthodes/Note ZQX b.md', note('Note ZQX b', 'ZQX tourne la nuit.'));
    await bob.put('3 Boîte à outils/Méthodes/Autre ZQX a.md', note('Autre ZQX a', 'On relance ZQX à la main.'));
    await bob.put('3 Boîte à outils/Méthodes/Autre ZQX b.md', note('Autre ZQX b', 'ZQX écrit dans la table des totaux.'));
    await sendDrawer(await alice.config(), alice.env);
    const config = await bob.config();
    const [map] = await brainsMap(config, bob.env, await loadBundleFor(config));
    expect(map).toMatchObject({ drawer: 'alice', by: 'Travail de alice' });
    expect(map!.both.map((n) => n.title)).toContain('Quorum');
    expect(map!.theirs.map((n) => n.title)).toContain('Isoler chaque appel');
    expect(map!.mine.map((n) => n.title)).toContain('Mesurer avant de corriger');
    expect(map!.mine.map((n) => n.title)).not.toContain('Isoler chaque appel');
    expect(map!.holes.map((h) => h.term)).toContain('ZQX');
  });

  it('a common glossary: each term with who defines it', async () => {
    const { alice, bob } = await colleagues();
    await sendDrawer(await alice.config(), alice.env);
    const config = await bob.config();
    const glossary = await commonGlossary(config, bob.env, await loadBundleFor(config));
    const term = glossary.find((g) => g.term === 'Quorum')!;
    expect(term.definitions.map((d) => [d.by, d.definition])).toEqual([[null, 'Quorum, en une phrase.'], ['Travail de alice', 'Quorum, en une phrase.']]);
    expect(glossary.every((g) => g.definitions.length >= 1)).toBe(true);
  });
});

describe('sending and receiving through a common repository (F2.1-03)', () => {
  it('each sends their own drawer and receives the other’s; OKB commits the drawer only, in the shared copy only', async () => {
    const { alice, bob, git } = await colleagues({ git: true });
    const sentA = await sendShared(await alice.config(), alice.env, { push: true });
    expect(sentA).toMatchObject({ committed: true, pushed: true });
    expect((await listDrawers(await bob.config(), bob.env)).map((d) => d.drawer)).toEqual([]);
    expect((await receiveShared(await bob.config(), bob.env)).changed).toBe(true);
    expect((await listDrawers(await bob.config(), bob.env)).map((d) => d.drawer)).toEqual(['alice']);
    // Alice sends again while Bob prepares his own drawer: no conflict, each wrote in their drawer.
    await alice.put('3 Boîte à outils/Méthodes/Une de plus.md', note('Une de plus', 'Encore une méthode.'));
    await sendShared(await alice.config(), alice.env, { push: true });
    const sentB = await sendShared(await bob.config(), bob.env, { push: true });
    expect(sentB).toMatchObject({ committed: true, pushed: true });
    await receiveShared(await alice.config(), alice.env);
    expect((await listDrawers(await alice.config(), alice.env)).map((d) => [d.drawer, d.mine])).toEqual([['alice', true], ['bob', false]]);
    // The commits touch one drawer each, and the brains themselves are not Git repositories.
    const log = git(alice.shared, '-c', 'core.quotepath=off', 'log', '--name-only', '--format=%s');
    expect(log).toMatch(/okb: alice/);
    expect(log.split('\n').filter((l) => l.includes('/')).every((l) => l.startsWith('alice/') || l.startsWith('bob/'))).toBe(true);
    expect((await readdir(alice.kb)).includes('.git')).toBe(false);
  });

  it('without the explicit push, nothing leaves the computer; without Git, sending only fills the drawer', async () => {
    const withGit = await colleagues({ git: true });
    const local = await sendShared(await withGit.alice.config(), withGit.alice.env, { push: false });
    expect(local).toMatchObject({ committed: false, pushed: false });
    expect(local.written).toBeGreaterThan(0);
    expect(withGit.git(resolve(withGit.dir, 'remote.git'), 'for-each-ref').trim()).toBe('');
    closeDbs();
    const plain = await colleagues();
    expect((await failure(sendShared(await plain.alice.config(), plain.alice.env, { push: true }))).key).toBe('shareNoGit');
    expect((await sendShared(await plain.alice.config(), plain.alice.env, { push: false })).written).toBeGreaterThan(0);
  });

  it('an explicit push sends only the previewed managed files, preserving unrelated staged files', async () => {
    const { alice, bob, git } = await colleagues({ git: true });
    await sendShared(await alice.config(), alice.env);
    await writeFile(resolve(alice.shared, 'alice', 'private-by-hand.md'), note('Handwritten private', 'NOTINTHEPREVIEW'));
    await writeFile(resolve(alice.shared, 'unrelated.txt'), 'keep staged');
    git(alice.shared, 'add', 'unrelated.txt');
    await sendShared(await alice.config(), alice.env, { push: true });
    await receiveShared(await bob.config(), bob.env);
    expect(await readFile(resolve(bob.shared, 'alice', 'private-by-hand.md'), 'utf8').catch(() => null)).toBeNull();
    expect(await readFile(resolve(bob.shared, 'unrelated.txt'), 'utf8').catch(() => null)).toBeNull();
    expect(git(alice.shared, 'diff', '--cached', '--name-only').trim()).toBe('unrelated.txt');
  });

  it('a locally prepared change can still be pushed after a colleague advanced a disjoint drawer', async () => {
    const { alice, bob } = await colleagues({ git: true });
    await sendShared(await alice.config(), alice.env, { push: true });
    await receiveShared(await bob.config(), bob.env);
    await sendShared(await bob.config(), bob.env, { push: true });
    await alice.put('3 Boîte à outils/Méthodes/Isoler chaque appel.md', note('Isoler chaque appel', 'An updated method prepared locally before sending.'));
    await sendShared(await alice.config(), alice.env);
    expect(await sendShared(await alice.config(), alice.env, { push: true })).toMatchObject({ pushed: true });
    await receiveShared(await bob.config(), bob.env);
    expect((await readShared(await bob.config(), bob.env, 'alice', '3 Boîte à outils/Méthodes/Isoler chaque appel.md')).markdown).toContain('updated method');
  });

  it('sending an unchanged drawer does not create an artificial Git revision', async () => {
    const { alice, git } = await colleagues({ git: true });
    await sendShared(await alice.config(), alice.env, { push: true });
    const before = git(alice.shared, 'rev-parse', 'HEAD');
    expect(await sendShared(await alice.config(), alice.env, { push: true })).toMatchObject({ written: 0, removed: 0, committed: false, pushed: true });
    expect(git(alice.shared, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('does not publish pre-existing local commits that were never part of the sharing preview', async () => {
    const { alice, git, dir } = await colleagues({ git: true });
    await writeFile(resolve(alice.shared, 'private.txt'), 'A commit not reviewed for sharing');
    git(alice.shared, 'add', 'private.txt');
    git(alice.shared, 'commit', '-q', '-m', 'manual local change');
    expect((await failure(sendShared(await alice.config(), alice.env, { push: true }))).key).toBe('sharePendingCommits');
    expect(git(resolve(dir, 'remote.git'), 'for-each-ref').trim()).toBe('');
    expect(await readFile(resolve(alice.shared, 'private.txt'), 'utf8')).toContain('not reviewed');
  });
});
