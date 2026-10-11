import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { demoNotes, writeDemo } from '../src/brain/demo.js';
import { loadConfig } from '../src/config/load.js';
import type { OkbConfig } from '../src/config/schema.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { writeSetting } from '../src/settings/settings.js';
import { runSetup } from '../src/setup/setup.js';
import { listDrawers, markShared, sendDrawer, setupSharing, sharePreview, sharingOf, unmarkShared } from '../src/share/drawers.js';
import { closeDbs } from '../src/state/db.js';
import { OkbError } from '../src/util/errors.js';

const made: string[] = [];
afterEach(async () => { closeDbs(); for (const d of made.splice(0)) await rm(d, { recursive: true, force: true }); });
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e as OkbError);
const note = (title: string, body: string, extra = '', kind = 'method') => `---\ntype: Guide\ntitle: ${title}\ndescription: ${title}, en une phrase.\nstatus: stable\ngenerated:\n  by: human:test\n  at: 2027-01-05T10:00:00Z\nx_okb:\n  v: 1\n  brain:\n    type: ${kind}\n${extra}---\n\n# ${title}\n\n${body}\n`;

/** Two colleagues, each with their own OKB and their own work brain, and one folder they both reach. */
async function colleagues() {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-share-')));
  made.push(dir);
  const shared = resolve(dir, 'commun');
  await mkdir(shared, { recursive: true });
  const person = async (name: string, preset: 'work' | 'career' = 'work') => {
    const kb = resolve(dir, name, 'kb');
    await writeDemo(kb, demoNotes({ preset: 'work', lang: 'fr' }, { products: 1, repos: 1, tickets: 2, meetings: 1, concepts: 3 }));
    const env = { ...process.env, OKB_HOME: resolve(dir, name, 'home'), OKB_PROFILE: 'travail', HOME: resolve(dir, name) };
    await runSetup({ profileId: 'travail', kbRoot: kb, conceptAssist: 'off', humanActor: `human:${name}`, answerLanguage: 'fr', displayName: `Travail de ${name}`, brain: { preset, names: 'fr' } }, { env });
    const config = async () => (await loadConfig({ env, profileId: 'travail' })).config;
    return { kb, env, config, put: async (path: string, text: string) => { await mkdir(dirname(resolve(kb, path)), { recursive: true }); await writeFile(resolve(kb, path), text); } };
  };
  return { dir, shared, alice: await person('alice'), bob: await person('bob') };
}
const files = async (root: string) => (await readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => resolve(e.parentPath, e.name).slice(root.length + 1)).sort();

describe('drawers in a shared folder (F2.1-01, F2.1-09)', () => {
  it('sharing starts with a folder the person says is allowed, and a drawer of their own', async () => {
    const { shared, alice } = await colleagues();
    const config = await alice.config();
    expect(sharingOf(config)).toBeNull();
    expect((await failure(setupSharing(config, alice.env, { folder: shared, drawer: 'alice', allowed: false }))).key).toBe('shareNotAllowed');
    const done = await setupSharing(config, alice.env, { folder: shared, drawer: 'Alice', allowed: true });
    expect(done).toMatchObject({ folder: shared, drawer: 'alice', git: false });
    expect(sharingOf(await alice.config())).toMatchObject({ folder: shared, drawer: 'alice' });
  });

  it('refuses a folder inside the notes, a brain that must stay on the computer, and the baggage', async () => {
    const { shared, alice, dir } = await colleagues();
    const config = await alice.config();
    expect((await failure(setupSharing(config, alice.env, { folder: resolve(alice.kb, 'partage'), drawer: 'alice', allowed: true }))).key).toBe('shareInsideNotes');
    expect((await failure(setupSharing(config, alice.env, { folder: resolve(dir, 'nulle-part'), drawer: 'alice', allowed: true }))).key).toBe('shareNoFolder');
    await writeSetting('travail', 'kb.confidential', true, alice.env);
    expect((await failure(setupSharing(await alice.config(), alice.env, { folder: shared, drawer: 'alice', allowed: true }))).key).toBe('shareConfidential');
    await writeSetting('travail', 'kb.confidential', false, alice.env);
    await writeSetting('travail', 'kb.space', 'baggage', alice.env);
    expect((await failure(setupSharing(await alice.config(), alice.env, { folder: shared, drawer: 'alice', allowed: true }))).key).toBe('spaceBaggageStays');
  });

  it('a drawer belongs to one person: a colleague cannot take the same name', async () => {
    const { shared, alice, bob } = await colleagues();
    await setupSharing(await alice.config(), alice.env, { folder: shared, drawer: 'equipe', allowed: true });
    await sendDrawer(await alice.config(), alice.env);
    expect((await failure(setupSharing(await bob.config(), bob.env, { folder: shared, drawer: 'equipe', allowed: true }))).key).toBe('drawerTaken');
    expect((await setupSharing(await bob.config(), bob.env, { folder: shared, drawer: 'bob', allowed: true })).drawer).toBe('bob');
  });

  it('simultaneous first sends cannot claim the same drawer for two people', async () => {
    const { shared, alice, bob } = await colleagues();
    await setupSharing(await alice.config(), alice.env, { folder: shared, drawer: 'team', allowed: true });
    await setupSharing(await bob.config(), bob.env, { folder: shared, drawer: 'team', allowed: true });
    await markShared(await alice.config(), ['3 Boîte à outils']);
    await markShared(await bob.config(), ['3 Boîte à outils']);
    const out = await Promise.allSettled([sendDrawer(await alice.config(), alice.env), sendDrawer(await bob.config(), bob.env)]);
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(out.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'E_CONFLICT', key: 'drawerTaken' } });
  });
});

