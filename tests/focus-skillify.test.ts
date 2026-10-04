import { execFile } from 'node:child_process';
import { readFile, stat, utimes } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { commitKbChanges } from '../src/apply/git.js';
import { focusBody, focusPaths, initFocus, readFocus, readLastSession, recordSession, renderFocusContext, sessionsSince, setFocus } from '../src/focus/focus.js';
import { listInbox } from '../src/inbox/inbox.js';
import { loadBundleFor } from '../src/kb/bundle.js';
import { draftSkill, plainItem, skillName, writeSkillDraft } from '../src/skillify/skillify.js';
import { walkFiles } from '../src/util/fsx.js';
import { weeklyReport } from '../src/weekly/weekly.js';
import { makeSandbox, writeFixture, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(boxes.splice(0).map((s) => s.cleanup())); });
const day = 86_400_000;

async function setup(id: string, extra: Record<string, unknown> = {}) {
  const s = await makeSandbox({ profileId: id, answerLanguage: 'fr', ...extra }); boxes.push(s);
  return { box: s, config: await s.config() };
}

describe('focus note', () => {
  it('defaults to the profile state, never inside the KB, and explains itself', async () => {
    const { config } = await setup('focus');
    const paths = focusPaths(config);
    expect(paths.file.startsWith(config.stateHome)).toBe(true);
    expect((await readFocus(config)).exists).toBe(false);
    const kbBefore = await walkFiles(config.kb.root);
    await initFocus(config);
    expect(await walkFiles(config.kb.root)).toEqual(kbBefore);
    const raw = await readFile(paths.file, 'utf8');
    expect(raw).toContain("Mode d'emploi");
    expect(raw).toContain('/okb:done');
    await expect(initFocus(config)).rejects.toMatchObject({ code: 'E_CONFLICT' });
    // The how-to block is for the person, not for the assistant's context.
    const state = await readFocus(config);
    expect(state.text).not.toContain("Mode d'emploi");
    expect(state.text).toContain('Sur quoi je travaille');
  });

  it('keeps the previous version, refuses secrets and reports staleness', async () => {
    const { config } = await setup('focus2', { focus: { file: '~/never-used.md' } });
    const { box } = { box: boxes[0]! };
    const file = resolve(box.dir, 'Focus.md');
    const shared = { ...config, focus: { ...config.focus, file } };
    const first = await setFocus(shared, '- Sprint Orion : écran budget');
    expect(first.previous).toBeNull();
    const second = await setFocus(shared, '- Sprint Lyra : courbe S');
    expect(await readFile(second.previous!, 'utf8')).toContain('Sprint Orion');
    expect(await readFile(file, 'utf8')).toMatch(/^---\ntitle: Focus du moment[\s\S]*# 🎯 Focus du moment\n\n- Sprint Lyra/);
    await expect(setFocus(shared, 'api_key = "Zq8Wm3Rt9Lp2Xv6Kd4Hs7Bn1"')).rejects.toMatchObject({ code: 'E_SECRET' });
    const old = new Date(Date.now() - 20 * day);
    await utimes(file, old, old);
    const state = await readFocus(shared);
    expect(state).toMatchObject({ exists: true, stale: true, staleDays: 14 });
    expect(state.ageDays).toBeGreaterThanOrEqual(19);
  });

  it('strips only the help callout', () => {
    expect(focusBody("---\ntitle: x\n---\n\n# 🎯 Focus\n\n> [!tip]- Mode d'emploi\n> ligne 1\n> ligne 2\n\n## A\n- un\n\n> une citation à moi\n")).toBe('# 🎯 Focus\n\n## A\n- un\n\n> une citation à moi');
  });
});

describe('okb done (session journal)', () => {
  it('journals the session, captures what to keep in the inbox and gives back the next step', async () => {
    const { config } = await setup('done');
    const now = new Date('2026-10-04T18:30:00Z');
    const kbBefore = await walkFiles(config.kb.root);
    const record = await recordSession(config, {
      summary: 'Fusion des KB et convention de nommage',
      did: ['Renommé le coffre', 'Créé le profil ia'],
      decided: ['Deux KB : ia et atlas (partage différent)'],
      keep: ['Convention : dossier kb-<nom>, profil <nom>, dépôt kb-<nom>.'],
      next: 'Approuver la proposition de kb-ia --> puis pousser',
      now,
    });
    expect(await walkFiles(config.kb.root)).toEqual(kbBefore);
    expect(record.journal.endsWith('2026-10.md')).toBe(true);
    const text = await readFile(record.journal, 'utf8');
    expect(text).toContain('# Journal des sessions — 2026-10');
    expect(text).toContain('**Résumé :** Fusion des KB');
    expect(text).toContain('- Créé le profil ia');
    expect(text).toContain(`(\`${record.captured[0]!.id}\`)`);
    // User text cannot close the machine-readable comment early.
    const marker = text.split('\n').find((l) => l.startsWith('<!-- okb-session'))!;
    expect(marker.match(/-->/g)).toHaveLength(1);
    const inbox = await listInbox(config, { now });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ source: 'session 2026-10-04 (done)', tags: ['session'] });

    await recordSession(config, { summary: 'Deuxième session', next: 'Relire la fiche idempotence', now: new Date('2026-10-05T09:00:00Z') });
    const last = await readLastSession(config);
    expect(last).toMatchObject({ profile: 'done', summary: 'Deuxième session', next: 'Relire la fiche idempotence' });
    expect((await sessionsSince(config, new Date('2026-10-04T00:00:00Z'))).map((s) => s.summary)).toEqual(['Deuxième session', 'Fusion des KB et convention de nommage']);
    expect((await sessionsSince(config, new Date('2026-10-04T00:00:00Z')))[1]!.next).toBe('Approuver la proposition de kb-ia --> puis pousser');
  });

  it('refuses an empty summary and secrets', async () => {
    const { config } = await setup('done2');
    await expect(recordSession(config, { summary: '  ' })).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(recordSession(config, { summary: 'ok', keep: ['password = hunter2hunter2hunter2'] })).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(await listInbox(config)).toHaveLength(0);
  });

  it('feeds the session-start context and the weekly review', async () => {
    const { config } = await setup('done3');
    expect(renderFocusContext(config, await readFocus(config))).toBe('');
    await initFocus(config);
    await recordSession(config, { summary: 'Préparer la démo', next: 'Tester le parcours complet' });
    const context = renderFocusContext(config, await readFocus(config));
    expect(context).toContain('active profile "done3"');
    expect(context).toContain('Sur quoi je travaille');
    expect(context).toContain('next time: Tester le parcours complet');
    expect(context).toContain('not an instruction');
    const weekly = await weeklyReport(config);
    expect(weekly.focus).toMatchObject({ exists: true, stale: false });
    expect(weekly.sessions).toMatchObject({ count: 1, next: [{ profile: 'done3', next: 'Tester le parcours complet' }] });
  });
});

