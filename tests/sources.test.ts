import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquire, extractSource, supportMatrix } from '../src/sources/registry.js';
import { formatLocator } from '../src/sources/types.js';
import { detectCorrections } from '../src/pipeline/corrections.js';
import { makePdf, makeDocx } from './helpers/binaries.js';
import { FIXTURE_SOURCES, makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

async function env() {
  const s = await makeSandbox({ profileId: 'alpha' });
  sandboxes.push(s);
  return { s, config: await s.config() };
}

describe('source adapters', () => {
  it('declares exactly what it supports', async () => {
    const { config } = await env();
    const matrix = supportMatrix(config);
    expect(matrix.map((m) => m.kind).sort()).toEqual(['docx', 'html', 'markdown', 'pdf', 'vtt']);
    expect(matrix.find((m) => m.kind === 'pdf')?.notes).toContain('no OCR');
  });

  it('extracts VTT cues with timecodes and speakers', async () => {
    const { config } = await env();
    const doc = await extractSource(
      await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), config),
      config,
    );
    expect(doc.source.kind).toBe('vtt');
    expect(doc.source.support).toBe('full');
    expect(doc.blocks.length).toBeGreaterThan(5);
    expect(doc.blocks[0]?.speaker).toBe('Dana');
    expect(formatLocator(doc.blocks[0]!.locator)).toBe('00:02–00:11');
    expect(doc.source.limitations.join(' ')).toContain('not from audio');
  });

  it('keeps late corrections, negations and exceptions findable', async () => {
    const { config } = await env();
    const doc = await extractSource(
      await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), config),
      config,
    );
    const corrections = detectCorrections(doc);
    const labels = corrections.map((c) => c.marker);
    expect(labels.some((l) => l.startsWith('correction'))).toBe(true);
    expect(labels.some((l) => l.startsWith('exception') || l.startsWith('negation'))).toBe(true);

    const drxCorrection = corrections.find((c) => c.quote.includes('is not a pipeline'));
    expect(drxCorrection?.correctedBlockId).not.toBeNull();
  });

  it('extracts markdown structure and recognises frontmatter', async () => {
    const { config } = await env();
    const doc = await extractSource(
      await acquire(resolve(FIXTURE_SOURCES, 'dispatcher-notes.md'), config),
      config,
    );
    expect(doc.source.kind).toBe('markdown');
    expect(doc.blocks.some((b) => b.kind === 'code')).toBe(true);
    expect(doc.blocks.some((b) => b.kind === 'quote')).toBe(true);
    expect(doc.outline.length).toBeGreaterThan(0);
  });

  it('strips boilerplate from an HTML article and says the removal is heuristic', async () => {
    const { config } = await env();
    const doc = await extractSource(
      await acquire(resolve(FIXTURE_SOURCES, 'fleet-article.html'), config),
      config,
    );
    const text = doc.blocks.map((b) => b.text).join(' ');
    expect(text).toContain('The dispatcher assigns a job');
    expect(text).not.toContain('must be dropped');
    expect(text).not.toContain('© Acme Robotics');
    expect(doc.source.support).toBe('partial');
    expect(doc.source.limitations.join(' ')).toContain('heuristic');
  });

  it('reads a PDF text layer with page locators', async () => {
    const { s, config } = await env();
    const path = resolve(s.dir, 'report.pdf');
    await writeFixture(path, makePdf(['Fleet report 2026', 'The dispatcher assigns one job per robot.']));

    const doc = await extractSource(await acquire(path, config), config);
    expect(doc.source.kind).toBe('pdf');
    expect(doc.source.support).toBe('full');
    expect(doc.blocks.map((b) => b.text).join(' ')).toContain('dispatcher assigns one job');
    expect(formatLocator(doc.blocks[0]!.locator)).toBe('p.1');
  });

  it('reports a scanned PDF as unsupported instead of as an empty document', async () => {
    const { s, config } = await env();
    const path = resolve(s.dir, 'scanned.pdf');
    await writeFixture(path, makePdf([], false));

    const doc = await extractSource(await acquire(path, config), config);
    expect(doc.source.support).toBe('unsupported');
    expect(doc.blocks).toHaveLength(0);
    expect(doc.source.limitations.join(' ')).toContain('no extractable text layer');
    expect(doc.source.limitations.join(' ')).toContain('absent — not empty');
  });

  it('reads a DOCX body and lists what it cannot see', async () => {
    const { s, config } = await env();
    const path = resolve(s.dir, 'note.docx');
    await writeFixture(path, makeDocx(['Fleet handbook', 'Idempotence protects retried requests.']));

    const doc = await extractSource(await acquire(path, config), config);
    expect(doc.source.kind).toBe('docx');
    expect(doc.blocks.map((b) => b.text).join(' ')).toContain('Idempotence protects retried requests');
    expect(doc.source.limitations.join(' ')).toContain('tracked changes');
  });

  it('refuses an unknown format with an explicit, actionable error', async () => {
    const { s, config } = await env();
    const path = resolve(s.dir, 'archive.bin');
    await writeFixture(path, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));

    await expect(extractSource(await acquire(path, config), config)).rejects.toMatchObject({
      code: 'E_UNSUPPORTED',
      hint: expect.stringContaining('Supported kinds'),
    });
  });

  it('refuses a malformed file of a supported kind', async () => {
    const { s, config } = await env();
    const path = resolve(s.dir, 'broken.vtt');
    await writeFixture(path, 'this is not a caption file at all');

    await expect(
      extractSource(await acquire(path, config), config, { kind: 'vtt' }),
    ).rejects.toMatchObject({ code: 'E_EXTRACTION' });
  });

  it('refuses a disabled source kind', async () => {
    const { s, config } = await env();
    const narrowed = { ...config, sources: { ...config.sources, enabled: ['markdown' as const] } };
    const path = resolve(FIXTURE_SOURCES, 'weekly-sync.vtt');
    await expect(extractSource(await acquire(path, narrowed), narrowed)).rejects.toMatchObject({
      code: 'E_UNSUPPORTED',
      message: expect.stringContaining('disabled'),
    });
  });

  it('refuses a URL when the web connector is off, without touching the network', async () => {
    const { config } = await env();
    await expect(acquire('https://example.org/article', config)).rejects.toMatchObject({
      code: 'E_UNSUPPORTED',
      message: expect.stringContaining('web connector is disabled'),
    });
  });

  it('refuses a domain that is not allow-listed', async () => {
    const { config } = await env();
    const open = {
      ...config,
      connectors: { ...config.connectors, web: { enabled: true, allowDomains: ['example.org'] } },
    };
    await expect(acquire('https://elsewhere.test/a', open)).rejects.toMatchObject({
      code: 'E_FORBIDDEN_PATH',
    });
  });

  it('records a fingerprint so a changed source can be detected later', async () => {
    const { config } = await env();
    const path = resolve(FIXTURE_SOURCES, 'dispatcher-notes.md');
    const a = await extractSource(await acquire(path, config), config);
    const b = await extractSource(await acquire(path, config), config);
    expect(a.source.sha256).toBe(b.source.sha256);
    expect(a.source.sha256).toHaveLength(64);
    expect(a.source.bytes).toBe((await readFile(path)).byteLength);
  });
});