describe('what leaves, and what never does (F2.1-02)', () => {
  async function sharing() {
    const c = await colleagues();
    await c.alice.put('3 Boîte à outils/Méthodes/Isoler chaque appel.md', note('Isoler chaque appel', 'Rejouer chaque appel seul.'));
    await c.alice.put('3 Boîte à outils/Méthodes/Coffre.md', note('Coffre', 'Le tarif est confidentiel.', '  confidentiality: secret\n'));
    await c.alice.put('3 Boîte à outils/Méthodes/Privée.md', note('Privée', 'Pour moi seule.', '  confidentiality: private\n'));
    await c.alice.put('3 Boîte à outils/Méthodes/Avec clé.md', note('Avec clé', `La clé est ${'AKIA' + 'Q3J7Z2M5K8W1R4T6'}.`));
    await c.alice.put('4 Activité/Carrière/Réalisations 2027.md', note('Réalisations 2027', 'J’ai réduit les erreurs de 30 %.', '', 'achievements'));
    await c.alice.put('4 Activité/Carrière/Plan personnel.md', note('Plan personnel', 'Un ancien guide personnel sans type carrière.'));
    await setupSharing(await c.alice.config(), c.alice.env, { folder: c.shared, drawer: 'alice', allowed: true });
    return c;
  }

  it('the preview says what will leave and what is held back, with the reason', async () => {
    const { alice } = await sharing();
    const config = await alice.config();
    await markShared(config, ['3 Boîte à outils/Méthodes', '4 Activité/Carrière']);
    const preview = await sharePreview(config, await loadBundleFor(config));
    expect(preview.leaving.map((n) => n.title)).toEqual(expect.arrayContaining(['Isoler chaque appel']));
    expect(preview.leaving.map((n) => n.title)).not.toEqual(expect.arrayContaining(['Coffre', 'Privée', 'Avec clé', 'Réalisations 2027']));
    expect(Object.fromEntries(preview.held.map((n) => [n.title, n.reason]))).toMatchObject({ Coffre: 'secret', 'Privée': 'private', 'Avec clé': 'holds-secret', 'Réalisations 2027': 'career', 'Plan personnel': 'career' });
  });

  it('sending writes only in the person’s drawer: the notes that leave, as they are, and nothing else', async () => {
    const { alice, shared } = await sharing();
    const config = await alice.config();
    await markShared(config, ['3 Boîte à outils/Méthodes']);
    const sent = await sendDrawer(config, alice.env);
    expect(sent.written).toBeGreaterThan(0);
    const there = await files(shared);
    expect(there.every((f) => f.startsWith('alice/'))).toBe(true);
    expect(there).toContain('alice/3 Boîte à outils/Méthodes/Isoler chaque appel.md');
    expect(there.filter((f) => /Coffre|Privée|Avec clé|Réalisations/.test(f))).toEqual([]);
    expect(await readFile(resolve(shared, 'alice/3 Boîte à outils/Méthodes/Isoler chaque appel.md'), 'utf8')).toBe(note('Isoler chaque appel', 'Rejouer chaque appel seul.'));
    const manifest = JSON.parse(await readFile(resolve(shared, 'alice/drawer.json'), 'utf8')) as { person: { id: string }; name: string; notes: { path: string }[] };
    expect(manifest.person.id).toMatch(/^p-[a-z0-9]{10}$/);
    expect(manifest.notes.map((n) => n.path)).toContain('3 Boîte à outils/Méthodes/Isoler chaque appel.md');
    // Nothing of the person's computer goes with it: no path, no account name.
    expect(JSON.stringify(manifest)).not.toMatch(/okb-share-|\/home|\/Users/);
  });

  it('a note no longer shared, or made 🔒 since, leaves the drawer at the next sending; a stranger’s file is left alone', async () => {
    const { alice, shared } = await sharing();
    const config = await alice.config();
    await markShared(config, ['3 Boîte à outils/Méthodes']);
    await sendDrawer(config, alice.env);
    await writeFile(resolve(shared, 'alice', 'note à la main.md'), 'posée ici par quelqu’un');
    await alice.put('3 Boîte à outils/Méthodes/Isoler chaque appel.md', note('Isoler chaque appel', 'Rejouer chaque appel seul.', '  confidentiality: secret\n'));
    const again = await sendDrawer(await alice.config(), alice.env);
    expect(again.removed).toBe(1);
    const there = await files(shared);
    expect(there).not.toContain('alice/3 Boîte à outils/Méthodes/Isoler chaque appel.md');
    expect(there).toContain('alice/note à la main.md');
    expect(again.unknown).toEqual(['note à la main.md']);
    await unmarkShared(await alice.config(), ['3 Boîte à outils/Méthodes']);
    await sendDrawer(await alice.config(), alice.env);
    expect((await files(shared)).filter((f) => f.endsWith('.md'))).toEqual(['alice/note à la main.md']);
  });

  it('each person sees the drawers of the others, never writes in them', async () => {
    const { alice, bob, shared } = await sharing();
    await markShared(await alice.config(), ['3 Boîte à outils/Méthodes']);
    await sendDrawer(await alice.config(), alice.env);
    await setupSharing(await bob.config(), bob.env, { folder: shared, drawer: 'bob', allowed: true });
    const before = await files(resolve(shared, 'alice'));
    await markShared(await bob.config(), ['3 Boîte à outils/Concepts']);
    await sendDrawer(await bob.config(), bob.env);
    expect(await files(resolve(shared, 'alice'))).toEqual(before);
    const seen = await listDrawers(await bob.config(), bob.env);
    expect(seen.map((d) => [d.drawer, d.mine, d.name])).toEqual([['alice', false, 'Travail de alice'], ['bob', true, 'Travail de bob']]);
    expect(seen[0]!.notes).toBeGreaterThan(0);
  });

  it('a shared folder that is a Git checkout is said so, with where it goes', async () => {
    const { alice, shared } = await colleagues();
    execFileSync('git', ['init', '-q', shared]);
    execFileSync('git', ['-C', shared, 'remote', 'add', 'origin', 'https://user:secret-token@git.example.test/equipe/commun.git']);
    const done = await setupSharing(await alice.config(), alice.env, { folder: shared, drawer: 'alice', allowed: true });
    expect(done).toMatchObject({ git: true, remote: 'https://git.example.test/equipe/commun.git' });
  });

  it('an alias of the brain and symlinks inside a drawer never provide a write escape', async () => {
    const { alice, dir, shared } = await sharing();
    const config = await alice.config();
    await symlink(alice.kb, resolve(dir, 'alias'), 'dir');
    expect((await failure(setupSharing(config, alice.env, { folder: resolve(dir, 'alias'), drawer: 'alice', allowed: true }))).code).toBe('E_FORBIDDEN_PATH');
    await markShared(config, ['3 Boîte à outils/Méthodes']);
    const outside = resolve(dir, 'outside');
    await mkdir(outside);
    await mkdir(resolve(shared, 'alice'));
    await symlink(outside, resolve(shared, 'alice', '3 Boîte à outils'), 'dir');
    expect((await failure(sendDrawer(config, alice.env))).code).toBe('E_FORBIDDEN_PATH');
    expect(await files(outside)).toEqual([]);
  });

  it('neither overwrites an unknown file nor removes an edited copy without the person noticing', async () => {
    const { alice, shared } = await sharing();
    const config = await alice.config();
    const path = '3 Boîte à outils/Méthodes/Isoler chaque appel.md';
    await markShared(config, [path]);
    await mkdir(dirname(resolve(shared, 'alice', path)), { recursive: true });
    await writeFile(resolve(shared, 'alice', path), 'a file placed by hand');
    expect((await failure(sendDrawer(config, alice.env))).code).toBe('E_CONFLICT');
    expect(await readFile(resolve(shared, 'alice', path), 'utf8')).toBe('a file placed by hand');
    await rm(resolve(shared, 'alice', path));
    await sendDrawer(config, alice.env);
    await writeFile(resolve(shared, 'alice', path), 'a colleague corrected this copy');
    await unmarkShared(config, [path]);
    expect((await failure(sendDrawer(config, alice.env))).code).toBe('E_CONFLICT');
    expect(await readFile(resolve(shared, 'alice', path), 'utf8')).toBe('a colleague corrected this copy');
  });

  it('refuses a stale preview before writing and lists what an unmark will remove', async () => {
    const { alice, shared } = await sharing();
    const config = await alice.config();
    const path = '3 Boîte à outils/Méthodes/Isoler chaque appel.md';
    await markShared(config, [path]);
    const preview = await sharePreview(config, await loadBundleFor(config));
    expect(preview.leaving[0]!.markdown).toContain('Rejouer chaque appel seul.');
    await alice.put(path, note('Isoler chaque appel', 'The content has changed.'));
    expect((await failure(sendDrawer(config, alice.env, new Date(), preview.previewHash))).code).toBe('E_STALE');
    expect(await files(shared)).toEqual([]);
    await sendDrawer(config, alice.env);
    await unmarkShared(config, [path]);
    const next = await sharePreview(config, await loadBundleFor(config));
    expect(next.removed).toEqual([{ path, title: 'Isoler chaque appel' }]);
  });
});
