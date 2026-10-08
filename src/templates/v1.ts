import type { Localized, NoteTemplate, TemplateSection } from './builtin.js';

/**
 * Note templates added in OKB 1.0, one per kind of note a brain holds (see
 * src/brain/types.ts). Every one opens with « En bref » (the 30-second read),
 * says what goes in each section and what a good note of its kind checks
 * (`checks`, the grid the quality reviewer applies). A perfect example of the
 * most used ones lives in templates/examples/ (`okb template show <id> --example`).
 */
const s = (role: string, emoji: string, fr: string, en: string, required: boolean, guideFr: string, guideEn: string): TemplateSection => ({
  role, emoji, heading: { fr, en }, required, guide: { fr: guideFr, en: guideEn },
});
const L = (fr: string, en: string): Localized => ({ fr, en });

/** The 30-second read every note opens with. */
export const BRIEF = s('brief', '⚡', 'En bref', 'In short', true,
  'Trois lignes au plus : ce que c’est, pourquoi ça compte, la chose à retenir. Lisible seul.',
  'Three lines at most: what it is, why it matters, the one thing to keep. Readable on its own.');
const BRIEF_OPTIONAL: TemplateSection = { ...BRIEF, required: false };
const PITFALLS = (req = false) => s('pitfalls', '🚧', 'Pièges', 'Pitfalls', req,
  'Ce qui surprend, casse ou se confond facilement, avec la façon de l’éviter.',
  'What surprises, breaks or is easily confused, and how to avoid it.');
const WHERE = s('where', '🗂️', 'Où regarder', 'Where to look', false,
  'Les fichiers (`chemin:ligne`), écrans, commandes ou documents où cela vit, chacun avec ce qu’on y trouve.',
  'Files (`path:line`), screens, commands or documents where it lives, each with what you find there.');

type Def = { id: string; okfType: string; folder: string; category: string; label: Localized; when: Localized; sections: TemplateSection[]; tips?: Localized[]; checks?: Localized[] };
const T = (d: Def): NoteTemplate => ({ id: d.id, okfType: d.okfType, folder: d.folder, category: d.category, label: d.label, when: d.when, sections: d.sections, tips: d.tips ?? [], ...(d.checks ? { checks: d.checks } : {}) });

const CITED = L('Chaque affirmation a sa source (code `chemin:ligne`, document, réunion) et son niveau de confiance.', 'Every claim has its source (code `path:line`, document, meeting) and its level of confidence.');
const FIVE = L('« En bref » se lit seul en 30 secondes ; aucun mot technique sans lien vers sa fiche.', '« In short » reads on its own in 30 seconds; no technical word without a link to its card.');

