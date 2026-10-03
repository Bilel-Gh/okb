import { describe, expect, it } from 'vitest';
import { parseOkf, serializeOkf, withBody } from '../src/okf/document.js';
import { getExtension, withExtension } from '../src/okf/extensions.js';
import { effectiveStatus, isStale, trustTier } from '../src/okf/types.js';
import { DEFAULT_PRODUCT_RULES, validateDocument } from '../src/okf/validate.js';

const DOC = `---
type: Concept
title: Dispatcher
description: Assigns a job.
tags: [concept, fleet]
status: stable
generated: { by: "human:alex", at: 2026-01-15T09:30:00Z }
# a comment the producer cares about
vendor_specific:
  nested:
    deep: [1, 2, 3]
  flag: true
x_okb:
  v: 1
  aliases: [Assigner]
---

Body text stays byte-identical.

# Section

| a | b |
|---|---|
| 1 | 2 |
`;

describe('OKF documents', () => {
  it('round-trips without touching unknown keys, comments or the body', () => {
    const doc = parseOkf('concepts/dispatcher.md', DOC);
    expect(serializeOkf(doc)).toBe(DOC);
  });

  it('keeps producer extensions when a single field is rewritten', () => {
    const doc = parseOkf('concepts/dispatcher.md', DOC);
    const next = serializeOkf(doc, { ...doc.data, status: 'draft' });
    const reparsed = parseOkf('concepts/dispatcher.md', next);

    expect(reparsed.data.status).toBe('draft');
    expect(reparsed.data.vendor_specific).toEqual({ nested: { deep: [1, 2, 3] }, flag: true });
    expect(getExtension(reparsed.data).aliases).toEqual(['Assigner']);
    expect(next).toContain('# a comment the producer cares about');
    expect(reparsed.body).toBe(doc.body);
  });

  it('merges x_okb lists without losing previous entries', () => {
    const doc = parseOkf('concepts/dispatcher.md', DOC);
    const patched = withExtension(doc.data, { aliases: ['Job dispatcher'], ingested: ['key-1'] });
    expect(getExtension(patched).aliases).toEqual(['Assigner', 'Job dispatcher']);
    expect(getExtension(patched).ingested).toEqual(['key-1']);
  });

  it('treats a document with only `type` as conformant', () => {
    const doc = parseOkf('a.md', '---\ntype: Metric\n---\n\nbody\n');
    const report = validateDocument(doc, DEFAULT_PRODUCT_RULES);
    expect(report.okfConformant).toBe(true);
    expect(report.productCompliant).toBe(false);
    expect(report.findings.filter((f) => f.layer === 'product').length).toBeGreaterThan(0);
  });

  it('separates OKF conformance from product rules', () => {
    const doc = parseOkf('a.md', '---\ntitle: No type here\n---\n\nbody\n');
    const report = validateDocument(doc, DEFAULT_PRODUCT_RULES);
    expect(report.okfConformant).toBe(false);
    expect(report.findings.find((f) => f.code === 'OKF_MISSING_TYPE')?.layer).toBe('okf');
  });

  it('rejects an actor that does not follow the convention', () => {
    const doc = parseOkf('a.md', '---\ntype: Metric\ngenerated: { by: alex, at: 2026-01-01T00:00:00Z }\n---\n');
    const findings = validateDocument(doc).findings;
    expect(findings.some((f) => f.code === 'OKF_BAD_GENERATED_BY')).toBe(true);
  });

  it('refuses a machine that verifies its own output', () => {
    const doc = parseOkf(
      'a.md',
      '---\ntype: Metric\ntitle: t\ndescription: d\nstatus: stable\ngenerated: { by: "okb/0.1", at: 2026-01-01T00:00:00Z }\nverified: { by: "okb/0.1", at: 2026-01-01T00:00:00Z }\n---\n',
    );
    const findings = validateDocument(doc).findings;
    expect(findings.some((f) => f.code === 'PROD_SELF_VERIFIED' && f.layer === 'product')).toBe(true);
  });

  it('derives trust tiers and status defaults from the spec', () => {
    expect(trustTier({})).toBe('unverified');
    expect(trustTier({ verified: { by: 'process:nightly', at: '2026-01-01T00:00:00Z' } })).toBe('machine-confirmed');
    expect(trustTier({ verified: [{ by: 'human:alex' }, { by: 'process:n' }] })).toBe('human-reviewed');
    expect(effectiveStatus({})).toBe('stable');
    expect(isStale({ stale_after: '2000-01-01T00:00:00Z' })).toBe(true);
    expect(isStale({ stale_after: '2999-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects reserved files carrying frontmatter, except a root index declaring okf_version', () => {
    const rootIndex = parseOkf('index.md', '---\nokf_version: "0.2"\n---\n\n# Home\n');
    expect(validateDocument(rootIndex).okfConformant).toBe(true);

    const nestedIndex = parseOkf('concepts/index.md', '---\ntype: Reference\n---\n\n# Concepts\n');
    expect(validateDocument(nestedIndex).findings.some((f) => f.code === 'OKF_RESERVED_FRONTMATTER')).toBe(true);
  });

  it('reports an unterminated frontmatter block instead of guessing', () => {
    expect(() => parseOkf('a.md', '---\ntype: Metric\n\nno closing fence')).toThrow(/unterminated/);
  });

  it('replaces a body without disturbing the frontmatter block', () => {
    const doc = parseOkf('concepts/dispatcher.md', DOC);
    const next = withBody(doc, '\nnew body\n');
    expect(next.raw.startsWith('---\ntype: Concept')).toBe(true);
    expect(next.raw.endsWith('\nnew body\n')).toBe(true);
  });
});
