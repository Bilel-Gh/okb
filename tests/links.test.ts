import { describe, expect, it } from 'vitest';
import {
  applyFileEdits,
  checkLinks,
  planMove,
  snapshotFromEntries,
} from '../src/links/check.js';
import { classifyLink, markdownLink, portableLink } from '../src/links/portable.js';

describe('portable links', () => {
  it('generates relative links with an explicit extension from any depth', () => {
    expect(portableLink('concepts/dispatcher.md', 'concepts/idempotence.md')).toBe('idempotence.md');
    expect(portableLink('flows/run-a-delivery-job.md', 'concepts/idempotence.md')).toBe('../concepts/idempotence.md');
    expect(portableLink('index.md', 'flows/run-a-delivery-job.md')).toBe('flows/run-a-delivery-job.md');
    expect(portableLink('a/b/c/deep.md', 'index.md')).toBe('../../../index.md');
  });

  it('percent-encodes only what a markdown destination cannot carry', () => {
    expect(portableLink('index.md', 'notes/my note.md')).toBe('notes/my%20note.md');
    expect(markdownLink('index.md', 'concepts/dispatcher.md', 'The [dispatcher]')).toBe(
      '[The \\[dispatcher\\]](concepts/dispatcher.md)',
    );
  });

  it('classifies every link form the house rules care about', () => {
    // okb-leak-fixture: the absolute paths below are synthetic link samples.
    const from = 'flows/run-a-delivery-job.md';
    expect(classifyLink('https://example.org/a', from).kind).toBe('external');
    expect(classifyLink('mailto:a@example.org', from).kind).toBe('external');
    expect(classifyLink('../concepts/dispatcher.md', from)).toMatchObject({
      kind: 'internal',
      target: 'concepts/dispatcher.md',
    });
    expect(classifyLink('#retry-behaviour', from)).toMatchObject({ kind: 'anchor' });
    expect(classifyLink('/concepts/dispatcher.md', from)).toMatchObject({
      kind: 'forbidden',
      reason: 'bundle-absolute',
    });
    expect(classifyLink('file:///Users/someone/kb/a.md', from).reason).toBe('file-scheme');
    expect(classifyLink('obsidian://open?vault=kb', from).reason).toBe('obsidian-scheme');
    expect(classifyLink('[[dispatcher]]', from).reason).toBe('wikilink');
    expect(classifyLink('../concepts/dispatcher.md#^abc123', from).reason).toBe('block-reference');
    expect(classifyLink('C:\\kb\\a.md', from).reason).toBe('machine-absolute');
    expect(classifyLink('../concepts/dispatcher', from).reason).toBe('missing-extension');
  });

  it('keeps a relative link inside the bundle', () => {
    expect(classifyLink('../../outside.md', 'a/b.md').kind).toBe('forbidden');
  });
});

describe('link checking', () => {
  const snapshot = snapshotFromEntries([
    ['index.md', '# Home\n\n[Flow](flows/run.md) and [folder](concepts/)\n'],
    ['flows/run.md', '---\ntype: Runbook\n---\n\n# Steps\n\n[Dispatcher](../concepts/dispatcher.md)\n[Absolute](/concepts/dispatcher.md)\n[Missing](../concepts/ghost.md)\n[Anchor](../concepts/dispatcher.md#why-it-exists)\n[Bad anchor](../concepts/dispatcher.md#nope)\n'],
    ['concepts/dispatcher.md', '---\ntype: Concept\n---\n\n# Why it exists\n\ntext\n'],
  ]);

  it('flags forbidden forms as errors and unwritten targets as warnings', () => {
    const report = checkLinks(snapshot, { brokenTargetsAre: 'warning' });
    const codes = report.issues.map((i) => `${i.code}:${i.level}`);
    expect(codes).toContain('LINK_FORBIDDEN_FORM:error');
    expect(codes).toContain('LINK_BROKEN_TARGET:warning');
    expect(codes).toContain('LINK_BROKEN_ANCHOR:warning');
    expect(report.issues.find((i) => i.url === '../concepts/dispatcher.md#why-it-exists')).toBeUndefined();
  });

  it('reports a directory link as resolving on GitHub only', () => {
    const report = checkLinks(snapshot, { renderers: ['standard', 'github', 'obsidian'] });
    const issue = report.issues.find((i) => i.url === 'concepts/' && i.code === 'LINK_RENDERER_SPECIFIC');
    expect(issue?.renderers).toEqual(['standard', 'obsidian']);

    const githubOnly = checkLinks(snapshot, { renderers: ['github'] });
    expect(githubOnly.issues.some((i) => i.code === 'LINK_RENDERER_SPECIFIC')).toBe(false);
  });

  it('reports line numbers against the whole file, frontmatter included', () => {
    const report = checkLinks(snapshot);
    const issue = report.issues.find((i) => i.url === '/concepts/dispatcher.md');
    expect(issue?.file).toBe('flows/run.md');
    expect(issue?.line).toBeGreaterThan(4);
  });
});