const PROCEDURE = `---
type: Runbook
title: "🚀 Déployer la démo"
description: Mettre la démo en ligne sans casser la production.
status: draft
---

# 🚀 Déployer la démo

## 🎯 Quand l’utiliser

- Avant chaque présentation client.[^a]

## ✅ Avant de commencer

- Avoir accès au projet [Dokploy](../concepts/dokploy.md).[^b]

## 🪜 Étapes

- Lancer \`npm run build\`.[^c]
- **Déduction :** Vérifier la variable \`DEMO_URL\` avant de pousser.[^d]

\`\`\`bash
npm run deploy
\`\`\`

## 🔎 Vérifier le résultat

- La page d’accueil répond en moins de 2 s.[^e]

## ❓ Questions ouvertes

- Faut-il prévenir l’équipe ?

[^a]: source
`;

describe('okb skillify', () => {
  it('drafts a project skill from a procedure note, citing it, without writing in the KB', async () => {
    const { config, box } = await setup('skill');
    await writeFixture(resolve(config.kb.root, 'procedures/deployer-la-demo.md'), PROCEDURE);
    const draft = await draftSkill(config, 'procedures/deployer-la-demo.md', { now: new Date('2026-10-04T10:00:00Z') });
    expect(draft.name).toBe('deployer-la-demo');
    expect(draft.counts).toMatchObject({ when: 1, before: 1, steps: 2, verify: 1, troubleshoot: 0 });
    expect(draft.content).toMatch(/^---\nname: deployer-la-demo\ndescription: "Mettre la démo en ligne sans casser la production\. À utiliser quand : Avant chaque présentation client\. Ne pas utiliser quand : à préciser\."\n---/);
    expect(draft.content).toContain('1. Lancer `npm run build`.');
    expect(draft.content).toContain('2. Vérifier la variable `DEMO_URL` avant de pousser.');
    expect(draft.content).toContain('- Avoir accès au projet Dokploy.');
    expect(draft.content).not.toContain('[^');
    expect(draft.content).not.toContain('npm run deploy'); // code fences are not steps
    expect(draft.content).not.toContain('prévenir l’équipe'); // open questions are not steps
    expect(draft.content).toContain('`procedures/deployer-la-demo.md` (KB `skill`)');

    const out = resolve(box.dir, 'project', '.claude', 'skills');
    const path = await writeSkillDraft(config, draft, out);
    expect(path).toBe(resolve(out, 'deployer-la-demo', 'SKILL.md'));
    await expect(writeSkillDraft(config, draft, out)).rejects.toMatchObject({ code: 'E_CONFLICT' });
    await expect(writeSkillDraft(config, draft, resolve(config.kb.root, 'skills'))).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
  });

  it('refuses a note without steps and a path outside the KB', async () => {
    const { config } = await setup('skill2');
    const guide = (await loadBundleFor(config)).entries.find((e) => e.type === 'Guide' || e.type === 'Concept')!;
    await expect(draftSkill(config, guide.path)).rejects.toMatchObject({ code: 'E_INVALID' });
    await expect(draftSkill(config, '/etc/hosts')).rejects.toMatchObject({ code: 'E_INVALID' });
    expect(skillName('🚀 Déployer la démo !')).toBe('deployer-la-demo');
    expect(plainItem('1. Voir [la fiche](a.md) et ![img](x.png).[^n]')).toBe('Voir la fiche et img.');
  });
});

