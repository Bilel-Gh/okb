import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';
import { maintain } from '../src/maintain/maintain.js';
import { saveNormalized } from '../src/pipeline/checkpoint.js';
import { acquireFile, extractSource } from '../src/sources/registry.js';
import { retainAcquired } from '../src/sources/retention.js';
import { sha256 } from '../src/util/hash.js';
import { walkFiles, writeJsonAtomic } from '../src/util/fsx.js';
import type { OkbConfig } from '../src/config/schema.js';

const boxes: Sandbox[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(boxes.splice(0).map(s => s.cleanup()));
});

async function fixture() {
  const s = await makeSandbox({ profileId: 'freshness' });
  boxes.push(s);
  const config = await s.config();
  // MacOS tempdir can contain a system symlink. The recorded fixture path is
  // physical so the explicit symlink-refusal tests concern the source itself.
  const source = resolve(await realpath(s.dir), 'private-source.md');
  const text = '# Local source\n\nA fictional initial fact.\n';
  await writeFixture(source, text);
  const acquired = await acquireFile(source);
  const doc = await extractSource(acquired, config);
  await saveNormalized(config, 'run-local', doc);
  const resource = `urn:sha256:${doc.source.sha256}`;
  await note(config, 'notes/learn.md', [resource, resource]);
  return { s, config, source, text, acquired, doc, resource };
}

async function note(config: OkbConfig, path: string, resources: string[]) {
  await writeFixture(resolve(config.kb.root, path), `---\n${YAML.stringify({
    type: 'Reference', title: 'Learn', description: 'A fictional note.', status: 'draft',
    sources: resources.map((resource, i) => ({ id: `local-${i}`, resource })),
  })}---\n\n# Learn\n\nA fictional fact.\n`);
}

const sourceIssues = (report: Awaited<ReturnType<typeof maintain>>) => report.issues.filter(i => i.code.startsWith('SOURCE_'));
async function stateSnapshot(config: OkbConfig) {
  const files = await walkFiles(config.stateHome);
  return Promise.all(files.map(async path => [path, sha256(await readFile(resolve(config.stateHome, path)))]));
}

describe('surface ambiguity', () => {
  it('counts distinct notes instead of treating a title and its own alias as a collision', async () => {
    const f = await fixture();
    const content = '---\ntype: Concept\ntitle: Identical Surface\ndescription: A fictional concept.\nstatus: draft\nx_okb:\n  v: 1\n  aliases: [Identical Surface, identical surface]\n---\n\n# Identical Surface\n';
    await writeFixture(resolve(f.config.kb.root, 'concepts/unique.md'), content);
    const ambiguous = (await maintain(f.config)).issues.filter(i => i.code === 'AMBIGUOUS_SURFACE' && i.message.includes('identical surface'));
    expect(ambiguous).toEqual([]);
    await writeFixture(resolve(f.config.kb.root, 'concepts/collision.md'), content);
    const collision = (await maintain(f.config)).issues.filter(i => i.code === 'AMBIGUOUS_SURFACE' && i.message.includes('identical surface'));
    expect(collision).toMatchObject([{ message: expect.stringContaining('2 documents') }]);
  });
});

describe('navigation maintenance', () => {
  it('tolerates malformed URL escapes and finds reference links while ignoring code and self links', async () => {
    const f = await fixture();
    await note(f.config, 'notes/reference-target.md', []);
    await note(f.config, 'notes/code-target.md', []);
    await note(f.config, 'notes/self.md', []);
    await writeFixture(resolve(f.config.kb.root, 'notes/reader.md'), '# Reader\n\n[Broken](invalid%ZZ.md)\n\n[Useful][target]\n\n[target]: reference-target.md\n\n```md\n[Example](code-target.md)\n```\n');
    const self = resolve(f.config.kb.root, 'notes/self.md');
    await writeFile(self, (await readFile(self, 'utf8')) + '\n[Self](self.md)\n');
    const report = await maintain(f.config);
    const orphans = report.issues.filter(i => i.code === 'ORPHAN').map(i => i.path);
    expect(orphans).not.toContain('notes/reference-target.md');
    expect(orphans).toContain('notes/code-target.md');
    expect(orphans).toContain('notes/self.md');
    expect(report.linkIssues.some(i => i.url === 'invalid%ZZ.md')).toBe(true);
  });
});

