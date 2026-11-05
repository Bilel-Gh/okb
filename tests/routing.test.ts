import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTING_RULES, route, type SkillId } from '../src/routing/table.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const PLUGIN = resolve(TEST_ROOT, '..', 'plugin');
const PLUGINS = [PLUGIN, resolve(TEST_ROOT, '..', 'plugins', 'okb-dev')];
async function allSkills(): Promise<string[]> { return (await Promise.all(PLUGINS.map((p) => readdir(resolve(p, 'skills'))))).flat(); }
async function skillDir(skill: string): Promise<string> { for (const p of PLUGINS) if ((await readdir(resolve(p, 'skills'))).includes(skill)) return resolve(p, 'skills', skill); throw new Error(skill); }

/**
 * These cases describe the product's documented routing contract. They verify the
 * reference selector, not Claude's own skill selection — Claude routes on the
 * `description` frontmatter, which the last test in this file checks separately.
 */
const CASES: readonly { request: string; expect: SkillId; why: string }[] = [
  // positive
  { request: 'Reprends le ticket ORD-42 commencé hors OKB', expect: 'okb-dev-ticket', why: 'resume existing work' },
  { request: 'Je commence le ticket ORD-43', expect: 'okb-dev-ticket', why: 'new ticket' },
  { request: 'Resume ticket ORD-44 from this branch', expect: 'okb-dev-ticket', why: 'resume ticket (en)' },
  { request: 'Install okb and point it at my notes folder', expect: 'okb-setup', why: 'explicit install' },
  { request: "Je veux changer le niveau d'aide aux concepts", expect: 'okb-setup', why: 'assist level' },
  { request: 'Ingest meeting-2026-01.vtt into the fleet notes', expect: 'okb-ingest', why: 'source file' },
  { request: 'Voici le compte-rendu de la réunion, ajoute-le à ma KB', expect: 'okb-ingest', why: 'transcript into kb' },
  { request: 'What does my knowledge base say about idempotence?', expect: 'okb-ask', why: 'question against the kb' },
  { request: 'Retrouve la note où on parle du dispatcher', expect: 'okb-ask', why: 'find a note' },
  { request: 'Show me the diff of proposal a1b2c3 and apply only the article', expect: 'okb-review', why: 'existing proposal' },
  { request: 'Annule la dernière application', expect: 'okb-review', why: 'rollback' },
  { request: 'Trouve les liens cassés dans ma base', expect: 'okb-garden', why: 'link audit' },
  { request: 'I want to rename a note, will the links survive?', expect: 'okb-garden', why: 'move with inbound links' },
  { request: "Réécris la fiche sur le dispatcher plus simplement, avec une analogie", expect: 'okb-garden', why: 'restyle one note' },
  { request: 'Rewrite my note about retries in the expert style', expect: 'okb-garden', why: 'restyle in another preset' },
  { request: "Capture cette idée pour plus tard : relier les fiches aux procédures", expect: 'okb-capture', why: 'quick capture' },
  { request: 'Help me triage my inbox', expect: 'okb-capture', why: 'inbox triage' },
  { request: 'Garde ça dans mon cerveau', expect: 'okb-capture', why: 'keep an explanation' },
  { request: 'Fais une fiche sur OData', expect: 'okb-capture', why: 'a concept card' },
  { request: 'Prépare mon daily', expect: 'okb-today', why: 'daily stand-up' },
  { request: 'On fait la revue de la semaine de mon second cerveau ?', expect: 'okb-today', why: 'weekly ritual' },
  { request: "Interroge-moi sur la fiche idempotence", expect: 'okb-learn', why: 'active recall' },
  { request: "On a fini pour aujourd'hui, fais le /done", expect: 'okb-today', why: 'end of session' },
  { request: 'Mets à jour mon focus : je prépare le sprint Orion', expect: 'okb-today', why: 'update the focus note' },
  { request: 'Transforme cette procédure de déploiement en skill', expect: 'okb-skillify', why: 'procedure to skill' },
  { request: "Où j'en suis avec mon second cerveau ?", expect: 'okb-guide', why: 'dashboard' },
  { request: 'Je découvre ce repo, aide-moi à démarrer dessus', expect: 'okb-dev-repo', why: 'repository onboarding' },
  { request: "I'm new to this codebase, get me started on this repo", expect: 'okb-dev-repo', why: 'repository onboarding (en)' },
  { request: "J'ai fini mon ticket, ajoute ce qu'on a appris à la KB du repo", expect: 'okb-dev-ticket', why: 'after a ticket' },
  { request: 'Prépare mon entretien annuel avec mon manager', expect: 'okb-career', why: 'annual review' },
  { request: "Garde ça pour mon entretien : j'ai réduit les erreurs d'export de 30 %", expect: 'okb-career', why: 'an achievement to keep' },
  { request: 'Mets à jour mon CV avec mes réalisations de cette année', expect: 'okb-career', why: 'living CV' },
  { request: 'Garde cette méthode dans mon bagage', expect: 'okb-career', why: 'a work lesson kept for life' },
  { request: 'Keep this lesson in my baggage, without the client’s name', expect: 'okb-career', why: 'a work lesson kept for life' },
  { request: 'Prépare ma réunion de demain avec l’équipe produit', expect: 'okb-meeting', why: 'meeting preparation' },
  { request: 'Voilà mes notes de la réunion de ce matin, fais le tri', expect: 'okb-meeting', why: 'after a meeting' },
  { request: 'Fais-moi ma révision du jour', expect: 'okb-learn', why: 'daily spaced review' },
  { request: 'Montre-moi la carte des compétences', expect: 'okb-learn', why: 'skills map' },
  { request: 'Quelle est la carrière du client Dupont dans notre outil ?', expect: 'none', why: 'not the user career' },
  { request: 'Crée un nouveau repo GitHub pour ce projet', expect: 'none', why: 'creating a repository is not onboarding' },
  { request: 'Documente le produit Atlas : ses fonctionnalités et son architecture', expect: 'okb-dev-product', why: 'a product as a whole' },
  { request: 'Fais le diagramme de contexte de notre plateforme', expect: 'okb-dev-product', why: 'context diagram' },
  { request: 'Explique-moi ce fichier, je ne vois pas à quoi il sert', expect: 'okb-dev-explain', why: 'explain a file' },
  { request: 'How does this module handle retries?', expect: 'okb-dev-explain', why: 'explain a module (en)' },
  { request: "J'ai une stack trace TypeError au démarrage, aide-moi à débugger", expect: 'okb-dev-debug', why: 'an error to debug' },
  { request: 'Help me debug this failing test', expect: 'okb-dev-debug', why: 'a failing test' },
  { request: 'Relis mes changements avant que j’ouvre la PR', expect: 'okb-dev-review', why: 'pre-review' },
  { request: 'Check my branch against the team rules before I push the PR', expect: 'okb-dev-review', why: 'pre-review (en)' },
  { request: 'Rédige le message de commit pour ces changements', expect: 'okb-dev-ship', why: 'commit message' },
  { request: 'Write the pull request description and open the PR', expect: 'okb-dev-ship', why: 'PR description' },
  { request: 'Un client remonte que ses factures sont en double depuis hier', expect: 'okb-dev-support', why: 'client incident' },
  { request: 'Prépare la réponse au client pour ce ticket de support', expect: 'okb-dev-support', why: 'reply to a client' },
  { request: 'Est-ce que Node supporte-t-il les modules ES ?', expect: 'none', why: 'support as a verb, not a case' },
  { request: 'Active le mode debug de mon éditeur', expect: 'none', why: 'a debug setting, not a bug' },
  { request: 'Simplifie cette fonction pour la rendre plus lisible', expect: 'none', why: 'a rewrite, not an explanation' },

  // negative — the skill must stay out of the way
  { request: 'Just summarise this article for me, do not save anything', expect: 'none', why: 'summary only' },
  { request: 'Review this pull request', expect: 'none', why: 'code review, not a proposal' },
  { request: 'How does this repository build its TypeScript?', expect: 'none', why: 'code question' },
  { request: 'What is the capital of Portugal?', expect: 'none', why: 'general knowledge' },
  { request: 'Rewrite this function so it is simpler to read', expect: 'none', why: 'code rewrite, not a note' },
  { request: 'okb doctor says an adapter failed, what now?', expect: 'none', why: 'installation diagnosis, handled by the doctor command' },
  { request: "Fais une capture d'écran de la page d'accueil", expect: 'none', why: 'screenshot, not a capture' },
  { request: 'Prepare the sprint weekly for the team PR', expect: 'none', why: 'team sprint, not the second brain review' },
  { request: 'Turn on focus mode in my editor', expect: 'none', why: 'editor setting, not the focus note' },

  // ambiguous — a question is better than a guess
  { request: 'Can you look at my notes and fix them?', expect: 'none', why: 'retrieve or audit, unclear' },
];

