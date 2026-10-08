import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { estimateTranslation, proposeTranslation, purgeTranslations, segments, translateNote } from '../src/translate/translate.js';
import { asBundlePath } from '../src/util/paths.js';
import { demoBrain } from './helpers/brain.js';

const NOTE = [
  '---', 'type: Guide', 'title: Livrer une version', 'description: Comment livrer une version sans casse.', 'status: stable',
  'generated:', '  by: human:test', '  at: 2026-09-01T10:00:00Z', 'x_okb:', '  brain:', '    type: procedure', '---', '',
  '# Livrer une version', '',
  '## En bref', '', 'On livre le mardi, après les tests, avec la [checklist](../Checklist.md).', '',
  '## Étapes', '', '1. Lancer `npm test` sur la branche.', '2. Vérifier le tableau de bord.', '',
  '```mermaid', 'flowchart LR', '  A[Tests] --> B[Livraison]', '```', '',
  '> « On ne livre jamais un vendredi. » — l’équipe', '',
  '## Pièges', '', 'Ne pas oublier la migration de la base[^1].', '', '[^1]: Voir le ticket ABC-12.', '',
].join('\n');

async function brain(env: Record<string, string> = {}) {
  const b = await demoBrain();
  const path = '3 Boîte à outils/Méthodes/Livrer une version.md';
  await mkdir(resolve(b.kb, '3 Boîte à outils', 'Méthodes'), { recursive: true });
  await writeFile(resolve(b.kb, path), NOTE);
  const e = { ...b.env, OKB_AI: 'fake', ...env };
  return { ...b, env: e, path: asBundlePath(path) };
}

describe('cutting a note for translation', () => {
  it('keeps code, diagrams, quotes and footnotes as they are', () => {
    const segs = segments(NOTE.split('---\n').slice(2).join('---\n'));
    const kept = segs.filter((s) => s.kind === 'keep').map((s) => s.text).join('\n');
    expect(kept).toContain('```mermaid');
    expect(kept).toContain('> « On ne livre jamais un vendredi. »');
    expect(kept).toContain('[^1]: Voir le ticket ABC-12.');
    const text = segs.filter((s) => s.kind === 'text').map((s) => s.text).join('\n');
    expect(text).toContain('On livre le mardi');
    expect(text).not.toContain('flowchart');
  });

  it('a note without headings is one section; a note of code only has nothing to translate', () => {
    expect(new Set(segments('Une phrase.\n\nUne autre.').map((s) => s.section)).size).toBe(1);
    expect(segments('```\ncode\n```').filter((s) => s.kind === 'text' && s.text.trim())).toEqual([]);
  });
});

