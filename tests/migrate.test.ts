import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBundle } from '../src/kb/bundle.js';
import { checkLinks } from '../src/links/check.js';
import { grantApproval } from '../src/apply/approval.js';
import { applyMigration, planMigration, rollbackMigration } from '../src/migrate/migrate.js';
import { buildNavigation } from '../src/nav/nav.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

const LEGACY = `---
type: Runbook
title: Legacy note
description: Written with the old link conventions.
status: draft
generated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }
---

Absolute: [Dispatcher](/concepts/dispatcher.md).
No extension: [Idempotence](../concepts/idempotence).
Wikilink: [[Telemetry channel]].
Ambiguous wikilink: [[Agent]].
Unknown wikilink: [[Nothing here]].
External stays: [spec](https://example.org/spec).

\`\`\`md
This fenced [link](/concepts/dispatcher.md) is quoted material.
\`\`\`
`;

async function legacySandbox() {
  const s = await makeSandbox({ profileId: 'alpha' });
  sandboxes.push(s);
  await mkdir(resolve(s.vault, 'legacy'), { recursive: true });
  await writeFile(resolve(s.vault, 'legacy', 'old-note.md'), LEGACY);
  await writeFile(
    resolve(s.vault, 'concepts', 'agent-runtime.md'),
    '---\ntype: Concept\ntitle: Agent\ndescription: A process.\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\n---\n\nA runtime agent.\n',
  );
  await writeFile(
    resolve(s.vault, 'concepts', 'agent-person.md'),
    '---\ntype: Concept\ntitle: Agent\ndescription: A person.\nstatus: stable\ngenerated: { by: "human:testuser", at: 2026-01-01T00:00:00Z }\n---\n\nA support agent.\n',
  );
  return { s, config: await s.config() };
}

describe('migration', () => {
  it('is a dry run until asked otherwise', async () => {
    const { s, config } = await legacySandbox();
    const before = await readFile(resolve(s.vault, 'legacy', 'old-note.md'), 'utf8');

    const plan = await planMigration(config, 'portable-links');
    expect(plan.edits.length).toBeGreaterThan(0);
    expect(await readFile(resolve(s.vault, 'legacy', 'old-note.md'), 'utf8')).toBe(before);
  });

  it('converts what it can and refuses to guess the rest', async () => {
    const { config } = await legacySandbox();
    const plan = await planMigration(config, 'portable-links');

    expect(plan.edits).toContainEqual(
      expect.objectContaining({ before: '/concepts/dispatcher.md', after: '../concepts/dispatcher.md' }),
    );
    expect(plan.edits).toContainEqual(
      expect.objectContaining({ before: '../concepts/idempotence', after: '../concepts/idempotence.md' }),
    );
    expect(plan.edits).toContainEqual(
      expect.objectContaining({
        before: '[[Telemetry channel]]',
        after: '[Telemetry channel](../concepts/telemetry-channel.md)',
      }),
    );

    const manualUrls = plan.manual.map((m) => m.url);
    expect(manualUrls).toContain('[[Agent]]');
    expect(manualUrls).toContain('[[Nothing here]]');
    expect(plan.manual.find((m) => m.url === '[[Agent]]')?.why).toContain('matches 2 documents');
  });

  it('leaves external links and fenced code untouched', async () => {
    const { s, config } = await legacySandbox();
    const plan = await planMigration(config, 'portable-links');
    await grantApproval(config, plan.proposal, plan.proposal.changes.map(c => c.id), 'human:testuser');
    await applyMigration(config, plan);

    const after = await readFile(resolve(s.vault, 'legacy', 'old-note.md'), 'utf8');
    expect(after).toContain('[spec](https://example.org/spec)');
    expect(after).toContain('This fenced [link](/concepts/dispatcher.md) is quoted material.');
  });

  it('is reversible from its receipt', async () => {
    const { s, config } = await legacySandbox();
    const path = resolve(s.vault, 'legacy', 'old-note.md');
    const before = await readFile(path, 'utf8');

    const plan = await planMigration(config, 'portable-links');
    await grantApproval(config, plan.proposal, plan.proposal.changes.map(c => c.id), 'human:testuser');
    const receipt = await applyMigration(config, plan);
    expect(await readFile(path, 'utf8')).not.toBe(before);

    const restored = await rollbackMigration(config, receipt.id);
    expect(restored).toContain('legacy/old-note.md');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('reduces the number of non-portable links it set out to fix', async () => {
    const { config } = await legacySandbox();
    const countForbidden = async () => {
      const bundle = await loadBundle(config.kb.root);
      return checkLinks(bundle.snapshot).issues.filter((i) => i.code === 'LINK_FORBIDDEN_FORM').length;
    };

    const before = await countForbidden();
    const plan = await planMigration(config, 'portable-links');
    await grantApproval(config, plan.proposal, plan.proposal.changes.map(c => c.id), 'human:testuser');
    await applyMigration(config, plan);
    expect(await countForbidden()).toBeLessThan(before);
  });

  it('rejects an unknown migration by name', async () => {
    const { config } = await legacySandbox();
    await expect(planMigration(config, 'whatever' as never)).rejects.toMatchObject({
      code: 'E_UNSUPPORTED',
    });
  });
});

describe('navigation', () => {
  it('builds folder indexes and a home page with portable links only', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const config = await s.config();

    const files = await buildNavigation(config);
    const concepts = files.find((f) => f.path === 'concepts/index.md')!;
    expect(concepts.content).toContain('* [Dispatcher](dispatcher.md)');
    expect(concepts.content.startsWith('---')).toBe(false);

    const home = files.find((f) => f.path === 'index.md')!;
    expect(home.content).toContain('okf_version: "0.2"');
    expect(home.content).toContain('(architecture/fleet-overview.md)');
    expect(home.content).toContain('*(draft)*');
  });

  it('reports whether an index is missing, outdated or already current', async () => {
    const s = await makeSandbox({ profileId: 'alpha' });
    sandboxes.push(s);
    const config = await s.config();

    const first = await buildNavigation(config);
    expect(first.find((f) => f.path === 'concepts/index.md')!.status).toBe('missing');
    expect(first.find((f) => f.path === 'index.md')!.status).toBe('outdated');

    for (const file of first) {
      await writeFile(resolve(s.vault, file.path), file.content);
    }
    const second = await buildNavigation(config);
    expect(second.every((f) => f.status === 'current')).toBe(true);
  });
});