describe('routing contract', () => {
  for (const testCase of CASES) {
    it(`${testCase.expect} ← "${testCase.request}" (${testCase.why})`, () => {
      expect(route(testCase.request).skill).toBe(testCase.expect);
    });
  }

  it('covers every skill with at least one positive and one negative case', () => {
    for (const rule of ROUTING_RULES) {
      expect(CASES.some((c) => c.expect === rule.skill)).toBe(true);
      expect(rule.negative.length).toBeGreaterThan(0);
    }
    expect(CASES.filter((c) => c.expect === 'none').length).toBeGreaterThanOrEqual(5);
  });
});

describe('plugin descriptions', () => {
  it('ships one skill per routing rule, and no workflow duplicated as a command body', async () => {
    const skills = await allSkills();
    expect(skills.sort()).toEqual(
      [...new Set(ROUTING_RULES.map((r) => r.skill))].sort(),
    );

    for (const [dir, command] of (await Promise.all(PLUGINS.map(async (p) => (await readdir(resolve(p, 'commands'))).map((c) => [p, c] as const)))).flat()) {
      const text = await readFile(resolve(dir, 'commands', command), 'utf8');
      const body = text.split('---').slice(2).join('---');
      // A command delegates; it must not restate a procedure.
      expect(body.split('\n').filter((l) => l.trim()).length).toBeLessThan(12);
      // doctor and the scribe's per-conversation switch (D77) run one okb command, not a workflow.
      if (!['doctor.md', 'off.md', 'on.md'].includes(command)) {
        expect(body).toMatch(/okb-(setup|capture|ask|today|learn|meeting|ingest|garden|career|review|guide|skillify|dev-[a-z]+)` skill/);
      }
    }
  });

  it('gives every skill a description that states when to use it and when not to', async () => {
    for (const skill of await allSkills()) {
      const text = await readFile(resolve(await skillDir(skill), 'SKILL.md'), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      expect(frontmatter).toContain(`name: ${skill}`);
      expect(frontmatter).toMatch(/Use when/);
      expect(frontmatter).toMatch(/Do not use/);
      // Descriptions are always resident: keep them short enough to stay cheap.
      const description = /description:\s*([\s\S]*?)\n[a-z-]+:/.exec(`${frontmatter}\nend:`)?.[1] ?? '';
      expect(description.length).toBeLessThan(700);
    }
  });

  it('declares agents with a bounded tool set and an explicit output contract', async () => {
    for (const [dir, agent] of (await Promise.all(PLUGINS.map(async (p) => (await readdir(resolve(p, 'agents'))).map((a) => [p, a] as const)))).flat()) {
      const text = await readFile(resolve(dir, 'agents', agent), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      expect(frontmatter).toMatch(/^tools: .+$/m);
      expect(frontmatter).not.toMatch(/\bWrite\b|\bEdit\b/);
      expect(text).toMatch(/# Output/);
      expect(text).toMatch(/```json/);
    }
  });
});
