/**
 * Reference routing table.
 *
 * This is the product's *documented* contract for which capability handles which
 * request, and the deterministic selector below is what the test suite checks.
 * It is not a model: Claude selects skills from their `description` frontmatter.
 * The table exists so that (a) those descriptions are written against something
 * explicit, and (b) a regression in them shows up in a test diff rather than in a
 * session.
 */

export type SkillId = 'okb-setup' | 'okb-ingest' | 'okb-ask' | 'okb-review' | 'okb-maintain' | 'okb-revise' | 'okb-inbox' | 'okb-weekly' | 'okb-learn' | 'none';

export type Signal = { readonly re: RegExp; readonly weight: 1 | 2 };

export type RoutingRule = {
  readonly skill: SkillId;
  readonly when: string;
  readonly notWhen: string;
  readonly positive: readonly Signal[];
  readonly negative: readonly RegExp[];
};

const strong = (re: RegExp): Signal => ({ re, weight: 2 });
const weak = (re: RegExp): Signal => ({ re, weight: 1 });

/** Below this, the request is ambiguous and deserves a question, not a guess. */
export const DECISION_THRESHOLD = 2;

export const ROUTING_RULES: readonly RoutingRule[] = [
  {
    skill: 'okb-setup',
    when: 'installing, reconfiguring, switching profile, moving the bundle, changing the assist level',
    notWhen: 'adding content, retrieving content, diagnosing an installation failure',
    positive: [
      strong(/\b(install|installer|set ?up|configure|configurer|reconfigur|onboard)\b/i),
      strong(/\b(concept assist|aide aux concepts|niveau d['’]aide)\b/i),
      strong(/\b(profil|profile)s?\b.*\b(switch|change|changer|créer|create|new|nouveau)\b/i),
      weak(/\b(kb|vault|bundle|base)\b.*\b(path|chemin|emplacement|location)\b/i),
    ],
    negative: [/\bdoctor\b/i, /\badapter\b/i],
  },
  {
    skill: 'okb-ingest',
    when: 'a source (transcript, document, article, URL) should end up in the bundle',
    notWhen: 'the user only wants a summary in chat, or is asking a question',
    positive: [
      strong(/\.(vtt|markdown|txt|pdf|docx|html?)\b/i),
      strong(/\b(ingest|ingère|intègre|intégrer|importe|importer)\b/i),
      strong(/\bajoute[rz]?[-\s]?(le|la|les|ça|ceci|cela)?\s*(à|dans)\s*(ma|mon|la|le)\s*(kb|base|vault)\b/i),
      strong(/\badd (this|it|these)\b.*\b(to|into)\b.*\b(kb|knowledge base|vault|notes)\b/i),
      weak(/\b(transcript|transcription|compte[-\s]rendu|réunion|meeting notes|recording)\b/i),
      weak(/\bfrom this (article|page|document|link|lien)\b/i),
    ],
    negative: [
      /\b(just|juste|only|seulement)\s+(summaris|summariz|résum)/i,
      /\b(do ?n[o']?t|ne pas|sans)\s+(save|store|add|écrire|ajouter|enregistrer)/i,
    ],
  },
  {
    skill: 'okb-ask',
    when: 'a question whose answer should come from the bundle',
    notWhen: 'general world knowledge, or questions about the code of the open repository',
    positive: [
      strong(/\b(retrouve|retrouver|find (the |my )?notes?|where is .*(note|doc))\b/i),
      strong(/\b(what does|how does|qu['’]est[-\s]ce que|c['’]est quoi|comment (ça )?march)/i),
      strong(/\bselon (ma|la) (kb|base)\b/i),
      weak(/\b(my|ma|mes|mon)\s+(kb|notes?|knowledge base|base de connaissances?)\b/i),
    ],
    negative: [/\b(this|ce|cette)\s+(repo|repository|codebase|dépôt|code)\b/i],
  },
  {
    skill: 'okb-review',
    when: 'a proposal already exists and must be seen, partially accepted, applied or rolled back',
    notWhen: 'no proposal has been prepared yet',
    positive: [
      strong(/\b(proposal|proposition)\b/i),
      strong(/\b(diff|apply|applique[rz]?|appliquer|rollback|annule[rz]?|annuler|revert)\b/i),
      weak(/\b(accept|accepte[rz]?|refuse[rz]?|refuser|garde[rz]? (que|seulement))\b/i),
    ],
    negative: [/\breview (this|the) (pull request|pr|code|diff of the repo)\b/i],
  },
  {
    skill: 'okb-maintain',
    when: 'auditing the bundle, finding broken links, moving or renaming notes',
    notWhen: 'diagnosing the okb installation itself',
    positive: [
      strong(/\b(broken links?|liens? cass[ée]s?|orphan|orphelin|audit|incoh[ée]renc|inconsistenc)/i),
      strong(/\b(rename|renomme[rz]?|move|déplace[rz]?)\b.*\b(note|doc|file|fichier|page)\b/i),
      weak(/\b(health|santé|état)\b.*\b(kb|base|vault|bundle)\b/i),
    ],
    negative: [/\b(install|installation|doctor|adapter|dependenc|dépendance)/i],
  },
  {
    skill: 'okb-revise',
    when: 'an existing note should be rewritten in another style, level or language, without new facts',
    notWhen: 'new content from a source, a question, or rewriting code',
    positive: [
      strong(/\b(réécri[st]|réécrire|reformule[rz]?|rewrite|reword|restyle|simplifie[rz]?|vulgarise[rz]?|tradui[st]|translate)\b.*\b(note|article|fiche|page)\b/i),
      strong(/\b(plus simple(ment)?|plus clair|more simply|simpler|style (pédagogique|expert|standard))\b/i),
    ],
    negative: [/\b(this|ce|cette)\s+(code|function|fonction|pr|pull request|commit)\b/i, /\b(transcript|transcription|\.vtt|\.pdf|\.docx)\b/i],
  },
  {
    skill: 'okb-inbox',
    when: 'jotting something down for later, or triaging the private inbox into notes',
    notWhen: 'a source to ingest right away, a question, or a screenshot',
    positive: [
      strong(/\b(capture[rz]?|inbox|bo[iî]te d['’]entr[ée]e|jot (this|it) down)\b/i),
      strong(/\b(trie[rz]?|vide[rz]?|triage|sort)\b.*\b(inbox|captures?)\b/i),
      weak(/\b(pour plus tard|for later|note rapide|quick note|garde[- ]moi (ça|cette idée))\b/i),
    ],
    negative: [/\b(capture d['’][ée]cran|screenshot|screen capture)\b/i],
  },
  {
    skill: 'okb-weekly',
    when: 'the periodic review of the second brain: inbox, waiting proposals, notes to re-read, maintenance',
    notWhen: 'a one-off audit, a single question or a new source',
    positive: [
      strong(/\b(weekly( review)?|revue (de la |de ma )?semaine|revue hebdo(madaire)?)\b/i),
      weak(/\b(bilan|point|récap)\b.*\b(semaine|week)\b/i),
    ],
    negative: [/\b(sprint|pull request|pr)\b/i],
  },
  {
    skill: 'okb-learn',
    when: 'revising or being quizzed on notes or concepts from the bundle',
    notWhen: 'adding content, rewriting a note, or a one-off factual question',
    positive: [
      strong(/\b(quiz|interroge[- ]moi|teste[- ]moi|quiz me|test me|flashcards?)\b/i),
      strong(/\b(révise[rz]?|réviser|revise my notes|memori[sz]e|mémorise[rz]?)\b/i),
      weak(/\b(apprendre|learn|retenir|retain)\b/i),
    ],
    negative: [/\b(réécri|reformule|rewrite|restyle|style)\b/i, /\b(code|pull request|commit)\b/i],
  },
];

export type RoutingDecision = {
  readonly skill: SkillId;
  readonly score: number;
  readonly matched: readonly string[];
  readonly suppressed: readonly SkillId[];
};

/**
 * Deterministic reference selector.
 *
 * A negative pattern suppresses its own skill outright — that is how "must not
 * trigger" is expressed. A tie, or a score made only of weak signals, resolves to
 * `none`: an ambiguous request deserves a question.
 */
export function route(request: string): RoutingDecision {
  const scores: { skill: SkillId; score: number; matched: string[] }[] = [];
  const suppressed: SkillId[] = [];

  for (const rule of ROUTING_RULES) {
    if (rule.negative.some((re) => re.test(request))) {
      suppressed.push(rule.skill);
      continue;
    }
    const hits = rule.positive.filter((s) => s.re.test(request));
    if (hits.length === 0) continue;
    scores.push({
      skill: rule.skill,
      score: hits.reduce((a, s) => a + s.weight, 0),
      matched: hits.map((s) => String(s.re)),
    });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const runnerUp = scores[1];

  if (!best || best.score < DECISION_THRESHOLD) {
    return { skill: 'none', score: best?.score ?? 0, matched: best?.matched ?? [], suppressed };
  }
  if (runnerUp && runnerUp.score === best.score) {
    return { skill: 'none', score: best.score, matched: best.matched, suppressed };
  }
  return { skill: best.skill, score: best.score, matched: best.matched, suppressed };
}
