import { describe, expect, it } from 'vitest';
import { sourceLabel, sourceResource } from '../src/concepts/card.js';
import type { NormalizedDoc } from '../src/sources/types.js';

const doc = (source: { uri: string; title?: string }) => ({ source: { sha256: 'a'.repeat(64), ...source } }) as unknown as NormalizedDoc;

describe('source naming inside notes', () => {
  it('prefers the title, then the file name, never the absolute local path', () => {
    expect(sourceLabel(doc({ uri: 'file:///srv/archive/notes/x.md', title: 'Réunion produit' }))).toBe('Réunion produit');
    const untitled = doc({ uri: 'file:///srv/archive/raw/15-capture%20et%20tri.md' });
    expect(sourceLabel(untitled)).toBe('15-capture et tri.md');
    expect(sourceLabel(untitled)).not.toContain('/srv/');
    expect(sourceResource(untitled)).toBe(`urn:sha256:${'a'.repeat(64)}`);
    expect(sourceLabel(doc({ uri: 'https://example.org/page' }))).toBe('https://example.org/page');
  });
});

import { codeAdapter } from '../src/sources/adapters/code.js';
describe('schema files as code', () => {
  it('reads a Prisma schema and names its models', async () => {
    const text = 'datasource db {\n  provider = "postgresql"\n}\n\nmodel Affaire {\n  id String @id\n}\n\nenum Statut {\n  ACTIVE\n}\n';
    const input = { filename: 'schema.prisma', bytes: new TextEncoder().encode(text), uri: 'file:///tmp/schema.prisma' };
    expect(codeAdapter.matches(input)).toBe(true);
    const doc = await codeAdapter.extract(input, 'schema');
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(doc.blocks.map((b) => b.locator))).toContain('Affaire');
  });
});