describe('opt-in local source freshness', () => {
  it('checks only on request and reports a changed source once per note without rewriting anything', async () => {
    const f = await fixture();
    expect(sourceIssues(await maintain(f.config, { checkSources: true }))).toEqual([]);
    await writeFile(f.source, '# Local source\n\nPRIVATE_CONTENT_NEVER_PRINTED\n');
    const beforeState = await stateSnapshot(f.config);
    const beforeNote = await readFile(resolve(f.config.kb.root, 'notes/learn.md'), 'utf8');
    expect(sourceIssues(await maintain(f.config))).toEqual([]);
    const report = await maintain(f.config, { checkSources: true });
    expect(sourceIssues(report)).toMatchObject([{ code: 'SOURCE_CHANGED', level: 'warning', path: 'notes/learn.md' }]);
    expect(report.summary['kb:SOURCE_CHANGED']).toBe(1);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CONTENT_NEVER_PRINTED');
    expect(JSON.stringify(report)).not.toContain(f.source);
    expect(await stateSnapshot(f.config)).toEqual(beforeState);
    expect(await readFile(resolve(f.config.kb.root, 'notes/learn.md'), 'utf8')).toBe(beforeNote);
  });

  it('compares every historical fingerprint against one current file instead of sharing a verdict', async () => {
    const f = await fixture();
    const newer = '# Local source\n\nA changed fictional fact.\n';
    await writeFile(f.source, newer);
    const doc = await extractSource(await acquireFile(f.source), f.config);
    await saveNormalized(f.config, 'run-newer', doc);
    await note(f.config, 'notes/newer.md', [`urn:sha256:${doc.source.sha256}`]);
    const issues = sourceIssues(await maintain(f.config, { checkSources: true }));
    expect(issues).toMatchObject([{ code: 'SOURCE_CHANGED', path: 'notes/learn.md' }]);
  });

  it('distinguishes a missing file from a fingerprint whose private reference is unavailable', async () => {
    const f = await fixture();
    await rm(f.source);
    expect(sourceIssues(await maintain(f.config, { checkSources: true }))).toMatchObject([{ code: 'SOURCE_MISSING' }]);
    await rm(resolve(f.config.stateHome, 'runs/run-local'), { recursive: true });
    expect(sourceIssues(await maintain(f.config, { checkSources: true }))).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN' }]);
  });

  it('never reads hashless file references or fetches web sources', async () => {
    const f = await fixture();
    const fetch = vi.fn(() => { throw new Error('network must stay unused'); });
    vi.stubGlobal('fetch', fetch);
    await note(f.config, 'notes/hashless.md', [pathToFileURL(f.source).href]);
    await note(f.config, 'notes/web.md', ['https://example.invalid/source']);
    const issues = sourceIssues(await maintain(f.config, { checkSources: true }));
    expect(issues).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN', path: 'notes/hashless.md' }]);
    expect(JSON.stringify(issues)).not.toContain(f.source);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a redirected source symlink and sources over the byte limit', async () => {
    const f = await fixture();
    const other = resolve(await realpath(f.s.dir), 'other.md');
    await writeFile(other, '# PRIVATE_OTHER_SOURCE\n');
    await rm(f.source);
    await symlink(other, f.source);
    let issues = sourceIssues(await maintain(f.config, { checkSources: true }));
    expect(issues).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN', message: expect.stringContaining('symbolic link') }]);
    await rm(f.source);
    await writeFile(f.source, 'too large');
    issues = sourceIssues(await maintain({ ...f.config, sources: { ...f.config.sources, limits: { ...f.config.sources.limits, maxBytes: 2 } } }, { checkSources: true }));
    expect(issues).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN', message: expect.stringContaining('maxBytes') }]);
  });

  it('does not guess which identical-byte source originally supplied a note', async () => {
    const f = await fixture();
    const other = resolve(await realpath(f.s.dir), 'other.md');
    await writeFile(other, f.text);
    await saveNormalized(f.config, 'run-alias', await extractSource(await acquireFile(other), f.config));
    await writeFile(other, 'changed');
    const issues = sourceIssues(await maintain(f.config, { checkSources: true }));
    expect(issues).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN', message: expect.stringContaining('ambiguous') }]);
  });

  it('uses the original source fingerprint when only a redacted copy archive remains', async () => {
    const f = await fixture();
    const config = { ...f.config, sources: { ...f.config.sources, retention: { ...f.config.sources.retention, mode: 'copy' as const, redactPatterns: ['fictional'] } } };
    await retainAcquired(config, f.acquired, f.doc);
    await rm(resolve(config.stateHome, 'runs/run-local'), { recursive: true });
    const before = await stateSnapshot(config);
    expect(sourceIssues(await maintain(config, { checkSources: true }))).toEqual([]);
    await writeFile(f.source, '# A changed source\n');
    expect(sourceIssues(await maintain(config, { checkSources: true }))).toMatchObject([{ code: 'SOURCE_CHANGED' }]);
    expect(await stateSnapshot(config)).toEqual(before);
  });

  it('ignores symlinked or malformed operational metadata instead of following it', async () => {
    const f = await fixture();
    const metadata = resolve(f.config.stateHome, 'runs/run-local/source.json');
    const copied = resolve(await realpath(f.s.dir), 'source-metadata.json');
    await writeFile(copied, await readFile(metadata));
    await rm(metadata);
    await symlink(copied, metadata);
    expect(sourceIssues(await maintain(f.config, { checkSources: true }))).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN' }]);
    await rm(metadata);
    await writeJsonAtomic(metadata, { source: { sha256: f.doc.source.sha256, uri: 'file://remote.invalid/untrusted.md' } });
    expect(sourceIssues(await maintain(f.config, { checkSources: true }))).toMatchObject([{ code: 'SOURCE_FRESHNESS_UNKNOWN' }]);
  });
});
