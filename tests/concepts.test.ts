import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConceptCard, conceptPathFor } from '../src/concepts/card.js';
import { detectConcepts, effectiveLevel } from '../src/concepts/detect.js';
import { planLinkInjection } from '../src/concepts/inject.js';
import { buildLexicon } from '../src/concepts/lexicon.js';
import { buildPrereqChain, findAllPrereqCycles } from '../src/concepts/prereq.js';
import { loadBundle } from '../src/kb/bundle.js';
import { applyEdits } from '../src/markdown/ast.js';
import { acquire, extractSource } from '../src/sources/registry.js';
import { asBundlePath } from '../src/util/paths.js';
import { FIXTURE_SOURCES, makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

async function env(profileId = 'alpha') {
  const s = await makeSandbox({ profileId });
  sandboxes.push(s);
  const config = await s.config();
  const bundle = await loadBundle(config.kb.root);
  return { s, config, bundle };
}

async function vttDoc(config: Awaited<ReturnType<typeof env>>['config']) {
  return extractSource(await acquire(resolve(FIXTURE_SOURCES, 'weekly-sync.vtt'), config), config);
}

describe('concept assist', () => {
  it('produces nothing at all when disabled', async () => {
    const { config, bundle } = await env();
    const doc = await vttDoc(config);
    const off = { ...config, conceptAssist: { ...config.conceptAssist, level: 'off' as const } };

    const result = detectConcepts(doc, bundle, off);
    expect(result.level).toBe('off');
    expect(result.candidates).toEqual([]);
  });

  it('resolves the effective level: import override > domain > profile', async () => {
    const { config } = await env();
    const withDomain = {
      ...config,
      conceptAssist: { ...config.conceptAssist, level: 'targeted' as const, byDomain: { fleet: 'pedagogical' as const } },
    };
    expect(effectiveLevel(withDomain)).toBe('targeted');
    expect(effectiveLevel(withDomain, { domain: 'fleet' })).toBe('pedagogical');
    expect(effectiveLevel(withDomain, { domain: 'fleet', level: 'off' })).toBe('off');
  });

  it('reuses an existing card found through an alias', async () => {
    const { config, bundle } = await env();
    const lexicon = buildLexicon(bundle, config.kb.layout.concepts);
    expect(lexicon.byCanonical.get('idempotency')?.senses[0]?.path).toBe('concepts/idempotence.md');

    const doc = {
      source: {
        id: 's1', uri: 'test://alias', kind: 'markdown' as const, adapter: 'inline', adapterVersion: '1',
        sha256: 'x', bytes: 1, acquiredAt: '2026-01-01T00:00:00Z', support: 'full' as const, limitations: [],
      },
      blocks: [
        { id: 's1#0', index: 0, kind: 'paragraph' as const, text: 'Idempotency is why a retry is safe. Idempotency again.', locator: { kind: 'line' as const, line: 1 } },
      ],
      outline: [],
    };

    const { candidates } = detectConcepts(doc, bundle, config);
    const hit = candidates.find((c) => c.canonical === 'idempotency');
    expect(hit?.resolution).toMatchObject({ status: 'existing', path: 'concepts/idempotence.md', via: 'alias' });
  });

  it('refuses to link a surface form that two documents claim', async () => {
    const { s, config } = await env();
    await mkdir(resolve(s.vault, 'concepts'), { recursive: true });
    await writeFile(
      resolve(s.vault, 'concepts', 'agent-runtime.md'),
      '---\ntype: Concept\ntitle: Agent\ndescription: A process running on a host.\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\n---\n\nA runtime agent.\n',
    );
    await writeFile(
      resolve(s.vault, 'concepts', 'agent-person.md'),
      '---\ntype: Concept\ntitle: Agent\ndescription: A person handling customer requests.\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\n---\n\nA support agent.\n',
    );
    const bundle = await loadBundle(config.kb.root);

    const doc = {
      source: {
        id: 's1', uri: 'test://ambig', kind: 'markdown' as const, adapter: 'inline', adapterVersion: '1',
        sha256: 'x', bytes: 1, acquiredAt: '2026-01-01T00:00:00Z', support: 'full' as const, limitations: [],
      },
      blocks: [
        { id: 's1#0', index: 0, kind: 'paragraph' as const, text: 'The agent handles the request. Another agent logs it.', locator: { kind: 'line' as const, line: 1 } },
      ],
      outline: [],
    };

    const { candidates } = detectConcepts(doc, bundle, config);
    expect(candidates.find((c) => c.canonical === 'agent')?.resolution.status).toBe('ambiguous');
  });

  it('never invents the expansion of an internal acronym', async () => {
    const { config, bundle } = await env();
    const doc = await vttDoc(config);
    const { candidates } = detectConcepts(doc, bundle, config);

    const drx = candidates.find((c) => c.canonical === 'drx');
    expect(drx?.expansionFromSource?.text).toBe('Delivery Routing eXchange');

    const zqt = candidates.find((c) => c.canonical === 'zqt');
    expect(zqt?.resolution.status).toBe('needs-clarification');
    expect(zqt?.expansionFromSource).toBeUndefined();

    const card = buildConceptCard({
      candidate: zqt!,
      doc,
      bundle,
      config,
      path: asBundlePath('concepts/zqt.md'),
    });
    expect(card.needsClarification).toBe(true);
    expect(card.content).toContain('needs_clarification: true');
    expect(card.content).toContain('status: draft');
    expect(card.content).toContain("n'a pas été deviné");
  });

  it('never grants verification to a freshly generated card', async () => {
    const { config, bundle } = await env();
    const doc = await vttDoc(config);
    const { candidates } = detectConcepts(doc, bundle, config);
    const card = buildConceptCard({
      candidate: candidates[0]!,
      doc,
      bundle,
      config,
      path: conceptPathFor(config, candidates[0]!.surface, new Set()),
    });
    expect(card.content).toContain('status: draft');
    expect(card.content).not.toContain('verified:');
  });
});

describe('link injection', () => {
  const BODY = `---
type: Reference
title: Notes
description: d
status: draft
generated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }
---

The dispatcher assigns a job and idempotence protects the retry.

# Code

\`\`\`js
const dispatcher = 1; // idempotence inside a fence
\`\`\`

The dispatcher is mentioned a second time in this same section.

# Quoted

> The dispatcher said idempotence matters.

Here [dispatcher](../concepts/dispatcher.md) is already a link.

# Sources

- A note about the dispatcher and idempotence that must stay plain.
`;

  it('links the first useful occurrence per section and leaves code, quotes, links and sources alone', () => {
    const file = asBundlePath('flows/notes.md');
    const plan = planLinkInjection(
      file,
      BODY,
      [
        { surfaces: ['dispatcher'], canonical: 'dispatcher', target: asBundlePath('concepts/dispatcher.md') },
        { surfaces: ['idempotence'], canonical: 'idempotence', target: asBundlePath('concepts/idempotence.md') },
      ],
      { maxLinksPerDocument: 10, maxLinksPerTermPerSection: 1 },
    );

    const next = applyEdits(
      BODY,
      plan.insertions.map((i) => ({ start: i.span.start, end: i.span.end, replacement: i.replacement })),
    );

    expect(next).toContain('[dispatcher](../concepts/dispatcher.md) assigns a job');
    expect(next).toContain('[idempotence](../concepts/idempotence.md) protects the retry');
    expect(next).toContain('const dispatcher = 1; // idempotence inside a fence');
    expect(next).toContain('> The dispatcher said idempotence matters.');
    expect(next).toContain('- A note about the dispatcher and idempotence that must stay plain.');
    expect(next).not.toContain('[[');
    expect(next.match(/\[dispatcher\]\(\.\.\/concepts\/dispatcher\.md\)/g)?.length).toBe(3);
  });

  it('honours a zero link budget', () => {
    const plan = planLinkInjection(
      asBundlePath('flows/notes.md'),
      BODY,
      [{ surfaces: ['dispatcher'], canonical: 'dispatcher', target: asBundlePath('concepts/dispatcher.md') }],
      { maxLinksPerDocument: 0, maxLinksPerTermPerSection: 1 },
    );
    expect(plan.insertions).toEqual([]);
  });

  it('uses existing links per section instead of a stale document-wide ledger', () => {
    const withLedger = BODY.replace(
      'generated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }',
      'generated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\nx_okb:\n  v: 1\n  linked: ["dispatcher@concepts/dispatcher.md"]',
    );
    const plan = planLinkInjection(
      asBundlePath('flows/notes.md'),
      withLedger,
      [{ surfaces: ['dispatcher'], canonical: 'dispatcher', target: asBundlePath('concepts/dispatcher.md') }],
      { maxLinksPerDocument: 10, maxLinksPerTermPerSection: 1 },
    );
    expect(plan.insertions.map(i => i.section)).toEqual(['', 'Code']);
    const injected = applyEdits(withLedger, plan.insertions.map(i => ({ ...i.span, replacement: i.replacement })));
    const second = planLinkInjection(asBundlePath('flows/notes.md'), injected, [{ surfaces: ['dispatcher'], canonical: 'dispatcher', target: asBundlePath('concepts/dispatcher.md') }], { maxLinksPerDocument: 10, maxLinksPerTermPerSection: 1 });
    expect(second.insertions).toEqual([]);
  });

  it('prefers the longest surface so a shorter one does not nest inside it', () => {
    const text = '---\ntype: Reference\n---\n\nThe Delivery Routing eXchange and the exchange.\n';
    const plan = planLinkInjection(
      asBundlePath('a.md'),
      text,
      [
        { surfaces: ['Delivery Routing eXchange'], canonical: 'delivery routing exchange', target: asBundlePath('concepts/drx.md') },
        { surfaces: ['exchange'], canonical: 'exchange', target: asBundlePath('concepts/exchange.md') },
      ],
      { maxLinksPerDocument: 10, maxLinksPerTermPerSection: 1 },
    );
    const next = applyEdits(text, plan.insertions.map((i) => ({ start: i.span.start, end: i.span.end, replacement: i.replacement })));
    expect(next).toContain('[Delivery Routing eXchange](concepts/drx.md)');
    expect(next).toContain('the [exchange](concepts/exchange.md)');
  });

  it('never links a document to itself', () => {
    const plan = planLinkInjection(
      asBundlePath('concepts/dispatcher.md'),
      '---\ntype: Concept\n---\n\nThe dispatcher explains itself.\n',
      [{ surfaces: ['dispatcher'], canonical: 'dispatcher', target: asBundlePath('concepts/dispatcher.md') }],
      { maxLinksPerDocument: 5, maxLinksPerTermPerSection: 1 },
    );
    expect(plan.insertions).toEqual([]);
  });
});

describe('prerequisites', () => {
  it('orders foundations first and respects the depth limit', async () => {
    const { bundle } = await env();
    const chain = buildPrereqChain(bundle, asBundlePath('flows/run-a-delivery-job.md'), { maxDepth: 2 });
    expect(chain.order).toContain('concepts/idempotence.md');
    expect(chain.order).toContain('concepts/dispatcher.md');
    expect(chain.order.indexOf(asBundlePath('concepts/idempotence.md'))).toBeLessThan(
      chain.order.indexOf(asBundlePath('concepts/dispatcher.md')),
    );

    const shallow = buildPrereqChain(bundle, asBundlePath('flows/run-a-delivery-job.md'), { maxDepth: 0 });
    expect(shallow.order).toEqual([]);
    expect(shallow.truncatedAtDepth).toBe(true);
  });

  it('detects a cycle instead of looping forever', async () => {
    const { s, config } = await env();
    await writeFile(
      resolve(s.vault, 'concepts', 'idempotence.md'),
      '---\ntype: Concept\ntitle: Idempotence\ndescription: d\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\nx_okb:\n  v: 1\n  aliases: [Idempotency]\n  prereqs:\n    - concepts/dispatcher.md\n---\n\nbody\n',
    );
    const bundle = await loadBundle(config.kb.root);

    const cycles = findAllPrereqCycles(bundle);
    expect(cycles.length).toBeGreaterThan(0);

    const chain = buildPrereqChain(bundle, asBundlePath('concepts/dispatcher.md'), { maxDepth: 5 });
    expect(chain.cycles.length).toBeGreaterThan(0);
    expect(chain.order.length).toBeLessThan(5);
  });
});
