import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';
import { findSecrets } from '../src/security/secrets.js';
import { proposeFiles } from '../src/proposal/files.js';
import { saveProposal } from '../src/proposal/store.js';
import { validatePlannedFiles } from '../src/proposal/validate.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { maintain } from '../src/maintain/maintain.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(boxes.splice(0).map(s => s.cleanup())); });

// Fictitious values assembled at runtime so this file never contains a real-looking key.
const fakeOpenAi = ['sk', 'proj', 'Q7vR2mT9kL4pX8wZ1nB5cH3jD6fG0sA'].join('-');
const fakeGithub = 'ghp' + '_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const fakeAws = 'AKIA' + 'Q3J7Z2M5K8W1R4T6';
const note = (body: string) => `---\ntype: Guide\ntitle: Clés\ndescription: Une note fictive.\nstatus: draft\n---\n\n# Clés\n\n${body}\n`;

describe('credential detection', () => {
  it('finds known token formats and never echoes them', () => {
    const text = `Ligne 1\nexport OPENAI_API_KEY=${fakeOpenAi}\ntoken ${fakeGithub}\n${fakeAws}`;
    const found = findSecrets(text);
    expect(found.map(f => f.kind)).toEqual(['api-key', 'github-token', 'aws-access-key']);
    expect(found.map(f => f.line)).toEqual([2, 3, 4]);
    const serialized = JSON.stringify(found);
    for (const secret of [fakeOpenAi, fakeGithub, fakeAws]) expect(serialized).not.toContain(secret);
  });

  it('detects explicit assignments and credentials in URLs', () => {
    expect(findSecrets('client_secret: "Zk81-pQr4-Lm22-Xy90"')[0]?.kind).toBe('assigned-secret');
    expect(findSecrets('DATABASE_URL=postgres://app:Xk29fj3kLq7@db.example.net/app')[0]?.kind).toBe('url-credentials');
  });

  it('lets placeholders, environment references and prose through', () => {
    const benign = [
      'OPENAI_API_KEY=<ta-clé>', 'api_key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'secret: process.env.NEXTAUTH_SECRET',
      'password: ${DB_PASSWORD}', 'DATABASE_URL=postgres://user:password@localhost/db',
      'Un token est la plus petite unité de texte lue par le modèle.', 'max_tokens = 4096',
      'sha256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    ];
    for (const line of benign) expect(findSecrets(line), line).toEqual([]);
  });
});

describe('secret guard', () => {
  it('refuses to save a proposal that would write a credential, with a masked message', async () => {
    const s = await makeSandbox({ profileId: 'secrets' }); boxes.push(s);
    const config = await s.config();
    const proposal = proposeFiles(config, await loadBundleFor(config), new Map([['notes/cles.md', note(`La clé : ${fakeGithub}`)]]), 'test');
    const error = await saveProposal(config, proposal).then(() => null, (e: unknown) => e as { code: string; message: string; hint: string });
    expect(error?.code).toBe('E_SECRET');
    expect(error?.message).toContain('github-token');
    expect(error?.message).not.toContain(fakeGithub);
    expect(error?.hint).toContain('<API_KEY>');
  });

  it('re-checks materialized files at apply time but tolerates a secret already present before', async () => {
    const s = await makeSandbox({ profileId: 'secrets-apply' }); boxes.push(s);
    const config = await s.config();
    await expect(validatePlannedFiles(config, new Map([['notes/a.md', { before: null, after: note(`clé ${fakeAws}`) }]])))
      .rejects.toMatchObject({ code: 'E_SECRET' });
    const legacy = note(`clé ${fakeAws}`);
    await expect(validatePlannedFiles(config, new Map([['notes/a.md', { before: legacy, after: legacy.replace('Clés', 'Clés, suite') }]])))
      .resolves.toBeUndefined();
  });

  it('reports a hand-written secret in maintain without leaking it', async () => {
    const s = await makeSandbox({ profileId: 'secrets-maintain' }); boxes.push(s);
    const config = await s.config();
    await writeFixture(resolve(config.kb.root, 'notes/main.md'), note(`Accès : ${fakeOpenAi}`));
    const report = await maintain(config);
    const issue = report.issues.find(i => i.code === 'SECRET_IN_NOTE');
    expect(issue).toMatchObject({ level: 'error', path: 'notes/main.md' });
    expect(JSON.stringify(report)).not.toContain(fakeOpenAi);
  });
});
