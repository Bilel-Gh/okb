/**
 * Note templates. A template fixes the *sections* a kind of note has, their
 * order, their headings and what belongs in each; the writing style decides how
 * the prose inside them reads. Every note produced through a dossier names its
 * template, so a reader finds the same landmarks in every note of the same kind.
 *
 * Headings are owned by the template (one wording per language), which is what
 * keeps a bundle navigable after hundreds of imports. Anything that fits no role
 * goes into a free section with its own heading.
 */
export type Localized = { readonly fr: string; readonly en: string };

export type TemplateSection = {
  readonly role: string;
  readonly emoji: string;
  readonly heading: Localized;
  readonly required: boolean;
  /** What goes here: read by Claude before writing, shown by `okb template show`. */
  readonly guide: Localized;
};

export type NoteTemplate = {
  readonly id: string;
  /** OKF `type` written in the frontmatter of notes created from this template. */
  readonly okfType: string;
  /** Suggested folder, relative to the bundle root. */
  readonly folder: string;
  readonly label: Localized;
  readonly when: Localized;
  readonly sections: readonly TemplateSection[];
  /** Advice that applies to the whole note. */
  readonly tips: readonly Localized[];
};

const s = (role: string, emoji: string, fr: string, en: string, required: boolean, guideFr: string, guideEn: string): TemplateSection => ({
  role, emoji, heading: { fr, en }, required, guide: { fr: guideFr, en: guideEn },
});