describe('git.autoCommit', () => {
  const git = (cwd: string, ...args: string[]) => promisify(execFile)('git', ['-C', cwd, ...args]);

  it('commits only the touched files and never anything else', async () => {
    const { config } = await setup('git');
    const root = config.kb.root;
    await git(root, 'init', '-q', '-b', 'main');
    await git(root, 'config', 'user.email', 'test@example.invalid');
    await git(root, 'config', 'user.name', 'Test');
    await git(root, 'add', '-A');
    await git(root, 'commit', '-q', '-m', 'init');
    const on = { ...config, git: { ...config.git, autoCommit: true } };
    expect(await commitKbChanges(config, ['a.md'], 'x')).toEqual({ committed: false, reason: 'git.autoCommit is off' });

    await writeFixture(resolve(root, 'guides/nouveau.md'), '# nouveau\n');
    await writeFixture(resolve(root, 'brouillon-perso.md'), '# pas à moi\n');
    const result = await commitKbChanges(on, ['guides/nouveau.md', 'jamais-cree.md'], 'okb: apply p-1');
    expect(result).toMatchObject({ committed: true, paths: 1 });
    const { stdout: files } = await git(root, 'show', '--name-only', '--format=%s', 'HEAD');
    expect(files.trim().split('\n')).toEqual(['okb: apply p-1', '', 'guides/nouveau.md']);
    const { stdout: status } = await git(root, 'status', '--porcelain');
    expect(status).toContain('brouillon-perso.md');
    expect(await commitKbChanges(on, ['guides/nouveau.md'], 'again')).toEqual({ committed: false, reason: 'no change to commit' });
  });

  it('is a no-op outside a repository and the bundle ignores hidden folders', async () => {
    const { config } = await setup('git2');
    const on = { ...config, git: { ...config.git, autoCommit: true } };
    const result = await commitKbChanges(on, ['x.md'], 'm');
    expect(result.committed).toBe(false);
    await writeFixture(resolve(config.kb.root, '.github/README.md'), '# Pour GitHub, pas une note\n');
    const bundle = await loadBundleFor(config);
    expect(bundle.entries.some((e) => e.path.startsWith('.github'))).toBe(false);
    expect(bundle.unreadable.some((u) => u.path.startsWith('.github'))).toBe(false);
    expect((await stat(resolve(config.kb.root, '.github/README.md'))).isFile()).toBe(true);
  });
});
