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

export type SkillId =
  | 'okb-setup' | 'okb-capture' | 'okb-ask' | 'okb-today' | 'okb-learn' | 'okb-meeting' | 'okb-ingest' | 'okb-garden' | 'okb-career'
  | 'okb-review' | 'okb-guide' | 'okb-skillify'
  | 'okb-dev-product' | 'okb-dev-repo' | 'okb-dev-ticket' | 'okb-dev-explain' | 'okb-dev-debug' | 'okb-dev-review' | 'okb-dev-ship' | 'okb-dev-support'
  | 'none';

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
      strong(/\b(install|installer|set ?up|configure|configurer|reconfigur)\b/i),
      strong(/\b(concept assist|aide aux concepts|niveau d['’]aide)\b/i),
      strong(/\b(profil|profile)s?\b.*\b(switch|change|changer|créer|create|new|nouveau)\b/i),
      weak(/\b(kb|vault|bundle|base)\b.*\b(path|chemin|emplacement|location)\b/i),
    ],
    negative: [/\bdoctor\b/i, /\badapter\b/i, /\b(repo|repository|dépôt|codebase)\b/i],
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
    skill: 'okb-garden',
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
    skill: 'okb-garden',
    when: 'an existing note should be rewritten in another style, level or language, without new facts',
    notWhen: 'new content from a source, a question, or rewriting code',
    positive: [
      strong(/\b(réécri[st]|réécrire|reformule[rz]?|rewrite|reword|restyle|simplifie[rz]?|vulgarise[rz]?|tradui[st]|translate)\b.*\b(note|article|fiche|page)\b/i),
      strong(/\b(plus simple(ment)?|plus clair|more simply|simpler|style (pédagogique|expert|standard))\b/i),
    ],
    negative: [/\b(this|ce|cette)\s+(code|function|fonction|pr|pull request|commit)\b/i, /\b(transcript|transcription|\.vtt|\.pdf|\.docx)\b/i],
  },
  {
    skill: 'okb-capture',
    when: 'jotting something down for later, or triaging the private inbox into notes',
    notWhen: 'a source to ingest right away, a question, or a screenshot',
    positive: [
      strong(/\b(capture[rz]?|inbox|bo[iî]te d['’]entr[ée]e|jot (this|it) down)\b/i),
      strong(/\b(trie[rz]?|vide[rz]?|triage|sort)\b.*\b(inbox|captures?)\b/i),
      weak(/\b(pour plus tard|for later|note rapide|quick note|garde[- ]moi (ça|cette idée))\b/i),
      strong(/\b(garde[- ]?(ça|le|la)|note[- ]?ça|qu['’]est[- ]ce qu['’]on garde|keep (this|that)|fais (une|la) fiche (sur|pour)|make a (card|note) (on|about))\b/i),
    ],
    negative: [/\b(capture d['’][ée]cran|screenshot|screen capture)\b/i],
  },
  {
    skill: 'okb-today',
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
      strong(/\b(cartes? (à|a) r[ée]viser|r[ée]vision (du jour|espac[ée]e)|spaced (review|repetition)|carte des comp[ée]tences|skills map|ce que je ma[iî]trise)\b/i),
    ],
    negative: [/\b(réécri|reformule|rewrite|restyle|style)\b/i, /\b(code|pull request|commit)\b/i],
  },
  {
    skill: 'okb-career',
    when: 'achievements, feedback, goals, one-on-one or annual review preparation, the CV, a portable copy of career notes, or keeping a work lesson in the person’s baggage',
    notWhen: 'project or ticket notes, or a meeting that is not about the user\'s career',
    positive: [
      strong(/\b(entretien (individuel|annuel)|one[- ]on[- ]one|1:1|annual review|revue annuelle|[ée]valuation annuelle)\b/i),
      strong(/\b(carri[eè]re|career|cv|r[ée]alisations?|achievements?|entretien)\b.{0,30}\b(pr[ée]pare|note|garde|ajoute|mets? à jour|update|add|keep)|\b(pr[ée]pare|note|garde|ajoute|mets? à jour|update|add|keep)[a-z]*\b.{0,30}\b(carri[eè]re|career|cv|r[ée]alisations?|achievements?|entretien)\b/i),
      // « Garder dans mon bagage »: a lesson learned at work, kept for life without the workplace.
      strong(/\b(dans|in|to|into) (mon|my) (bagage|baggage)\b/i),
      weak(/\b(bagage|baggage)\b/i),
      weak(/\b(feedback|retour (de|du) (mon )?manager|objectifs? de l['’]ann[ée]e|promotion|augmentation)\b/i),
      // « pour mon entretien », « for my review »: the person's own career is meant.
      weak(/\b(pour (mon|ma) (entretien|cv|bilan|[ée]valuation|revue)|for my (review|cv|resume|appraisal))\b/i),
    ],
    negative: [/\b(carri[eè]re (de|d['’]un|du) (client|joueur|produit))\b/i],
  },
  {
    skill: 'okb-meeting',
    when: 'preparing a meeting, or turning the notes of one into decisions, actions and a note',
    notWhen: 'ingesting a long transcript, a career one-on-one, or another tool\'s calendar',
    positive: [
      strong(/\b(pr[ée]pare|prepare)[a-z]*\b.{0,25}\b(r[ée]union|meeting|point|call|d[ée]mo|rendez-vous|rdv|atelier|workshop)\b/i),
      strong(/\b(mes notes|my notes)\b.{0,25}\b(de la |du |of the |from the )?(r[ée]union|meeting|call|point)\b|\b(sors|sortie|back from|retour) (de |d['’]|from )?(la |une |the |a )?(r[ée]union|meeting|call)\b/i),
      weak(/\b(ordre du jour|agenda|d[ée]cisions?|actions?)\b/i),
    ],
    negative: [/\b(transcript|transcription|\.vtt)\b/i, /\b(entretien (individuel|annuel)|one[- ]on[- ]one|1:1|annual review)\b/i],
  },
  {
    skill: 'okb-today',
    when: 'closing a work session (journal + captures), or showing and updating the current focus note',
    notWhen: 'a question from the KB, a new source or the weekly review',
    positive: [
      strong(/(^|\s)\/?done\b|\b(fin de (la )?session|on a fini|c['’]est fini pour aujourd['’]hui|wrap up|end (of )?(the )?session)\b/i),
      strong(/\b(mon|ma|my|current|du moment)\s+(focus|priorités?|priorities|objectif|objective|daily)\b|\bfocus du moment\b/i),
      strong(/\b(o[ùu] j['’]en suis|what am i on|stand[- ]?up|point du jour|rapport (de la )?semaine|weekly report)\b/i),
      weak(/\b(journal de session|session log|sur quoi je travaille|what i('| a)m working on)\b/i),
    ],
    negative: [/\b(inbox)\s+done\b/i, /\bfocus mode\b/i, /\bavec (mon |ma |le )?(okb|second cerveau)\b/i],
  },
  {
    skill: 'okb-skillify',
    when: 'turning a documented procedure or process into a Claude Code skill or slash command',
    notWhen: 'writing a KB note, ingesting a source or editing the okb plugin itself',
    positive: [
      strong(/\b(skillify|en (un )?skill|into a (claude )?skill|(crée|créer|fais|make|create)[a-z]*\s+(un |a )?(skill|slash command|commande slash))\b/i),
      weak(/\b(process|procédure|procedure|workflow)\b.*\b(skill|commande|command)\b/i),
    ],
    negative: [/\b(plugin okb|okb plugin)\b/i],
  },
  {
    skill: 'okb-dev-repo',
    when: 'discovering, joining or getting started on a code repository; refreshing its KB after the code changed',
    notWhen: 'a one-off question about some code, editing code, or creating a new repository',
    positive: [
      strong(/\b(d[ée]couvre|arrive sur|commence sur|onboard(e|ing)?[-\s]?(moi)?|prendre en main|new to|joining|starting on|get (me )?started on)\b.{0,30}\b(repo|repository|d[ée]p[ôo]t|projet|project|codebase|composant|service)\b/i),
      strong(/\b(kb|base de connaissances?|knowledge base|doc(umentation)?) (du|de ce|of (this|the)) (repo|repository|d[ée]p[ôo]t|projet|codebase)\b/i),
      weak(/\b(architecture|comment (il|ce repo) marche|how (this|the) (repo|codebase) works)\b/i),
    ],
    negative: [/\b(cr[ée]e|create|init|clone)[a-z]*\s+(un |a |le |the )?(nouveau |new )?(repo|repository|d[ée]p[ôo]t)\b/i, /\b(ticket|story|bug)\b.{0,20}\b(fini|termin|done|finished|merg)/i],
  },
  {
    skill: 'okb-dev-ticket',
    when: 'a ticket or a piece of work on a documented repository is done, or something learned about it should be kept',
    notWhen: 'writing code, reviewing a pull request, or a repository not documented yet',
    positive: [
      strong(/\b(fini|termin[ée]|boucl[ée]|livr[ée]|merg[ée]|finished|completed|done with|merged)\b.{0,20}\b(ticket|story|bug|fix|feature|issue|pr|pull request|t[âa]che)\b/i),
      strong(/\b(ticket|story|issue)\b.{0,15}\b(fini|termin[ée]|done|finished|merg)/i),
      strong(/\b(kb|base) (du|de ce|of (this|the)) (repo|repository|d[ée]p[ôo]t|projet)\b.{0,40}\b(ajoute|enrichi|mets? à jour|update|add)\b|\b(ajoute|enrichi[rs]?|mets? à jour|update|add)\b.{0,40}\b(kb|base) (du|de ce|of (this|the)) (repo|repository|d[ée]p[ôo]t|projet)\b/i),
    ],
    negative: [/\breview (this|the) (pull request|pr|code)\b/i],
  },
  {
    skill: 'okb-dev-product',
    when: 'documenting or understanding a product as a whole: features, business rules, clients, architecture diagrams, its repositories',
    notWhen: 'one repository onboarding, a ticket, or editing code',
    positive: [
      strong(/\b(documente|d[ée]cri[st]|décrire|explique|cartographie|describe|document|map)[a-z]*\b.{0,20}\b(le |la |ce |the |this |our |notre )?(produit|product)\b/i),
      strong(/\b(vue d['’]ensemble|overview|fonctionnel|fonctionnalit[ée]s|r[eè]gles? m[ée]tier|business rules?|features?)\b.{0,30}\b(du |de ce |of the |of this )(produit|product)\b/i),
      strong(/\b(diagramme? (de )?(contexte|conteneurs?)|context diagram|container diagram|c4)\b/i),
    ],
    negative: [/\b(prix|price|pricing|vendre|sell)\b/i, /\b(d[ée]couvre|onboard)[a-z]*\b.{0,20}\b(repo|repository|d[ée]p[ôo]t)\b/i],
  },
  {
    skill: 'okb-dev-explain',
    when: 'asking what a file, function, module or component of a documented repository does or how it works',
    notWhen: 'rewriting or fixing code, a whole-repository onboarding, or a general programming question',
    positive: [
      strong(/\b(explique|expliquer|explain)[a-z]*(-moi)?\b.{0,40}\b(ce fichier|cette fonction|ce code|ce module|ce composant|cette classe|ce service|this file|this function|this code|this module|this component|this class)\b/i),
      strong(/\b(comment (marche|fonctionne)|à quoi sert|que fait|what does|how does)\b.{0,30}\b(ce fichier|cette fonction|ce module|ce composant|cette classe|this file|this function|this module|this component|this class)\b/i),
      weak(/\b(je (ne )?comprends? pas|i don['’]t understand)\b.{0,30}\b(code|fichier|file|fonction|function)\b/i),
      // A piece of code named: the explanation is about the repository, not the KB alone.
      weak(/\b(fichier|fonction|module|composant|classe|file|function|component|class)\b/i),
    ],
    negative: [/\b(rewrite|r[ée][ée]cri[st]|refactor|simplifie|simplify)\b/i],
  },
  {
    skill: 'okb-dev-debug',
    when: 'an error, a failing test or a bug in a documented repository',
    notWhen: 'a general programming question, editing a note, or a debug setting',
    positive: [
      strong(/\b(d[ée]bugg?u?e?r?|debug(ging)?|d[ée]boguer)\b/i),
      strong(/\b(stack ?trace|traceback|TypeError|ReferenceError|NullPointerException|Exception in|segfault)\b/i),
      weak(/\b(plante|crash(es)?|échoue|failing|fails|erreur|error)\b/i),
    ],
    negative: [/\b(mode debug|debug mode|debug level|niveau de debug)\b/i, /\bdoctor\b/i],
  },
  {
    skill: 'okb-dev-review',
    when: 'checking the user\'s own changes before a pull request, against the team\'s rules from the KB',
    notWhen: 'an OKB proposal, someone else\'s pull request unasked, or rewriting code',
    positive: [
      strong(/\b(pr[ée]-?revue|pre-?review)\b/i),
      strong(/\b(relis|relire|review|v[ée]rifie|check)[a-z]*\b.{0,30}\b(mes changements|mon code|ma branche|mon diff|my changes|my branch|my diff|my code)\b/i),
      strong(/\b(avant (de |d['’])?(pousser|push|ouvrir|cr[ée]er|faire) (la |une |ma )?(pr|pull request|merge request|mr))\b|\bbefore (i )?(push|open(ing)?|creat(e|ing)) (the |a |my )?(pr|pull request)\b/i),
      weak(/\b(r[eè]gles? d['’][ée]quipe|team rules?)\b/i),
    ],
    negative: [/\b(proposition|proposal)\b/i, /\b(r[ée][ée]cri[st]|rewrite)\b/i],
  },
  {
    skill: 'okb-dev-ship',
    when: 'drafting a commit message or a pull request description, or opening the pull request',
    notWhen: 'reviewing the changes or writing a KB note',
    positive: [
      strong(/\b(r[ée]dige|[ée]cri[st]|pr[ée]pare|write|draft|prepare|g[ée]n[èe]re|generate)[a-z]*\b.{0,30}\b(message de commit|commit message|description (de |of )?(la |the )?(pr|pull request|mr|merge request)|pr description|pull request description|mon commit|my commit)\b/i),
      strong(/\b(ouvre|open|cr[ée]e|create)[a-z]*\b.{0,15}\b(la |une |ma |the |a |my )(pr|pull request|merge request)\b/i),
      weak(/\b(commit|squash)\b/i),
    ],
    negative: [/\b(weekly|sprint)\b/i, /\b(relis|review|revue)\b/i],
  },
  {
    skill: 'okb-dev-support',
    when: 'a support case, a client incident or a client\'s problem on a documented product, or the reply to send',
    notWhen: 'a development ticket, debugging local code without a case, or sending on the user\'s behalf',
    positive: [
      strong(/\b(cas (de )?support|ticket (de )?support|support (case|ticket)|incident (client|de prod|en prod|in production)|(un |le |a |the )?(client|customer) (signale|remonte|a un probl[eè]me|reports?|complains?))\b/i),
      strong(/\b(r[ée]ponds?|r[ée]pondre|r[ée]ponse|reply|answer)\b.{0,25}\b(au client|à la cliente|to the customer|to the client)\b/i),
      weak(/\b(servicenow|zendesk|helpdesk|service desk)\b/i),
    ],
    negative: [/\b(supporte[- ]t[- ](il|elle)|does it support|support (de|for) (la )?(langue|language))\b/i],
  },
  {
    skill: 'okb-guide',
    when: 'asking what OKB can do, how to use it or where things stand',
    notWhen: 'a precise task another OKB skill handles',
    positive: [
      strong(/\b(o[ùu] (j['’]en suis|en est)|que (peut faire|fait)|comment (marche|fonctionne|utiliser)|aide)\b.{0,30}\b(okb|second cerveau)\b/i),
      strong(/\b(what can okb do|how (do i|to) use okb|okb (help|status|menu))\b/i),
    ],
    negative: [/\b(install|installer|configure[rz]?)\b/i],
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

  // A skill may have several rules (a merged workflow): it counts once, with its best rule.
  const bySkill = new Map<SkillId, { skill: SkillId; score: number; matched: string[] }>();
  for (const s of scores) if (!bySkill.has(s.skill) || bySkill.get(s.skill)!.score < s.score) bySkill.set(s.skill, s);
  const ranked = [...bySkill.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best || best.score < DECISION_THRESHOLD) {
    return { skill: 'none', score: best?.score ?? 0, matched: best?.matched ?? [], suppressed };
  }
  if (runnerUp && runnerUp.score === best.score) {
    return { skill: 'none', score: best.score, matched: best.matched, suppressed };
  }
  return { skill: best.skill, score: best.score, matched: best.matched, suppressed };
}