describe('moving a document', () => {
  const snapshot = snapshotFromEntries([
    ['index.md', '# Home\n\n[Dispatcher](concepts/dispatcher.md)\n'],
    ['flows/run.md', '# Run\n\nSee [the dispatcher](../concepts/dispatcher.md) and [idempotence](../concepts/idempotence.md).\n'],
    ['concepts/dispatcher.md', '# Dispatcher\n\nBack to [idempotence](idempotence.md) and [home](../index.md).\n'],
    ['concepts/idempotence.md', '# Idempotence\n'],
  ]);

  it('rewrites inbound and outbound links so nothing breaks', () => {
    const plan = planMove(snapshot, 'concepts/dispatcher.md', 'reference/fleet/dispatcher.md');

    expect(plan.inbound.map((e) => e.file).sort()).toEqual(['flows/run.md', 'index.md']);
    expect(plan.inbound.find((e) => e.file === 'index.md')?.replacement).toBe(
      '[Dispatcher](reference/fleet/dispatcher.md)',
    );
    expect(plan.inbound.find((e) => e.file === 'flows/run.md')?.replacement).toBe(
      '[the dispatcher](../reference/fleet/dispatcher.md)',
    );
    expect(plan.outbound.map((e) => e.replacement).sort()).toEqual([
      '[home](../../index.md)',
      '[idempotence](../../concepts/idempotence.md)',
    ]);
  });

  it('leaves the bundle link-clean after the move is applied', () => {
    const plan = planMove(snapshot, 'concepts/dispatcher.md', 'reference/fleet/dispatcher.md');
    const edited = applyFileEdits(snapshot, [...plan.inbound, ...plan.outbound]);

    const next = new Map(snapshot.files);
    for (const [file, text] of edited) next.set(file, text);
    next.set('reference/fleet/dispatcher.md' as never, next.get('concepts/dispatcher.md' as never)!);
    next.delete('concepts/dispatcher.md' as never);

    const report = checkLinks({ files: next }, { brokenTargetsAre: 'error' });
    expect(report.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('link checking reuses what it read of an unchanged note (F2.0-22)', () => {
  const md = (body: string) => `---\ntitle: T\n---\n\n${body}\n`;
  const snap = (files: Record<string, string>) => snapshotFromEntries(Object.entries(files));

  it('a link that breaks because its target disappeared is reported, though the linking note did not change', () => {
    const a = md('[B](b.md)');
    expect(checkLinks(snap({ 'a.md': a, 'b.md': md('# B') })).issues).toEqual([]);
    expect(checkLinks(snap({ 'a.md': a })).issues.map((i) => i.code)).toEqual(['LINK_BROKEN_TARGET']);
  });

  it('a heading removed from the target breaks the anchor that pointed to it', () => {
    const a = md('[B](b.md#deux)');
    expect(checkLinks(snap({ 'a.md': a, 'b.md': md('# Un\n\n## Deux') })).issues).toEqual([]);
    expect(checkLinks(snap({ 'a.md': a, 'b.md': md('# Un') })).issues.map((i) => i.code)).toEqual(['LINK_BROKEN_ANCHOR']);
  });

  it('the same text in two notes is checked from each note’s own place', () => {
    const text = md('[C](c.md)');
    const report = checkLinks(snap({ 'x/a.md': text, 'y/a.md': text, 'x/c.md': md('# C') }));
    expect(report.issues.map((i) => i.file)).toEqual(['y/a.md']);
  });
});

describe('the links of a text are read once (F2.0-22)', () => {
  it('the same text gives back the same list of links, without parsing it again', async () => {
    const { extractLinks } = await import('../src/markdown/ast.js');
    const body = '# T\n\n[A](a.md) et [B](b.md)\n';
    const first = extractLinks(body);
    expect(first.map((l) => l.url)).toEqual(['a.md', 'b.md']);
    expect(extractLinks(`${body}`)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('the headings, anchors and links of a text come from a single reading of it', async () => {
    const { bodyFacts, extractLinks, headingSlugs } = await import('../src/markdown/ast.js');
    const body = '# Titre\n\n> ## Dans une citation\n\n## Deux\n\n[A](a.md)\n';
    const facts = bodyFacts(body);
    expect(facts.topHeadings).toEqual(['Titre', 'Deux']);
    expect([...facts.anchors]).toEqual(['titre', 'dans-une-citation', 'deux']);
    expect(headingSlugs(body)).toBe(facts.anchors);
    expect(extractLinks(body)).toBe(facts.links);
  });
});