export const BUILTIN_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: 'guide',
    okfType: 'Guide',
    folder: 'guides',
    label: { fr: 'Guide : expliquer un sujet', en: 'Guide: explain a topic' },
    when: {
      fr: 'Comprendre un système, un flux ou un mécanisme et savoir où regarder.',
      en: 'Understand a system, flow or mechanism and know where to look.',
    },
    sections: [
      s('purpose', '🎯', 'À quoi ça sert', 'What it is for', true,
        'Le problème résolu et quand s’en servir, en 2 à 4 phrases simples. Commence par une aide `explanation` ; ajoute une analogie si elle éclaire vraiment.',
        'The problem it solves and when to use it, in 2–4 plain sentences. Open with an `explanation` aid; add an analogy only if it truly helps.'),
      s('how', '🔍', 'Comment ça marche', 'How it works', true,
        'Le mécanisme, du plus simple au plus détaillé, une affirmation sourcée par idée. Un schéma Mermaid dès qu’il y a un flux ou plusieurs acteurs.',
        'The mechanism from simple to detailed, one sourced claim per idea. A Mermaid diagram as soon as there is a flow or several actors.'),
      s('example', '💡', 'Exemple concret', 'Concrete example', false,
        'Un cas réel tiré de la source ou du projet, avec les noms exacts (fichier, commande, écran) ; une aide `example` reliée aux affirmations.',
        'A real case from the source or the project, with exact names (file, command, screen); an `example` aid tied to the claims.'),
      s('where', '🗂️', 'Où regarder', 'Where to look', false,
        'Les fichiers, symboles, commandes ou documents qui implémentent ou décrivent le sujet, chacun avec ce qu’on y trouve.',
        'Files, symbols, commands or documents that implement or describe the topic, each with what you find there.'),
      s('limits', '🚧', 'Limites et pièges', 'Limits and pitfalls', false,
        'Ce qui ne marche pas, ce qui est partiel ou incertain, les confusions fréquentes.',
        'What does not work, what is partial or uncertain, frequent confusions.'),
    ],
    tips: [
      { fr: 'Les sections libres (sans rôle) ajoutent des sous-sujets entre ces repères, avec leur propre titre.', en: 'Free sections (no role) add subtopics between these landmarks, with their own heading.' },
    ],
  },
  {
    id: 'concept',
    okfType: 'Concept',
    folder: 'concepts',
    label: { fr: 'Concept : une notion expliquée simplement', en: 'Concept: one notion explained simply' },
    when: {
      fr: 'Un terme revient et le lecteur doit pouvoir le comprendre en une minute. Écrit dans le tableau `concepts` du dossier.',
      en: 'A term keeps coming up and a reader must grasp it in a minute. Written in the dossier `concepts` array.',
    },
    sections: [
      s('definition', '🎯', 'En une phrase', 'In one sentence', true,
        'Le champ `definition` : ce que c’est, en mots simples, sans répéter le terme. Pas de développement d’acronyme inventé.',
        'The `definition` field: what it is, in plain words, without repeating the term. No invented acronym expansion.'),
      s('analogy', '🧭', 'Pour se le représenter', 'Picture it', false,
        'Une aide `analogy` tirée de la vie quotidienne, avec `limits` : où la comparaison cesse d’être vraie.',
        'An everyday `analogy` aid with `limits`: where the comparison stops being true.'),
      s('how', '🔍', 'Comment ça marche', 'How it works', false,
        'Deux à quatre affirmations sourcées sur le fonctionnement ou le rôle, dans une section `how` du concept.',
        'Two to four sourced claims about how it works or what it is for, in a `how` section of the concept.'),
      s('example', '💡', 'Exemple', 'Example', false,
        'Une aide `example` : un cas concret du projet ou de la source.',
        'An `example` aid: a concrete case from the project or the source.'),
      s('diagram', '🗺️', 'Schéma', 'Diagram', false,
        'Une aide `diagram` Mermaid (≤ 8 nœuds) si une relation se comprend mieux dessinée.',
        'A Mermaid `diagram` aid (≤ 8 nodes) when a relation reads better drawn.'),
      s('pitfalls', '⚠️', 'À ne pas confondre', 'Do not confuse with', false,
        'Affirmations sourcées sur les confusions fréquentes et les limites, dans une section `pitfalls`.',
        'Sourced claims about frequent confusions and limits, in a `pitfalls` section.'),
      s('source', '📌', 'Ce que dit la source', 'What the source says', true,
        'Rempli par okb : les extraits exacts qui soutiennent la définition.',
        'Filled by okb: the exact excerpts that back the definition.'),
    ],
    tips: [
      { fr: 'Ajoute des `aliases` (pluriel, traduction, abréviation) : ils servent aux liens automatiques et à la recherche.', en: 'Add `aliases` (plural, translation, abbreviation): they drive automatic links and search.' },
    ],
  },
  {
    id: 'procedure',
    okfType: 'Runbook',
    folder: 'procedures',
    label: { fr: 'Procédure : faire une tâche pas à pas', en: 'Procedure: do a task step by step' },
    when: {
      fr: 'Une tâche se refait : déployer, configurer, diagnostiquer, livrer.',
      en: 'A task is repeated: deploy, configure, diagnose, release.',
    },
    sections: [
      s('purpose', '🎯', 'Quand l’utiliser', 'When to use it', true,
        'La situation de départ et le résultat attendu, en une ou deux phrases.',
        'Starting situation and expected result, in one or two sentences.'),
      s('prerequisites', '✅', 'Avant de commencer', 'Before you start', false,
        'Droits, outils, versions et informations à avoir sous la main.',
        'Rights, tools, versions and information to have at hand.'),
      s('steps', '🪜', 'Étapes', 'Steps', true,
        'Une affirmation par étape, dans l’ordre ; une étape = une action vérifiable ; commandes et noms exacts entre accents graves.',
        'One claim per step, in order; one step = one checkable action; commands and exact names in backticks.'),
      s('verify', '🔎', 'Vérifier le résultat', 'Check the result', false,
        'Comment savoir que ça a marché : ce qu’on doit voir.',
        'How to know it worked: what you should see.'),
      s('troubleshoot', '🧯', 'Si ça ne marche pas', 'If it does not work', false,
        'Erreurs connues, leur cause et quoi faire.',
        'Known errors, their cause and what to do.'),
    ],
    tips: [
      { fr: 'Ne recopie pas une étape non confirmée par la source : mets-la dans les questions ouvertes.', en: 'Do not copy a step the source does not confirm: put it in open questions.' },
    ],
  },
  {
    id: 'experience',
    okfType: 'Experience',
    folder: 'experiences',
    label: { fr: 'Retour d’expérience : un problème résolu', en: 'Experience: a solved problem' },
    when: {
      fr: 'Un incident ou un bug a été résolu et pourrait se reproduire.',
      en: 'An incident or bug was solved and could happen again.',
    },
    sections: [
      s('context', '🧩', 'Contexte', 'Context', true,
        'Système, version, environnement, date, et ce qui était attendu.',
        'System, version, environment, date, and what was expected.'),
      s('symptoms', '🚨', 'Symptômes', 'Symptoms', false,
        'Ce qu’on a observé ; messages d’erreur exacts entre accents graves.',
        'What was observed; exact error messages in backticks.'),
      s('diagnosis', '🔍', 'Diagnostic', 'Diagnosis', false,
        'Les étapes suivies et les hypothèses testées, dans l’ordre.',
        'Steps followed and hypotheses tested, in order.'),
      s('rejected', '🚫', 'Pistes écartées', 'Ruled out', false,
        'Ce qui a été essayé sans succès, et pourquoi : cela évite de refaire le chemin.',
        'What was tried without success, and why: it saves walking the same path.'),
      s('resolution', '✅', 'Résolution', 'Resolution', true,
        'Ce qui a réglé le problème, avec la preuve que c’est réglé.',
        'What fixed it, with the evidence that it is fixed.'),
      s('lessons', '💡', 'À retenir', 'Lessons', true,
        'Ce qui se généralise, séparé de ce qui est propre à ce cas.',
        'What generalises, kept apart from what is specific to this case.'),
      s('applicability', '🎯', 'Quand réutiliser ce retour', 'When this applies again', false,
        'Les conditions où ce cas s’applique, et celles où il ne s’applique pas.',
        'Conditions where this case applies, and where it does not.'),
    ],
    tips: [
      { fr: 'Une observation unique n’est pas une règle : marque `inferred` ce qui est généralisé.', en: 'One observation is not a rule: mark generalisations `inferred`.' },
    ],
  },
  {
    id: 'decision',
    okfType: 'Decision',
    folder: 'decisions',
    label: { fr: 'Décision : un choix et ses raisons', en: 'Decision: a choice and its reasons' },
    when: {
      fr: 'Un choix d’architecture, d’outil ou d’organisation a été fait et doit rester compréhensible.',
      en: 'An architecture, tooling or organisation choice was made and must stay understandable.',
    },
    sections: [
      s('context', '🧭', 'Contexte', 'Context', true,
        'Le problème et les contraintes au moment du choix.',
        'The problem and constraints at the time.'),
      s('options', '⚖️', 'Options envisagées', 'Options considered', false,
        'Chaque option avec son principal avantage et son principal défaut.',
        'Each option with its main strength and main weakness.'),
      s('decision', '✅', 'Décision', 'Decision', true,
        'Ce qui a été choisi, par qui si la source le dit, et pourquoi.',
        'What was chosen, by whom if the source says so, and why.'),
      s('consequences', '📌', 'Conséquences', 'Consequences', false,
        'Ce que ça change, y compris les coûts acceptés.',
        'What it changes, including accepted costs.'),
      s('review', '🔁', 'Quand y revenir', 'When to revisit', false,
        'Le signal qui justifierait de réexaminer ce choix.',
        'The signal that would justify revisiting the choice.'),
    ],
    tips: [],
  },
  {
    id: 'meeting',
    okfType: 'Meeting',
    folder: 'reunions',
    label: { fr: 'Réunion : l’essentiel d’un échange', en: 'Meeting: the essentials of a discussion' },
    when: {
      fr: 'Un transcript ou un compte rendu de réunion, de démo ou de transfert de connaissances.',
      en: 'A transcript or minutes of a meeting, demo or knowledge transfer.',
    },
    sections: [
      s('summary', '🎯', 'L’essentiel', 'Key points', true,
        'Les 3 à 5 points à retenir si tu ne lis que ça, avec l’orateur quand il compte.',
        'The 3–5 points to keep if you read nothing else, with the speaker when it matters.'),
      s('decisions', '✅', 'Décisions', 'Decisions', false,
        'Ce qui a été décidé ; une correction tardive l’emporte sur l’affirmation initiale.',
        'What was decided; a late correction wins over the first statement.'),
      s('actions', '📋', 'Actions', 'Actions', false,
        'Qui fait quoi et pour quand, seulement si la source le dit.',
        'Who does what by when, only if the source says so.'),
      s('topics', '🗂️', 'Sujets abordés', 'Topics', false,
        'Les explications utiles, regroupées par sujet plutôt que dans l’ordre chronologique.',
        'Useful explanations grouped by topic rather than chronologically.'),
    ],
    tips: [
      { fr: 'Les notions nouvelles deviennent des fiches concepts ; les procédures expliquées méritent leur propre note.', en: 'New notions become concept cards; explained procedures deserve their own note.' },
    ],
  },
];
