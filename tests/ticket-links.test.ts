import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDbs } from '../src/state/db.js';
import { documentedRefs, linksFor, scanLinks, setLink } from '../src/work/ticket-links.js';
import { startTicket } from '../src/work/tickets.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { writeFixture } from './helpers/sandbox.js';

useRepoSandboxes();
afterEach(() => closeDbs());

const note = (title: string, ext: Record<string, unknown> = {}, body = 'Texte.') =>
  `---\ntitle: ${title}\ntype: note\ndescription: Une note.\nx_okb: ${JSON.stringify({ v: 1, ...ext })}\n---\n\n${body}\n`;

async function kb() {
  const { config } = await workKb();
  const repo = { id: 'orders', name: 'Orders', path: await gitFixture(), kb: 'travail', addedAt: '', remote: null };
  await startTicket(config, { ref: 'DEMO-4211', title: 'Remises', repo });
  return config;
}
const put = (config: Awaited<ReturnType<typeof kb>>, path: string, text: string) => writeFixture(resolve(config.kb.root, path), text);

describe('notes tied to a ticket (F2.4-11)', () => {
  it('links a note anywhere through its metadata, whatever the case of the reference', async () => {
    const config = await kb();
    await put(config, 'methodo/cas-remises.md', note('Cas les remises', { tickets: ['demo_4211'] }));
    const links = await linksFor(config, 'DEMO-4211', 'person');
    expect(links).toEqual([expect.objectContaining({ path: 'methodo/cas-remises.md', state: 'confirmed', why: 'metadata', title: 'Cas les remises', missing: false })]);
  });

  it('links the notes OKB wrote for the ticket', async () => {
    const config = await kb();
    await put(config, 'travail/reprise.md', note('Reprise', { origin: 'DEMO-4211', brain: { type: 'ticket', ref: 'DEMO-4211' } }));
    expect((await linksFor(config, 'DEMO-4211', 'person')).map((l) => [l.path, l.why])).toEqual([['travail/reprise.md', 'metadata']]);
  });

  it('makes a mention only a suggestion, never suggested again once dismissed, and a rescan creates nothing new', async () => {
    const config = await kb();
    await put(config, 'notes/arrondis.md', note('Arrondis vus sur DEMO-4211'));
    await put(config, 'notes/autre.md', note('Rien à voir'));
    expect(await scanLinks(config)).toEqual({ suggested: 1 });
    expect(await scanLinks(config)).toEqual({ suggested: 0 });
    expect((await linksFor(config, 'DEMO-4211', 'person')).map((l) => [l.path, l.state, l.why])).toEqual([['notes/arrondis.md', 'suggested', 'mention']]);
    setLink(config, 'DEMO-4211', 'notes/arrondis.md', 'dismissed', 'person');
    expect(await scanLinks(config)).toEqual({ suggested: 0 });
    expect(await linksFor(config, 'DEMO-4211', 'person')).toEqual([]);
  });

  it('lets the person link and unlink by hand', async () => {
    const config = await kb();
    await put(config, 'notes/libre.md', note('Libre'));
    setLink(config, 'DEMO-4211', 'notes/libre.md', 'confirmed', 'person');
    expect((await linksFor(config, 'DEMO-4211', 'person')).map((l) => [l.path, l.why])).toEqual([['notes/libre.md', 'manual']]);
    setLink(config, 'DEMO-4211', 'notes/libre.md', 'dismissed', 'person');
    expect(await linksFor(config, 'DEMO-4211', 'person')).toEqual([]);
  });

  it('hides a secret note from the agent only', async () => {
    const config = await kb();
    await put(config, 'notes/secret.md', note('Secret', { tickets: ['DEMO-4211'], confidentiality: 'secret' }));
    expect(await linksFor(config, 'DEMO-4211', 'agent')).toEqual([]);
    expect(await linksFor(config, 'DEMO-4211', 'person')).toHaveLength(1);
  });

  it('finds a moved note by its id and marks a deleted one missing', async () => {
    const config = await kb();
    await put(config, 'notes/a.md', note('A', { id: 'n-aaaa' }));
    await put(config, 'notes/b.md', note('B'));
    setLink(config, 'DEMO-4211', 'notes/a.md', 'confirmed', 'person', 'n-aaaa');
    setLink(config, 'DEMO-4211', 'notes/b.md', 'confirmed', 'person');
    await rm(resolve(config.kb.root, 'notes/a.md'));
    await put(config, 'rangé/a.md', note('A', { id: 'n-aaaa' }));
    await rm(resolve(config.kb.root, 'notes/b.md'));
    const links = await linksFor(config, 'DEMO-4211', 'person');
    expect(links.map((l) => [l.path, l.missing])).toEqual(expect.arrayContaining([['rangé/a.md', false], ['notes/b.md', true]]));
  });

  it('lists the references documented but not followed', async () => {
    const config = await kb();
    await put(config, 'notes/old.md', note('Ancien', { tickets: ['DEMO-4100', 'DEMO-4211'] }));
    expect(await documentedRefs(config)).toEqual(['DEMO-4100']);
  });
});

describe('the sheet shows its notes (F2.4-11)', () => {
  it('lists the linked notes on the sheet', async () => {
    const { ticketSheet } = await import('../src/work/ticket-sheet.js');
    const config = await kb();
    await put(config, 'methodo/cas.md', note('Cas', { tickets: ['DEMO-4211'] }));
    expect((await ticketSheet(config, 'DEMO-4211', 'person')).links.map((l) => l.path)).toEqual(['methodo/cas.md']);
  });
});

describe('a mention is suggested on the sheet without a scan (F2.4-11)', () => {
  it('suggests a note that mentions the reference, until it is dismissed', async () => {
    const config = await kb();
    await put(config, 'notes/vu.md', note('Vu sur DEMO-4211'));
    expect((await linksFor(config, 'DEMO-4211', 'person')).map((l) => [l.path, l.state])).toEqual([['notes/vu.md', 'suggested']]);
    setLink(config, 'DEMO-4211', 'notes/vu.md', 'dismissed', 'person');
    expect(await linksFor(config, 'DEMO-4211', 'person')).toEqual([]);
  });
});
