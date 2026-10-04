import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTING_RULES, route, type SkillId } from '../src/routing/table.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const PLUGIN = resolve(TEST_ROOT, '..', 'plugin');

/**
 * These cases describe the product's documented routing contract. They verify the
 * reference selector, not Claude's own skill selection — Claude routes on the
 * `description` frontmatter, which the last test in this file checks separately.
 */
const CASES: readonly { request: string; expect: SkillId; why: string }[] = [
  // positive
  { request: 'Install okb and point it at my notes folder', expect: 'okb-setup', why: 'explicit install' },
  { request: "Je veux changer le niveau d'aide aux concepts", expect: 'okb-setup', why: 'assist level' },
  { request: 'Ingest meeting-2026-01.vtt into the fleet notes', expect: 'okb-ingest', why: 'source file' },
  { request: 'Voici le compte-rendu de la réunion, ajoute-le à ma KB', expect: 'okb-ingest', why: 'transcript into kb' },
  { request: 'What does my knowledge base say about idempotence?', expect: 'okb-ask', why: 'question against the kb' },
  { request: 'Retrouve la note où on parle du dispatcher', expect: 'okb-ask', why: 'find a note' },
  { request: 'Show me the diff of proposal a1b2c3 and apply only the article', expect: 'okb-review', why: 'existing proposal' },
  { request: 'Annule la dernière application', expect: 'okb-review', why: 'rollback' },
  { request: 'Trouve les liens cassés dans ma base', expect: 'okb-maintain', why: 'link audit' },
  { request: 'I want to rename a note, will the links survive?', expect: 'okb-maintain', why: 'move with inbound links' },
  { request: "Réécris la fiche sur le dispatcher plus simplement, avec une analogie", expect: 'okb-revise', why: 'restyle one note' },
  { request: 'Rewrite my note about retries in the expert style', expect: 'okb-revise', why: 'restyle in another preset' },
  { request: "Capture cette idée pour plus tard : relier les fiches aux procédures", expect: 'okb-inbox', why: 'quick capture' },
  { request: 'Help me triage my inbox', expect: 'okb-inbox', why: 'inbox triage' },
  { request: 'On fait la revue de la semaine de mon second cerveau ?', expect: 'okb-weekly', why: 'weekly ritual' },
  { request: "Interroge-moi sur la fiche idempotence", expect: 'okb-learn', why: 'active recall' },
  { request: "On a fini pour aujourd'hui, fais le /done", expect: 'okb-focus', why: 'end of session' },
  { request: 'Mets à jour mon focus : je prépare le sprint Carina', expect: 'okb-focus', why: 'update the focus note' },
  { request: 'Transforme cette procédure de déploiement en skill', expect: 'okb-skillify', why: 'procedure to skill' },
  { request: "Où j'en suis avec mon second cerveau ?", expect: 'okb-guide', why: 'dashboard' },

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
    const skills = await readdir(resolve(PLUGIN, 'skills'));
    expect(skills.sort()).toEqual(
      ROUTING_RULES.map((r) => r.skill).sort(),
    );

    for (const command of await readdir(resolve(PLUGIN, 'commands'))) {
      const text = await readFile(resolve(PLUGIN, 'commands', command), 'utf8');
      const body = text.split('---').slice(2).join('---');
      // A command delegates; it must not restate a procedure.
      expect(body.split('\n').filter((l) => l.trim()).length).toBeLessThan(12);
      if (command !== 'doctor.md') {
        expect(body).toMatch(/okb-(setup|ingest|ask|review|maintain|revise|inbox|weekly|learn|focus|skillify|guide)` skill/);
      }
    }
  });

  it('gives every skill a description that states when to use it and when not to', async () => {
    for (const skill of await readdir(resolve(PLUGIN, 'skills'))) {
      const text = await readFile(resolve(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8');
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
    for (const agent of await readdir(resolve(PLUGIN, 'agents'))) {
      const text = await readFile(resolve(PLUGIN, 'agents', agent), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      expect(frontmatter).toMatch(/^tools: .+$/m);
      expect(frontmatter).not.toMatch(/\bWrite\b|\bEdit\b/);
      expect(text).toMatch(/# Output/);
      expect(text).toMatch(/```json/);
    }
  });
});