describe('translating a note on demand', () => {
  it('translates « En bref » first, and the second time comes from the cache', async () => {
    const { config, path, env } = await brain();
    const first = await translateNote(config, path, 'en', 'brief', env);
    expect(first.translated).toBeGreaterThan(0);
    expect(first.markdown).toContain('[fake] On livre le mardi');
    expect(first.markdown).not.toContain('Lancer');
    const again = await translateNote(config, path, 'en', 'brief', env);
    expect(again.translated).toBe(0);
    expect(again.cached).toBeGreaterThan(0);
    expect(again.tokens).toBe(0);
  }, 60_000);

  it('translates the whole note, keeping link targets, code and quotes', async () => {
    const { config, path, env } = await brain();
    const r = await translateNote(config, path, 'en', 'full', env);
    expect(r.markdown).toContain('](../Checklist.md)');
    expect(r.markdown).toContain('`npm test`');
    expect(r.markdown).toContain('flowchart LR');
    expect(r.markdown).toContain('> « On ne livre jamais un vendredi. »');
    expect(r.markdown).toContain('[^1]');
    expect(r.markdown).toMatch(/^## \[fake\] Étapes/m);
  }, 60_000);

  it('translates again only the section that changed', async () => {
    const { config, path, env, kb } = await brain();
    await translateNote(config, path, 'en', 'full', env);
    await writeFile(resolve(kb, path), NOTE.replace('Ne pas oublier la migration', 'Ne jamais oublier la migration'));
    const r = await translateNote(config, path, 'en', 'full', env);
    expect(r.translated).toBe(1);
    expect(r.cached).toBeGreaterThan(1);
  }, 60_000);

  it('tells the cost before, and refuses beyond the daily budget without calling the AI', async () => {
    const { config, path, env, dir } = await brain();
    const estimate = await estimateTranslation(config, path, 'en', 'full', env);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(estimate.toTranslate).toBeGreaterThan(0);
    await writeFile(resolve(dir, 'home', 'config.yaml'), `${await readFile(resolve(dir, 'home', 'config.yaml'), 'utf8')}\nbudget:\n  daily: 1\n`);
    await expect(translateNote(config, path, 'en', 'full', env)).rejects.toMatchObject({ key: 'budgetExceeded' });
  }, 60_000);

  it('refuses a 🔒 note unless the person confirmed it', async () => {
    const { config, path, env, kb } = await brain();
    await writeFile(resolve(kb, path), NOTE.replace("x_okb:\n", 'x_okb:\n  confidentiality: secret\n'));
    await expect(translateNote(config, path, 'en', 'brief', env)).rejects.toMatchObject({ key: 'translateSecret' });
    expect((await translateNote(config, path, 'en', 'brief', env, { confirmSecret: true })).translated).toBeGreaterThan(0);
  }, 60_000);

  it('refuses the language the note is already written in', async () => {
    const { config, path, env } = await brain();
    await expect(translateNote(config, path, 'fr', 'brief', env)).rejects.toMatchObject({ key: 'translateSameLanguage' });
  }, 60_000);

  it('forgets translations nobody read for 30 days', async () => {
    const { config, path, env, dir } = await brain();
    await translateNote(config, path, 'en', 'brief', env);
    await translateNote(config, path, 'de', 'brief', env);
    const find = async (d: string): Promise<string[]> => (await readdir(d, { recursive: true })).filter((f) => String(f).includes('translations') && String(f).endsWith('.json')).map((f) => resolve(d, String(f)));
    const files = await find(resolve(config.stateHome));
    expect(files).toHaveLength(2);
    const old = files.find((f) => f.endsWith('.de.json'))!;
    const raw = JSON.parse(await readFile(old, 'utf8'));
    raw.lastRead = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await writeFile(old, JSON.stringify(raw));
    expect(await purgeTranslations(config)).toBe(1);
    expect(await find(resolve(config.stateHome))).toHaveLength(1);
  }, 60_000);

  it('« save as a note » prepares a proposal, and writes nothing in the KB', async () => {
    const { config, path, env, kb } = await brain();
    await translateNote(config, path, 'en', 'full', env);
    const proposal = await proposeTranslation(config, path, 'en');
    const target = proposal.changes[0]!.path;
    expect(target).toMatch(/ \(EN\)\.md$/);
    expect((await loadBundleFor(config)).byPath.has(target)).toBe(false);
    expect((await readdir(resolve(kb, '3 Boîte à outils', 'Méthodes'))).filter((f) => f.includes('(EN)'))).toEqual([]);
  }, 60_000);
});

describe('translation, from the terminal and the web app', () => {
  it('okb translate shows « En bref » in English, then the cost of the whole note', async () => {
    const { json } = await import('./helpers/team.js');
    const { env, dir } = await brain();
    const brief = await json(['translate', 'Livrer une version', '--to', 'en'], env, dir);
    expect(brief).toMatchObject({ ok: true, scope: 'brief' });
    expect(brief.markdown).toContain('[fake]');
    const estimate = await json(['translate', 'Livrer une version', '--to', 'en', '--full', '--estimate'], env, dir);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(estimate.toTranslate).toBeGreaterThan(0);
  }, 60_000);

  it('the web app translates with the session token, and renders the result', async () => {
    const { serve } = await import('../src/web/serve.js');
    const { config, env, path } = await brain();
    const { server, url } = await serve(config, { port: 0, env });
    try {
      const token = ((await (await fetch(`${url}/api/session`)).json()) as { token: string }).token;
      const body = JSON.stringify({ path, lang: 'en', scope: 'brief' });
      expect((await fetch(`${url}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status).toBe(403);
      const r = (await (await fetch(`${url}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body })).json()) as { ok: boolean; html: string };
      expect(r.ok).toBe(true);
      expect(r.html).toContain('[fake]');
      const est = (await (await fetch(`${url}/api/translate/estimate?path=${encodeURIComponent(path)}&lang=en&scope=full`)).json()) as { tokens: number };
      expect(est.tokens).toBeGreaterThan(0);
    } finally {
      server.closeAllConnections(); server.close();
    }
  }, 60_000);
});