export const V1_TEMPLATES: readonly NoteTemplate[] = [
  T({
    id: 'subject-five', okfType: 'Overview', folder: 'sujets', category: 'guide',
    label: L('Un sujet en 5 minutes', 'A subject in 5 minutes'),
    when: L('La page d’un sujet (le cerveau, un domaine, un produit, un projet, une compétence) : comprendre l’essentiel en cinq minutes et savoir quoi lire ensuite.', 'The page of a subject (the brain, a domain, a product, a project, a skill): grasp the essentials in five minutes and know what to read next.'),
    sections: [
      BRIEF,
      s('purpose', '🎯', 'À quoi ça sert, pour qui', 'What it is for, for whom', true, 'Le problème que le sujet résout et qui s’en sert, en 3 à 5 phrases simples.', 'The problem the subject solves and who uses it, in 3–5 plain sentences.'),
      s('how', '🔍', 'Comment ça marche', 'How it works', true, 'Le mécanisme en quelques étapes, avec un schéma Mermaid (contexte, flux ou carte mentale).', 'The mechanism in a few steps, with a Mermaid diagram (context, flow or mind map).'),
      s('place', '🧭', 'Sa place', 'Its place', true, 'Ce qu’il y a au-dessus, à côté et en dessous : liens vers les pages des sujets voisins.', 'What is above, beside and below: links to the pages of neighbouring subjects.'),
      s('words', '🔤', 'Les 5 mots à connaître', 'The 5 words to know', true, 'Cinq termes au plus, chacun avec sa définition en une ligne et un lien vers sa fiche concept.', 'Five terms at most, each with a one-line definition and a link to its concept card.'),
      s('remember', '💡', 'À retenir et pièges', 'To remember and pitfalls', true, 'Trois points qui évitent les erreurs les plus fréquentes.', 'Three points that avoid the most common mistakes.'),
      s('next', '➡️', 'Pour aller plus loin', 'To go further', true, 'Le parcours de lecture : les notes du sujet dans l’ordre où les lire.', 'The reading path: the subject’s notes in the order to read them.'),
      s('unknown', '❓', 'Ce qu’on ne sait pas encore', 'What we do not know yet', false, 'Les questions ouvertes et à qui les poser (une équipe, un rôle).', 'Open questions and whom to ask (a team, a role).'),
    ],
    tips: [L('Une page de sujet se tient à jour : quand les notes en dessous changent, OKB propose de la rafraîchir.', 'A subject page stays current: when the notes below change, OKB offers to refresh it.')],
    checks: [FIVE, L('Un schéma montre le sujet dans son contexte.', 'A diagram shows the subject in its context.'), L('Le parcours renvoie à des notes qui existent.', 'The reading path links to notes that exist.')],
  }),
  T({
    id: 'team', okfType: 'Reference', folder: 'equipes', category: 'process',
    label: L('Équipe : qui sait quoi', 'Team: who knows what'),
    when: L('Une équipe ou un service : ce dont il s’occupe, comment le joindre, qui sait quoi (par rôle).', 'A team or department: what it owns, how to reach it, who knows what (by role).'),
    sections: [
      BRIEF,
      s('scope', '🧩', 'Ce dont elle s’occupe', 'What it owns', true, 'Les produits, repos, processus ou décisions dont l’équipe est responsable.', 'Products, repositories, processes or decisions the team is responsible for.'),
      s('contact', '📮', 'Comment la joindre', 'How to reach it', true, 'Le canal, la file de tickets ou le rituel ; jamais un secret ni une donnée personnelle.', 'The channel, ticket queue or ritual; never a secret or personal data.'),
      s('knows', '🧠', 'Qui sait quoi', 'Who knows what', false, 'Par rôle (« le responsable du déploiement »), les sujets où demander ; un prénom seulement si la personne le souhaite.', 'By role (“the deployment owner”), the topics to ask about; a first name only if the person wishes so.'),
      s('rules', '📏', 'Ses règles', 'Its rules', false, 'Ce qu’elle attend : délais, format des demandes, ce qu’elle refuse.', 'What it expects: lead times, request format, what it refuses.'),
    ],
  }),
  T({
    id: 'client', okfType: 'Reference', folder: 'clients', category: 'case',
    label: L('Client : ce qu’il faut savoir', 'Client: what to know'),
    when: L('Un client ou un compte : qui il est, ce qu’il utilise, ses enjeux, son historique.', 'A client or account: who it is, what it uses, its stakes, its history.'),
    sections: [
      BRIEF,
      s('who', '🏢', 'Qui est ce client', 'Who this client is', true, 'Son activité et sa taille, en deux phrases.', 'Its business and size, in two sentences.'),
      s('uses', '📦', 'Ce qu’il utilise', 'What it uses', true, 'Les produits, versions et fonctionnalités, avec des liens vers leurs pages.', 'Products, versions and features, linked to their pages.'),
      s('stakes', '🎯', 'Ses enjeux', 'Its stakes', false, 'Ce qui compte pour lui, d’après des sources citées.', 'What matters to it, from cited sources.'),
      s('history', '🗓️', 'Historique', 'History', false, 'Les cas et incidents marquants, datés, avec leurs liens.', 'Notable cases and incidents, dated, with their links.'),
      s('care', '⚠️', 'Points d’attention', 'Watch out', false, 'Ce qu’il ne faut pas faire ou oublier avec ce client.', 'What not to do or forget with this client.'),
    ],
    tips: [L('Une note client est confidentielle par nature : pas de données personnelles, seulement des rôles.', 'A client note is confidential by nature: no personal data, roles only.')],
  }),
  T({
    id: 'competitor', okfType: 'Reference', folder: 'marche', category: 'guide',
    label: L('Concurrent : face à nous', 'Competitor: against us'),
    when: L('Un concurrent ou une solution alternative : ce qu’il propose et où il se place face au produit.', 'A competitor or alternative: what it offers and where it stands against the product.'),
    sections: [
      BRIEF,
      s('offer', '📦', 'Ce qu’il propose', 'What it offers', true, 'Son offre et sa cible, d’après des sources citées.', 'Its offer and target, from cited sources.'),
      s('compare', '⚖️', 'Face à nous', 'Against us', true, 'Un tableau critère par critère et, si utile, un `quadrantChart` Mermaid.', 'A criterion-by-criterion table and, if useful, a Mermaid `quadrantChart`.'),
      s('strengths', '💪', 'Ses forces', 'Its strengths', false, 'Ce qu’il fait mieux, sans exagérer.', 'What it does better, without exaggeration.'),
      s('weaknesses', '🩹', 'Ses faiblesses', 'Its weaknesses', false, 'Ce qu’il fait moins bien.', 'What it does worse.'),
    ],
    checks: [CITED],
  }),
  T({
    id: 'comparison', okfType: 'Reference', folder: 'comparatifs', category: 'guide',
    label: L('Comparatif : choisir entre plusieurs options', 'Comparison: choose between options'),
    when: L('Deux options ou plus à comparer (outils, approches, produits, concepts proches).', 'Two or more options to compare (tools, approaches, products, close concepts).'),
    sections: [
      BRIEF,
      s('options', '🧩', 'Les options', 'The options', true, 'Chaque option en une phrase, avec son lien.', 'Each option in a sentence, with its link.'),
      s('table', '⚖️', 'Le comparatif', 'The comparison', true, 'Un tableau : une ligne par critère, une colonne par option.', 'A table: one row per criterion, one column per option.'),
      s('verdict', '✅', 'Quand choisir quoi', 'When to choose which', true, 'Les situations où chaque option est la bonne.', 'The situations where each option is right.'),
    ],
  }),
  T({
    id: 'business-rule', okfType: 'Reference', folder: 'regles', category: 'guide',
    label: L('Règle métier', 'Business rule'),
    when: L('Une règle du métier ou d’un produit, découverte dans le code, un ticket, une réunion ou une doc.', 'A business or product rule, found in code, a ticket, a meeting or a document.'),
    sections: [
      BRIEF,
      s('rule', '📏', 'La règle', 'The rule', true, 'L’énoncé exact, sans ambiguïté, avec son niveau de confiance (vérifiée, entendue, supposée).', 'The exact statement, unambiguous, with its confidence (verified, heard, assumed).'),
      s('why', '🎯', 'Pourquoi elle existe', 'Why it exists', false, 'La raison métier, légale ou technique, si une source la donne.', 'The business, legal or technical reason, if a source gives it.'),
      s('example', '💡', 'Exemple chiffré', 'Worked example', true, 'Un cas concret avec des chiffres.', 'A concrete case with numbers.'),
      s('where', '🗂️', 'Où elle vit', 'Where it lives', false, 'Les produits concernés et le code qui l’applique (`chemin:ligne`).', 'The products concerned and the code that applies it (`path:line`).'),
      s('exceptions', '🚧', 'Exceptions et pièges', 'Exceptions and pitfalls', false, 'Les cas où elle ne s’applique pas.', 'Cases where it does not apply.'),
    ],
    checks: [CITED, L('L’exemple est chiffré et cohérent avec la règle.', 'The example has numbers and matches the rule.')],
  }),
  T({
    id: 'idea', okfType: 'Reference', folder: 'idees', category: 'guide',
    label: L('Idée de projet', 'Project idea'),
    when: L('Une idée de projet personnel, notée pour être comparée aux autres.', 'A personal project idea, noted to compare with others.'),
    sections: [
      BRIEF,
      s('problem', '🎯', 'Le problème', 'The problem', true, 'Ce qui manque ou agace, pour qui.', 'What is missing or annoying, for whom.'),
      s('idea', '💡', 'L’idée', 'The idea', true, 'La solution en quelques phrases.', 'The solution in a few sentences.'),
      s('effort', '⏱️', 'Effort et risques', 'Effort and risks', false, 'Le temps, les inconnues, ce qui pourrait l’arrêter.', 'Time, unknowns, what could stop it.'),
      s('next', '➡️', 'Premier pas', 'First step', false, 'La plus petite action pour la tester.', 'The smallest action to test it.'),
    ],
  }),
  T({
    id: 'feature', okfType: 'Guide', folder: 'fonctionnalites', category: 'guide',
    label: L('Fonctionnalité', 'Feature'),
    when: L('Une fonctionnalité d’un produit : ce qu’elle fait pour l’utilisateur, comment elle marche, où elle vit.', 'A product feature: what it does for the user, how it works, where it lives.'),
    sections: [
      BRIEF,
      s('what', '🎯', 'Ce que ça fait', 'What it does', true, 'Du point de vue de l’utilisateur, sans jargon.', 'From the user’s point of view, without jargon.'),
      s('who', '👥', 'Qui l’utilise', 'Who uses it', false, 'Les rôles et les situations.', 'Roles and situations.'),
      s('flow', '🔁', 'Comment ça marche', 'How it works', true, 'Le parcours en étapes, avec un `sequenceDiagram` quand plusieurs acteurs interviennent.', 'The journey in steps, with a `sequenceDiagram` when several actors take part.'),
      s('rules', '📏', 'Règles métier', 'Business rules', false, 'Les règles qui la gouvernent, liées à leurs notes.', 'The rules that govern it, linked to their notes.'),
      WHERE,
      s('limits', '🚧', 'Limites connues', 'Known limits', false, 'Ce qu’elle ne fait pas, les bugs connus.', 'What it does not do, known bugs.'),
    ],
    checks: [CITED],
  }),
  T({
    id: 'user-journey', okfType: 'Guide', folder: 'parcours', category: 'guide',
    label: L('Parcours utilisateur', 'User journey'),
    when: L('Ce que vit un utilisateur de bout en bout pour accomplir une tâche.', 'What a user goes through end to end to complete a task.'),
    sections: [
      BRIEF,
      s('persona', '👤', 'Qui', 'Who', true, 'Le rôle et son objectif.', 'The role and its goal.'),
      s('steps', '🪜', 'Les étapes', 'The steps', true, 'Les étapes, avec un `journey` Mermaid.', 'The steps, with a Mermaid `journey`.'),
      s('pains', '😣', 'Points de friction', 'Friction points', false, 'Où ça coince, d’après des sources.', 'Where it gets stuck, from sources.'),
      s('behind', '⚙️', 'Ce qui se passe derrière', 'What happens behind', false, 'Les systèmes appelés à chaque étape.', 'The systems called at each step.'),
    ],
  }),
  T({
    id: 'first-week', okfType: 'Guide', folder: 'demarrage', category: 'path',
    label: L('Première semaine sur un produit', 'First week on a product'),
    when: L('Tout ce qu’il faut pour démarrer sur un produit : accès, installation, lectures, personnes, première tâche.', 'Everything to start on a product: access, setup, reading, people, first task.'),
    sections: [
      BRIEF,
      s('access', '🔑', 'Les accès à demander', 'Access to request', true, 'Chaque accès, à qui le demander, combien de temps ça prend.', 'Each access, whom to ask, how long it takes.'),
      s('setup', '🛠️', 'Installer et lancer', 'Install and run', true, 'Les étapes, ou un lien vers la note « Démarrer » de chaque repo.', 'The steps, or a link to each repository’s « Getting started » note.'),
      s('read', '📚', 'À lire d’abord', 'Read first', true, 'Le parcours de lecture, du plus général au plus précis.', 'The reading path, from general to precise.'),
      s('people', '👥', 'Qui voir', 'Whom to meet', false, 'Les rôles et équipes à rencontrer, et pourquoi.', 'Roles and teams to meet, and why.'),
      s('task', '🎯', 'Une première tâche', 'A first task', false, 'Une tâche simple pour pratiquer.', 'A simple task to practise.'),
    ],
  }),
  T({
    id: 'arch-context', okfType: 'Architecture', folder: 'architecture', category: 'guide',
    label: L('Contexte et place d’un produit', 'Context and place of a product'),
    when: L('Où se place un produit parmi les autres systèmes : qui l’utilise, avec qui il parle (niveau 1 du modèle C4).', 'Where a product sits among other systems: who uses it, whom it talks to (C4 level 1).'),
    sections: [
      BRIEF,
      s('context', '🗺️', 'Le contexte', 'The context', true, 'Un schéma Mermaid (flowchart ou C4) : le produit au centre, ses utilisateurs et les systèmes autour.', 'A Mermaid diagram (flowchart or C4): the product in the middle, its users and the systems around.'),
      s('neighbours', '🔗', 'Avec qui il parle', 'Whom it talks to', true, 'Un tableau : système, sens, protocole, pourquoi, source.', 'A table: system, direction, protocol, why, source.'),
      s('role', '🎯', 'Son rôle dans l’ensemble', 'Its role in the whole', true, 'Ce qu’il apporte que les autres n’apportent pas.', 'What it brings that the others do not.'),
      s('boundaries', '🚧', 'Ce qu’il ne fait pas', 'What it does not do', false, 'Les frontières, pour éviter les confusions.', 'The boundaries, to avoid confusion.'),
    ],
    checks: [CITED, L('Chaque flèche du schéma correspond à une ligne du tableau, avec sa source.', 'Every arrow of the diagram matches a row of the table, with its source.')],
  }),
  T({
    id: 'arch-containers', okfType: 'Architecture', folder: 'architecture', category: 'guide',
    label: L('Les blocs d’un produit', 'The building blocks of a product'),
    when: L('De quoi est fait un produit : applications, services, bases, et ce que chacun fait (niveau 2 du modèle C4).', 'What a product is made of: apps, services, databases, and what each does (C4 level 2).'),
    sections: [
      BRIEF,
      s('blocks', '🏗️', 'Les blocs', 'The blocks', true, 'Un schéma Mermaid des blocs et de leurs échanges.', 'A Mermaid diagram of the blocks and their exchanges.'),
      s('each', '🧩', 'Chaque bloc', 'Each block', true, 'Un tableau : bloc, rôle, technologie, repo (lien).', 'A table: block, role, technology, repository (link).'),
      s('data', '🗄️', 'Les données', 'The data', false, 'Où vivent les données et qui en est maître.', 'Where data lives and who owns it.'),
      s('deploy', '🚀', 'Où ça tourne', 'Where it runs', false, 'Les environnements et la plateforme.', 'Environments and platform.'),
    ],
    checks: [CITED],
  }),
  T({
    id: 'flow', okfType: 'Architecture', folder: 'flux', category: 'guide',
    label: L('Flux : ce qui se passe quand…', 'Flow: what happens when…'),
    when: L('Le déroulé d’une action à travers les composants ou les systèmes (une commande, une facture, une connexion).', 'The course of an action across components or systems (an order, an invoice, a login).'),
    sections: [
      BRIEF,
      s('trigger', '▶️', 'Ce qui déclenche', 'What triggers it', true, 'L’action ou l’événement de départ.', 'The starting action or event.'),
      s('sequence', '🔁', 'Le déroulé', 'The sequence', true, 'Un `sequenceDiagram` Mermaid, chaque message tiré du code ou d’une doc.', 'A Mermaid `sequenceDiagram`, each message taken from the code or a document.'),
      s('steps', '🪜', 'Étape par étape', 'Step by step', true, 'Chaque étape avec son fichier (`chemin:ligne`).', 'Each step with its file (`path:line`).'),
      s('errors', '🚨', 'Quand ça casse', 'When it breaks', false, 'Les erreurs possibles à chaque étape et leurs notes « erreur connue ».', 'Possible errors at each step and their « known error » notes.'),
    ],
    checks: [CITED, L('Le schéma et les étapes racontent la même chose.', 'The diagram and the steps tell the same story.')],
  }),
  T({
    id: 'data-model', okfType: 'Architecture', folder: 'donnees', category: 'guide',
    label: L('Modèle de données', 'Data model'),
    when: L('Les entités, leurs champs importants et leurs liens.', 'Entities, their important fields and their links.'),
    sections: [
      BRIEF,
      s('entities', '🗄️', 'Les entités', 'The entities', true, 'Un `erDiagram` Mermaid.', 'A Mermaid `erDiagram`.'),
      s('fields', '📋', 'Les champs importants', 'Important fields', true, 'Un tableau : entité, champ, sens, règle.', 'A table: entity, field, meaning, rule.'),
      s('rules', '📏', 'Règles et contraintes', 'Rules and constraints', false, 'Unicité, cycles de vie, cascades.', 'Uniqueness, lifecycles, cascades.'),
      WHERE,
    ],
  }),
  T({
    id: 'lifecycle', okfType: 'Architecture', folder: 'cycles', category: 'guide',
    label: L('Cycle de vie', 'Lifecycle'),
    when: L('Les états par lesquels passe un objet (commande, ticket, facture) et ce qui le fait changer d’état.', 'The states an object goes through (order, ticket, invoice) and what moves it.'),
    sections: [
      BRIEF,
      s('states', '🔄', 'Les états', 'The states', true, 'Un `stateDiagram-v2` Mermaid.', 'A Mermaid `stateDiagram-v2`.'),
      s('transitions', '➡️', 'Les transitions', 'The transitions', true, 'Un tableau : de, vers, déclencheur, règle, code.', 'A table: from, to, trigger, rule, code.'),
      PITFALLS(),
    ],
  }),
  T({
    id: 'strengths', okfType: 'Reference', folder: 'architecture', category: 'guide',
    label: L('Forces et défauts', 'Strengths and weaknesses'),
    when: L('Le bilan honnête d’un produit ou d’un repo : ce qui marche bien, ce qui coince, la dette.', 'An honest review of a product or repository: what works, what does not, the debt.'),
    sections: [
      BRIEF,
      s('strengths', '💪', 'Forces', 'Strengths', true, 'Ce qui marche bien, avec des preuves.', 'What works well, with evidence.'),
      s('weaknesses', '🩹', 'Défauts', 'Weaknesses', true, 'Ce qui coince, avec des preuves (tickets, incidents, code).', 'What does not work, with evidence (tickets, incidents, code).'),
      s('debt', '🧱', 'Dette connue', 'Known debt', false, 'Ce qui coûtera plus tard si rien ne change.', 'What will cost later if nothing changes.'),
      s('ideas', '🚀', 'Pistes', 'Ideas', false, 'Les améliorations possibles, sans les décider.', 'Possible improvements, without deciding them.'),
    ],
    checks: [CITED],
  }),
  T({
    id: 'environments', okfType: 'Runbook', folder: 'environnements', category: 'howto',
    label: L('Environnements et accès', 'Environments and access'),
    when: L('Les environnements (développement, recette, production…), à quoi chacun sert et comment y accéder.', 'Environments (development, testing, production…), what each is for and how to access it.'),
    sections: [
      BRIEF,
      s('list', '🌐', 'Les environnements', 'The environments', true, 'Un tableau : nom, rôle, adresse (jamais de mot de passe), qui y a accès.', 'A table: name, role, address (never a password), who has access.'),
      s('access', '🔑', 'Obtenir l’accès', 'Getting access', true, 'La démarche, à qui la demander.', 'The procedure, whom to ask.'),
      s('deploy', '🚀', 'Comment on y livre', 'How it is delivered', false, 'Le chemin d’une version jusqu’à la production.', 'The path of a release to production.'),
      s('care', '⚠️', 'Précautions', 'Precautions', false, 'Ce qu’on ne fait jamais sur un environnement donné.', 'What is never done on a given environment.'),
    ],
    tips: [L('Aucun secret : OKB refuse les mots de passe et les jetons.', 'No secret: OKB refuses passwords and tokens.')],
  }),
  T({
    id: 'known-error', okfType: 'Experience', folder: 'erreurs', category: 'case',
    label: L('Erreur connue', 'Known error'),
    when: L('Une erreur déjà résolue : son message exact, sa cause, sa solution. Elle revient toute seule quand l’erreur réapparaît.', 'An error already solved: its exact message, its cause, its fix. It comes back by itself when the error reappears.'),
    sections: [
      BRIEF,
      s('symptom', '🚨', 'Le symptôme', 'The symptom', true, 'Le message exact dans un bloc de code (c’est lui qu’OKB reconnaît), et où il apparaît.', 'The exact message in a code block (that is what OKB recognises), and where it appears.'),
      s('cause', '🔍', 'La cause', 'The cause', true, 'Pourquoi ça arrive, avec la source.', 'Why it happens, with the source.'),
      s('fix', '🛠️', 'La solution', 'The fix', true, 'Les étapes, commandes comprises.', 'The steps, commands included.'),
      s('check', '✅', 'Vérifier que c’est réglé', 'Check it is solved', false, 'Comment savoir que c’est réparé.', 'How to know it is fixed.'),
      s('seen', '🗓️', 'Vu dans', 'Seen in', false, 'Les tickets et dates où l’erreur est apparue.', 'Tickets and dates where the error appeared.'),
    ],
    checks: [L('Le message d’erreur est recopié à l’identique dans un bloc de code.', 'The error message is copied verbatim in a code block.'), L('La solution se suit sans autre note.', 'The fix can be followed without another note.')],
  }),
  T({
    id: 'repo-test', okfType: 'Runbook', folder: 'repos', category: 'howto',
    label: L('Repo : tester', 'Repository: testing'),
    when: L('Comment lancer les tests d’un repo, tester un composant seul, les données de test, la CI.', 'How to run a repository’s tests, test one component, test data, CI.'),
    sections: [
      BRIEF,
      s('run', '▶️', 'Lancer les tests', 'Run the tests', true, 'Les commandes exactes, tirées du repo (`package.json`, Makefile…).', 'The exact commands, taken from the repository (`package.json`, Makefile…).'),
      s('kinds', '🧪', 'Les types de tests', 'Kinds of tests', false, 'Unitaires, intégration, bout en bout : où ils sont, ce qu’ils couvrent.', 'Unit, integration, end-to-end: where they are, what they cover.'),
      s('one', '🎯', 'Tester un composant', 'Test one component', true, 'Lancer un seul test ou un seul dossier, avec un exemple.', 'Run a single test or folder, with an example.'),
      s('data', '🗄️', 'Données et simulations', 'Data and mocks', false, 'Les jeux de données, mocks et services simulés.', 'Datasets, mocks and simulated services.'),
      s('ci', '🔁', 'En CI', 'In CI', false, 'Ce que la CI lance et comment lire un échec.', 'What CI runs and how to read a failure.'),
      PITFALLS(),
    ],
    checks: [L('Chaque commande vient d’un fichier du repo cité.', 'Every command comes from a cited file of the repository.')],
  }),
  T({
    id: 'repo-debug', okfType: 'Runbook', folder: 'repos', category: 'howto',
    label: L('Repo : déboguer', 'Repository: debugging'),
    when: L('Comment déboguer un repo en local : lancer en mode debug, lire les logs, les erreurs fréquentes.', 'How to debug a repository locally: debug mode, logs, frequent errors.'),
    sections: [
      BRIEF,
      s('local', '🐞', 'Déboguer en local', 'Debug locally', true, 'Lancer en mode debug, points d’arrêt, configuration de l’éditeur.', 'Run in debug mode, breakpoints, editor setup.'),
      s('logs', '📜', 'Logs et traces', 'Logs and traces', true, 'Où sont les logs, comment les lire, comment augmenter le niveau.', 'Where the logs are, how to read them, how to raise the level.'),
      s('common', '🚨', 'Erreurs fréquentes', 'Frequent errors', false, 'Liens vers les notes « erreur connue » du repo.', 'Links to the repository’s « known error » notes.'),
      s('tools', '🧰', 'Outils', 'Tools', false, 'Les outils utiles et leur usage.', 'Useful tools and how to use them.'),
      PITFALLS(),
    ],
  }),
  T({
    id: 'component', okfType: 'Guide', folder: 'composants', category: 'guide',
    label: L('Composant expliqué', 'Component explained'),
    when: L('Un composant important d’un repo : son rôle, son fonctionnement, ses liens, comment le tester.', 'An important component of a repository: its role, how it works, its links, how to test it.'),
    sections: [
      BRIEF,
      s('role', '🎯', 'Son rôle', 'Its role', true, 'Ce qu’il fait et pourquoi il existe.', 'What it does and why it exists.'),
      s('how', '🔍', 'Comment il marche', 'How it works', true, 'Le mécanisme, avec un schéma quand il y a un flux.', 'The mechanism, with a diagram when there is a flow.'),
      s('io', '📥', 'Entrées et sorties', 'Inputs and outputs', false, 'Ce qu’il reçoit et renvoie, avec les types.', 'What it receives and returns, with types.'),
      s('links', '🔗', 'Qui l’appelle, qui il appelle', 'Who calls it, whom it calls', true, 'Les appels entrants et sortants (`chemin:ligne`).', 'Incoming and outgoing calls (`path:line`).'),
      s('test', '🧪', 'Le tester', 'Testing it', false, 'Le test existant à lancer ou à copier.', 'The existing test to run or copy.'),
      PITFALLS(),
    ],
    checks: [CITED],
  }),
  T({
    id: 'key-file', okfType: 'Reference', folder: 'composants', category: 'guide',
    label: L('Fichier clé expliqué', 'Key file explained'),
    when: L('Un fichier central qu’on ouvre souvent : comment il est organisé et comment le modifier sans casser.', 'A central file you open often: how it is organised and how to change it safely.'),
    sections: [
      BRIEF,
      s('role', '🎯', 'Son rôle', 'Its role', true, 'Pourquoi ce fichier est important.', 'Why this file matters.'),
      s('structure', '🧱', 'Comment il est organisé', 'How it is organised', true, 'Les grandes parties, dans l’ordre du fichier (`chemin:ligne`).', 'Its main parts, in file order (`path:line`).'),
      s('change', '✏️', 'Le modifier sans casser', 'Change it safely', false, 'Les endroits sensibles et les tests à relancer.', 'Sensitive places and tests to rerun.'),
    ],
  }),
  T({
    id: 'simplification', okfType: 'Reference', folder: 'simplifications', category: 'guide',
    label: L('Pistes de simplification', 'Simplification ideas'),
    when: L('Ce qui pourrait être plus simple dans un fichier ou un composant, avec le gain et le risque — une note, pas une modification du code.', 'What could be simpler in a file or component, with the gain and the risk — a note, not a code change.'),
    sections: [
      BRIEF,
      s('current', '🔍', 'Aujourd’hui', 'Today', true, 'Le code actuel concerné, en extraits courts (`chemin:ligne`).', 'The current code concerned, in short excerpts (`path:line`).'),
      s('ideas', '✂️', 'Pistes', 'Ideas', true, 'Chaque piste : avant, après, gain, risque.', 'Each idea: before, after, gain, risk.'),
      s('safety', '🧪', 'Filets de sécurité', 'Safety nets', false, 'Les tests qui protègent, ceux qui manquent.', 'Tests that protect, tests that are missing.'),
    ],
  }),
  T({
    id: 'ticket', okfType: 'Experience', folder: 'tickets', category: 'ticket',
    label: L('Ticket : le problème, la résolution, la méthode', 'Ticket: problem, resolution, method'),
    when: L('Un ticket terminé (bug ou évolution) : le problème expliqué simplement, comment il a été résolu, la méthode suivie et ce qui est remonté.', 'A finished ticket (bug or change): the problem explained simply, how it was solved, the method followed and what was promoted.'),
    sections: [
      BRIEF,
      s('problem', '🎯', 'Le problème en simple', 'The problem, simply', true, 'Comme à un collègue qui arrive : le besoin ou le bug, cité depuis le ticket.', 'As to a colleague who just arrived: the need or bug, cited from the ticket.'),
      s('resolution', '🛠️', 'La résolution', 'The resolution', true, 'Ce qui a changé et pourquoi, dans l’état final du code (`chemin:ligne`).', 'What changed and why, in the final state of the code (`path:line`).'),
      s('method', '🧭', 'La méthode suivie', 'The method followed', true, 'Les étapes de l’enquête ou de la conception, réutilisables.', 'The steps of the investigation or design, reusable.'),
      s('test', '🧪', 'Comment c’est testé', 'How it is tested', false, 'Les tests ajoutés ou lancés et ce qu’ils prouvent.', 'Tests added or run and what they prove.'),
      s('learned', '💡', 'Ce que j’ai appris', 'What I learned', true, 'Pièges, règles métier, raccourcis, chacun lié à sa note quand elle existe.', 'Traps, business rules, shortcuts, each linked to its note when it exists.'),
      s('promoted', '🛗', 'Ce qui est remonté', 'What was promoted', false, 'Les leçons placées plus haut : méthode dans la boîte à outils, règle dans le produit, erreur connue.', 'Lessons filed higher: method in the toolbox, rule in the product, known error.'),
      s('followups', '➡️', 'Suites', 'Follow-ups', false, 'Ce qui reste à faire, seulement si une source le dit.', 'What remains, only if a source says so.'),
    ],
    checks: [CITED, L('Le problème se comprend sans connaître le code.', 'The problem is understood without knowing the code.'), L('La méthode peut servir à un autre ticket.', 'The method can serve another ticket.')],
  }),
  T({
    id: 'investigation', okfType: 'Experience', folder: 'tickets', category: 'ticket',
    label: L('Journal d’enquête', 'Investigation log'),
    when: L('Un bug en cours d’enquête : les hypothèses testées, leurs résultats, la cause trouvée.', 'A bug under investigation: hypotheses tested, results, cause found.'),
    sections: [
      BRIEF,
      s('symptom', '🚨', 'Le symptôme', 'The symptom', true, 'Ce qu’on observe, avec le message exact.', 'What is observed, with the exact message.'),
      s('hypotheses', '🧪', 'Hypothèses testées', 'Hypotheses tested', true, 'Un tableau : hypothèse, test fait, résultat.', 'A table: hypothesis, test done, result.'),
      s('cause', '🎯', 'La cause trouvée', 'The cause found', false, 'La cause, avec sa preuve.', 'The cause, with its evidence.'),
      s('method', '🧭', 'La méthode', 'The method', false, 'Ce qui a permis de trouver, réutilisable.', 'What made it possible to find, reusable.'),
    ],
  }),
  T({
    id: 'method', okfType: 'Procedure', folder: 'methodes', category: 'howto',
    label: L('Méthode réutilisable', 'Reusable method'),
    when: L('Une façon de faire qui marche partout (déboguer un flux, analyser un ticket, enquêter sur une lenteur).', 'A way of working that works everywhere (debug a flow, analyse a ticket, investigate slowness).'),
    sections: [
      BRIEF,
      s('when', '🎯', 'Quand l’utiliser', 'When to use it', true, 'Les situations où elle s’applique.', 'The situations where it applies.'),
      s('steps', '🪜', 'Les étapes', 'The steps', true, 'Des étapes numérotées, chacune actionnable.', 'Numbered, actionable steps.'),
      s('example', '💡', 'Exemple', 'Example', false, 'Un cas réel où elle a servi (lien vers le ticket).', 'A real case where it helped (link to the ticket).'),
      PITFALLS(),
      s('used', '🗓️', 'Utilisée dans', 'Used in', false, 'Les tickets où elle a servi : la preuve qu’elle est utile.', 'Tickets where it helped: the proof it is useful.'),
    ],
    checks: [L('Chaque étape commence par un verbe d’action.', 'Every step starts with an action verb.')],
  }),
  T({
    id: 'recipe', okfType: 'Procedure', folder: 'recettes', category: 'howto',
    label: L('Recette : une commande qui sert', 'Recipe: a useful command'),
    when: L('Une commande, une requête ou un extrait qu’on réutilise (git, SQL, terminal, API).', 'A command, query or snippet you reuse (git, SQL, terminal, API).'),
    sections: [
      BRIEF,
      s('command', '⌨️', 'La commande', 'The command', true, 'Dans un bloc de code, prête à copier (sans secret).', 'In a code block, ready to copy (no secret).'),
      s('when', '🎯', 'Quand', 'When', true, 'La situation où elle sert.', 'The situation where it helps.'),
      s('explain', '🔍', 'Ce qu’elle fait', 'What it does', false, 'Chaque option expliquée.', 'Each option explained.'),
      s('variants', '🔀', 'Variantes', 'Variants', false, 'Les variantes utiles.', 'Useful variants.'),
    ],
  }),
  T({
    id: 'team-rule', okfType: 'Process', folder: 'regles-equipe', category: 'process',
    label: L('Règle d’équipe', 'Team rule'),
    when: L('Une convention de l’équipe, souvent apprise en revue de code.', 'A team convention, often learned in code review.'),
    sections: [
      BRIEF,
      s('rule', '📏', 'La règle', 'The rule', true, 'Énoncée en une phrase.', 'Stated in one sentence.'),
      s('why', '🎯', 'Pourquoi', 'Why', false, 'La raison, si elle est connue.', 'The reason, if known.'),
      s('example', '✅', 'Bon / pas bon', 'Good / not good', true, 'Un exemple de chaque, en code si c’est du code.', 'One example of each, in code when it is code.'),
      s('source', '🗣️', 'D’où elle vient', 'Where it comes from', false, 'Revue de code, décision, guide de l’équipe.', 'Code review, decision, team guide.'),
    ],
  }),
  T({
    id: 'checklist', okfType: 'Procedure', folder: 'antiseches', category: 'howto',
    label: L('Checklist', 'Checklist'),
    when: L('Une liste à cocher avant une action (livrer, ouvrir une PR, présenter).', 'A list to tick before an action (release, open a PR, present).'),
    sections: [
      BRIEF,
      s('when', '🎯', 'Quand', 'When', true, 'Le moment où on la suit.', 'When to follow it.'),
      s('list', '✅', 'La liste', 'The list', true, 'Des cases `- [ ]`, chacune vérifiable.', '`- [ ]` boxes, each checkable.'),
    ],
  }),
  T({
    id: 'cheatsheet', okfType: 'Reference', folder: 'antiseches', category: 'howto',
    label: L('Antisèche', 'Cheat sheet'),
    when: L('L’essentiel d’un outil ou d’un langage sur une page.', 'The essentials of a tool or language on one page.'),
    sections: [
      BRIEF,
      s('table', '⌨️', 'L’essentiel', 'The essentials', true, 'Un tableau : besoin, commande, remarque.', 'A table: need, command, note.'),
      s('more', '🔗', 'Pour aller plus loin', 'To go further', false, 'Les notes et documents à lire ensuite.', 'Notes and documents to read next.'),
    ],
  }),
  T({
    id: 'training', okfType: 'Meeting', folder: 'formations', category: 'source',
    label: L('Formation : ce que j’en retiens', 'Training: what I keep'),
    when: L('Une formation, un cours ou un atelier suivi : ce qui a été appris et ce qui s’applique au travail.', 'A training, course or workshop: what was learned and what applies at work.'),
    sections: [
      BRIEF,
      s('about', '🎯', 'La formation', 'The training', true, 'Le sujet, le format, la date.', 'Topic, format, date.'),
      s('learned', '💡', 'Ce que j’ai appris', 'What I learned', true, 'Les idées clés, chacune liée à sa fiche concept.', 'Key ideas, each linked to its concept card.'),
      s('apply', '🛠️', 'Ce que j’applique', 'What I apply', false, 'Ce qui change dans ma façon de travailler, sur quel sujet.', 'What changes in how I work, on which subject.'),
      s('cards', '🃏', 'À réviser', 'To review', false, 'Des questions-réponses courtes, une par ligne « Q : … — R : … », reprises par la révision espacée.', 'Short questions and answers, one per line « Q: … — A: … », used by spaced review.'),
      s('questions', '❓', 'Questions restantes', 'Remaining questions', false, 'Ce qui reste flou.', 'What remains unclear.'),
    ],
  }),
  T({
    id: 'reading', okfType: 'Reference', folder: 'lectures', category: 'source',
    label: L('Lecture ou vidéo', 'Reading or video'),
    when: L('Un article, un livre, une vidéo : les idées clés et ce qu’on en fait.', 'An article, book or video: the key ideas and what to do with them.'),
    sections: [
      BRIEF,
      s('source', '📖', 'La source', 'The source', true, 'Titre, auteur, lien, date.', 'Title, author, link, date.'),
      s('ideas', '💡', 'Les idées clés', 'Key ideas', true, 'Trois à sept idées, reformulées, chacune avec sa référence.', 'Three to seven ideas, rephrased, each with its reference.'),
      s('apply', '🛠️', 'Ce que j’en fais', 'What I do with it', false, 'Ce que ça change, où le ranger dans le cerveau.', 'What it changes, where it belongs in the brain.'),
    ],
    tips: [L('Une citation reste courte et entre guillemets ; le reste est reformulé.', 'A quotation stays short and in quotes; the rest is rephrased.')],
  }),
  T({
    id: 'presentation', okfType: 'Guide', folder: 'presentations', category: 'source',
    label: L('Préparer une présentation', 'Prepare a presentation'),
    when: L('Une présentation à préparer : le public, le message, le plan, les slides, les questions attendues.', 'A presentation to prepare: audience, message, outline, slides, expected questions.'),
    sections: [
      BRIEF,
      s('audience', '👥', 'Le public et le but', 'Audience and goal', true, 'Qui écoute, ce qu’ils savent, ce qu’ils doivent retenir ou décider.', 'Who listens, what they know, what they must keep or decide.'),
      s('message', '🎯', 'Le message en une phrase', 'The message in one sentence', true, 'La seule phrase à retenir.', 'The one sentence to keep.'),
      s('outline', '🗂️', 'Le plan', 'The outline', true, 'Trois à six parties, chacune avec son idée.', 'Three to six parts, each with its idea.'),
      s('slides', '🖼️', 'Les slides', 'The slides', false, 'Une ligne par slide : titre, contenu, schéma éventuel.', 'One line per slide: title, content, optional diagram.'),
      s('questions', '❓', 'Questions attendues', 'Expected questions', false, 'Les questions probables et leurs réponses, sourcées.', 'Likely questions and their sourced answers.'),
    ],
  }),
  T({
    id: 'handover', okfType: 'Guide', folder: 'bilans', category: 'path',
    label: L('Passation', 'Handover'),
    when: L('Transmettre un sujet (produit, repo, mission) à quelqu’un : où en est chaque chose, qui contacter, ce qui reste ouvert.', 'Hand a subject (product, repository, mission) over: where each thing stands, whom to contact, what remains open.'),
    sections: [
      BRIEF,
      s('state', '📍', 'Où en est chaque sujet', 'Where each topic stands', true, 'Un tableau : sujet, état, prochaine étape, note.', 'A table: topic, status, next step, note.'),
      s('contacts', '📮', 'Qui contacter', 'Whom to contact', true, 'Par rôle et par équipe.', 'By role and team.'),
      PITFALLS(),
      s('open', '❓', 'Ce qui reste ouvert', 'What remains open', true, 'Questions et tickets en cours.', 'Open questions and tickets.'),
      s('read', '📚', 'À lire', 'To read', false, 'Le parcours de lecture pour reprendre.', 'The reading path to take over.'),
    ],
  }),
  T({
    id: 'achievement', okfType: 'Experience', folder: 'carriere', category: 'case',
    label: L('Réalisations de l’année', 'Achievements of the year'),
    when: L('Le fichier de l’année où chaque réussite est ajoutée au format STAR, prêt pour un entretien.', 'The year’s file where each achievement is added in STAR form, ready for a review.'),
    sections: [
      BRIEF,
      s('entries', '🏆', 'Réalisations', 'Achievements', true, 'Une sous-section datée par réussite (`### 2026-10-06 — titre`) : **Situation**, **Tâche**, **Action** (verbes d’action), **Résultat** (chiffré si possible), **Compétences**, **Preuves** (liens).', 'One dated sub-section per achievement (`### 2026-10-06 — title`): **Situation**, **Task**, **Action** (action verbs), **Result** (with numbers if possible), **Skills**, **Evidence** (links).'),
    ],
    checks: [L('Chaque résultat dit ce que ça a apporté, chiffré si une source le permet.', 'Every result says what it brought, with numbers when a source allows.')],
  }),
  T({
    id: 'goal', okfType: 'Reference', folder: 'carriere', category: 'path',
    label: L('Objectifs de l’année', 'Goals of the year'),
    when: L('Les objectifs fixés pour l’année, leurs critères et les preuves accumulées.', 'The goals set for the year, their criteria and the evidence gathered.'),
    sections: [
      BRIEF,
      s('goals', '🎯', 'Les objectifs', 'The goals', true, 'Chaque objectif : énoncé, critère de réussite, preuves (liens vers les réalisations).', 'Each goal: statement, success criterion, evidence (links to achievements).'),
      s('progress', '📈', 'Où j’en suis', 'Where I stand', false, 'L’avancement de chaque objectif.', 'Progress on each goal.'),
    ],
  }),
  T({
    id: 'feedback', okfType: 'Experience', folder: 'carriere', category: 'case',
    label: L('Retour reçu', 'Feedback received'),
    when: L('Un retour reçu (revue de code, manager, collègue) : ce qui a été dit et ce que j’en fais.', 'Feedback received (code review, manager, colleague): what was said and what I do about it.'),
    sections: [
      BRIEF,
      s('said', '🗣️', 'Ce qui a été dit', 'What was said', true, 'Le retour, le contexte, le rôle de la personne (pas son nom par défaut).', 'The feedback, the context, the person’s role (not their name by default).'),
      s('kind', '🏷️', 'Point fort ou à travailler', 'Strength or to work on', true, 'Le classement, et la compétence concernée.', 'The classification, and the skill concerned.'),
      s('action', '🛠️', 'Ce que je vais faire', 'What I will do', false, 'Une action concrète.', 'A concrete action.'),
    ],
  }),
  T({
    id: 'one-on-one', okfType: 'Meeting', folder: 'carriere', category: 'source',
    label: L('Entretien individuel', 'One-on-one'),
    when: L('Préparer ou garder la trace d’un point avec son manager.', 'Prepare or record a one-on-one with your manager.'),
    sections: [
      BRIEF,
      s('wins', '🏆', 'Depuis la dernière fois', 'Since last time', true, 'Les réussites, liées à leurs entrées.', 'Achievements, linked to their entries.'),
      s('blockers', '🚧', 'Blocages', 'Blockers', false, 'Ce qui freine, et l’aide demandée.', 'What slows things down, and the help asked.'),
      s('asks', '🙋', 'Ce que je demande', 'What I ask', false, 'Formations, missions, retours.', 'Trainings, missions, feedback.'),
      s('actions', '✅', 'Actions décidées', 'Actions decided', false, 'Qui fait quoi, pour quand.', 'Who does what, by when.'),
      s('previous', '↩️', 'Suivi des actions précédentes', 'Follow-up of previous actions', false, 'Ce qui a été fait depuis le dernier point.', 'What was done since the last one.'),
    ],
  }),
  T({
    id: 'annual-review', okfType: 'Meeting', folder: 'carriere', category: 'source',
    label: L('Entretien annuel', 'Annual review'),
    when: L('Préparer l’entretien annuel : auto-évaluation par objectif avec preuves, temps forts, souhaits.', 'Prepare the annual review: self-assessment per goal with evidence, highlights, wishes.'),
    sections: [
      BRIEF,
      s('goals', '🎯', 'Objectifs : auto-évaluation', 'Goals: self-assessment', true, 'Un tableau : objectif, preuves, niveau atteint.', 'A table: goal, evidence, level reached.'),
      s('highlights', '🏆', 'Temps forts', 'Highlights', true, 'Trois à cinq réalisations marquantes, au format STAR court.', 'Three to five notable achievements, in short STAR form.'),
      s('growth', '📈', 'Ce que j’ai appris', 'What I learned', false, 'Les compétences gagnées, avec leurs preuves.', 'Skills gained, with evidence.'),
      s('wishes', '🚀', 'Mes souhaits d’évolution', 'Career wishes', false, 'Ce que je veux faire ensuite.', 'What I want to do next.'),
    ],
  }),
  T({
    id: 'development-plan', okfType: 'Reference', folder: 'carriere', category: 'path',
    label: L('Plan de développement', 'Development plan'),
    when: L('Les écarts à combler pour le niveau suivant et le plan pour y arriver.', 'The gaps to close for the next level and the plan to get there.'),
    sections: [
      BRIEF,
      s('gaps', '🧭', 'Les écarts', 'The gaps', true, 'Ce qui manque, d’après la grille de carrière et les retours.', 'What is missing, from the career grid and feedback.'),
      s('goals', '🎯', 'Objectifs d’apprentissage', 'Learning goals', true, 'Chacun mesurable.', 'Each measurable.'),
      s('actions', '🛠️', 'Actions', 'Actions', true, 'Parcours, formations, missions, avec une date.', 'Paths, trainings, missions, with a date.'),
    ],
  }),
  T({
    id: 'cv', okfType: 'Reference', folder: 'parcours', category: 'path',
    label: L('CV vivant', 'Living CV'),
    when: L('Le parcours professionnel, tenu à jour à partir des réussites portables, sans aucun détail interne.', 'The professional path, kept current from portable achievements, without any internal detail.'),
    sections: [
      BRIEF,
      s('path', '💼', 'Parcours', 'Experience', true, 'Postes et missions, du plus récent au plus ancien.', 'Positions and missions, most recent first.'),
      s('skills', '🧠', 'Compétences', 'Skills', true, 'Par famille, avec leurs preuves génériques.', 'By family, with generic evidence.'),
      s('stories', '🏆', 'Réalisations marquantes', 'Notable achievements', false, 'Liens vers les histoires STAR.', 'Links to the STAR stories.'),
    ],
    tips: [L('Rien d’interne : ni client, ni code projet, ni chiffre confidentiel.', 'Nothing internal: no client, project code name or confidential figure.')],
  }),
];

export { BRIEF_OPTIONAL };