describe('a failed or partial AI answer (review I1)', () => {
  /** A stand-in for the Anthropic API answering what we decide. */
  async function stub(reply: (prompt: string) => { text: string; stop?: string }) {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += String(c); });
      req.on('end', () => {
        const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[0]!.content;
        const r = reply(prompt);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: r.text }], stop_reason: r.stop ?? 'end_turn', usage: { input_tokens: 50, output_tokens: 60 } }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    return { server, env: { OKB_AI: '', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, PATH: '/nonexistent' } };
  }

  it('an answer with no translated block is an error, and nothing is cached', async () => {
    const { server, env } = await stub(() => ({ text: 'I am sorry, I cannot help with that.' }));
    try {
      const b = await brain(env);
      await expect(translateNote(b.config, b.path, 'en', 'brief', b.env)).rejects.toMatchObject({ key: 'aiFailed' });
      const again = await estimateTranslation(b.config, b.path, 'en', 'brief', b.env);
      expect(again.toTranslate).toBeGreaterThan(0);
    } finally { server.close(); }
  }, 60_000);

  it('an answer cut short is an error', async () => {
    const { server, env } = await stub((p) => ({ text: p.split('\n').slice(0, 2).join('\n'), stop: 'max_tokens' }));
    try {
      const b = await brain(env);
      await expect(translateNote(b.config, b.path, 'en', 'full', b.env)).rejects.toMatchObject({ key: 'aiFailed' });
    } finally { server.close(); }
  }, 60_000);

  it('only the blocks that came back are kept; the others are tried again next time', async () => {
    let calls = 0;
    // First answer: only the title and description; second: everything.
    const { server, env } = await stub((p) => {
      calls++;
      const blocks = p.split(/^(<<<\d+>>>)$/m);
      const out: string[] = [];
      for (let i = 1; i < blocks.length; i += 2) {
        if (calls === 1 && i > 3) break;
        out.push(blocks[i]!, `EN ${blocks[i + 1]!.trim()}`);
      }
      return { text: out.join('\n') };
    });
    try {
      const b = await brain(env);
      const first = await translateNote(b.config, b.path, 'en', 'brief', b.env);
      expect(first.translated).toBe(0);
      expect(first.failed).toBeGreaterThan(0);
      expect(first.title).toBe('EN Livrer une version');
      const second = await translateNote(b.config, b.path, 'en', 'brief', b.env);
      expect(second.translated).toBe(1);
      expect(second.markdown).toContain('EN ');
    } finally { server.close(); }
  }, 60_000);
});

describe('saving the translation of a 🔒 note (review I2)', () => {
  it('keeps the note confidential', async () => {
    const { config, path, env, kb } = await brain();
    await writeFile(resolve(kb, path), NOTE.replace("x_okb:\n", 'x_okb:\n  confidentiality: secret\n'));
    await translateNote(config, path, 'en', 'full', env, { confirmSecret: true });
    const proposal = await proposeTranslation(config, path, 'en');
    const { materializeFile } = await import('../src/proposal/materialize.js');
    const content = materializeFile(proposal.changes[0]!.path, null, proposal.changes);
    expect(content).toMatch(/confidentiality: secret/);
  }, 60_000);
});
