import type { Localized } from '../templates/builtin.js';
import type { Evidence, QuestionHint, QuestionStatus, RepoMap } from './types.js';

/**
 * What a person must know to start working on a repository they have never
 * seen. The list is fixed on purpose: it is the guarantee against "a summary
 * that forgot the important part". Each question is answered from the
 * repository (cited), from a person (a dated answer), or stays visible as
 * unknown with where OKB looked and who may know.
 */
export type Theme = 'purpose' | 'context' | 'architecture' | 'local' | 'deliver' | 'work';
export type NoteKind = 'overview' | 'architecture' | 'start' | 'interfaces' | 'delivery' | 'codemap' | 'questions';

export type Question = {
  readonly id: string;
  readonly theme: Theme;
  readonly text: Localized;
  readonly why: Localized;
  /** The note of the repository pack that answers it. */
  readonly note: NoteKind;
};

const q = (id: string, theme: Theme, note: NoteKind, fr: string, en: string, whyFr: string, whyEn: string): Question => ({
  id, theme, note, text: { fr, en }, why: { fr: whyFr, en: whyEn },
});

export const QUESTIONS: readonly Question[] = [
  q('q-purpose', 'purpose', 'overview', 'À quoi sert ce repo, en une phrase métier ?', 'What is this repository for, in one business sentence?',
    'Sans le « pourquoi », chaque fichier se lit à l’aveugle.', 'Without the "why", every file is read blind.'),
  q('q-users', 'purpose', 'overview', 'Qui l’utilise : quelles personnes, quels systèmes ?', 'Who uses it: which people, which systems?',
    'Un changement se juge à ceux qu’il touche.', 'A change is judged by whom it affects.'),
  q('q-scope', 'purpose', 'overview', 'Qu’est-ce qui n’est PAS dans ce repo (fait ailleurs) ?', 'What is NOT in this repository (done elsewhere)?',
    'Évite de chercher au mauvais endroit.', 'Saves searching in the wrong place.'),
  q('q-glossary', 'purpose', 'overview', 'Quels termes métier faut-il connaître ?', 'Which business terms must be known?',
    'Le code parle le vocabulaire du métier.', 'The code speaks the business vocabulary.'),
  q('q-upstream', 'context', 'interfaces', 'Qui appelle ce repo (API exposées, applications, événements) ?', 'Who calls this repository (exposed APIs, apps, events)?',
    'Casser une API casse ses appelants.', 'Breaking an API breaks its callers.'),
  q('q-downstream', 'context', 'interfaces', 'Quels systèmes ce repo appelle-t-il ?', 'Which systems does this repository call?',
    'Les pannes et les accès viennent souvent de là.', 'Outages and access requests often come from there.'),
  q('q-data', 'context', 'architecture', 'Quelles données possède-t-il, et où sont-elles stockées ?', 'Which data does it own, and where is it stored?',
    'Le modèle de données est la colonne vertébrale du code.', 'The data model is the backbone of the code.'),
  q('q-auth', 'context', 'interfaces', 'Comment fonctionnent l’authentification et les droits ?', 'How do authentication and permissions work?',
    'Les droits manquants bloquent le premier jour.', 'Missing permissions block day one.'),
  q('q-modules', 'architecture', 'architecture', 'Quels sont les modules et le rôle de chacun ?', 'What are the modules and the role of each?',
    'C’est la carte pour s’orienter.', 'It is the map to find your way.'),
  q('q-flows', 'architecture', 'architecture', 'Quels sont les 2 ou 3 flux principaux, de bout en bout ?', 'What are the 2 or 3 main flows, end to end?',
    'Un flux suivi en entier vaut dix fichiers lus.', 'One flow followed end to end is worth ten files read.'),
  q('q-stack', 'architecture', 'architecture', 'Quelle stack, et quelles versions ?', 'Which stack, and which versions?',
    'Elle dicte les outils à installer et la doc à lire.', 'It dictates the tools to install and the docs to read.'),
  q('q-decisions', 'architecture', 'architecture', 'Quels choix d’architecture importants, et pourquoi ?', 'Which important architecture choices, and why?',
    'Évite de « corriger » un choix volontaire.', 'Avoids "fixing" a deliberate choice.'),
  q('q-prereqs', 'local', 'start', 'De quoi ai-je besoin avant de commencer (outils, accès, droits) ?', 'What do I need before starting (tools, access, permissions)?',
    'Les accès prennent souvent plusieurs jours : à demander tout de suite.', 'Access often takes days: ask for it right away.'),
  q('q-run-local', 'local', 'start', 'Comment le lancer en local ?', 'How do I run it locally?',
    'La première étape de tout travail.', 'The first step of any work.'),
  q('q-test', 'local', 'start', 'Comment lancer les tests ?', 'How do I run the tests?',
    'Pour savoir si on a cassé quelque chose.', 'To know whether something broke.'),
  q('q-config', 'local', 'delivery', 'Quelle configuration faut-il (variables, destinations, secrets) ?', 'Which configuration is needed (variables, destinations, secrets)?',
    'Sans elle, rien ne démarre.', 'Without it, nothing starts.'),
  q('q-debug', 'local', 'start', 'Comment déboguer, et où sont les logs ?', 'How do I debug, and where are the logs?',
    'Le premier bug arrive vite.', 'The first bug comes quickly.'),
  q('q-envs', 'deliver', 'delivery', 'Quels environnements existent ?', 'Which environments exist?',
    'Savoir où l’on teste et où l’on ne touche pas.', 'Know where to test and where not to touch.'),
  q('q-deploy', 'deliver', 'delivery', 'Comment est-il déployé, et par qui ?', 'How is it deployed, and by whom?',
    'Un changement n’existe qu’une fois livré.', 'A change only exists once delivered.'),
  q('q-ci', 'deliver', 'delivery', 'Que vérifie la CI ?', 'What does CI check?',
    'Pour ne pas découvrir les règles au moment de la revue.', 'So the rules are not discovered at review time.'),
  q('q-monitor', 'deliver', 'delivery', 'Comment voir s’il va bien en production ?', 'How do I see whether it is healthy in production?',
    'Pour réagir quand ça casse.', 'To react when it breaks.'),
  q('q-where', 'work', 'codemap', 'Où modifier quoi pour les changements courants ?', 'Where do common changes go?',
    'Le raccourci le plus utile pour un premier ticket.', 'The most useful shortcut for a first ticket.'),
  q('q-conventions', 'work', 'codemap', 'Quelles conventions suivre (code, branches, commits, revues) ?', 'Which conventions to follow (code, branches, commits, reviews)?',
    'Une revue rejetée pour la forme coûte cher.', 'A review rejected for form is costly.'),
  q('q-people', 'work', 'codemap', 'Qui connaît ce repo, à qui demander ?', 'Who knows this repository, whom to ask?',
    'La bonne personne fait gagner des heures.', 'The right person saves hours.'),
  q('q-pitfalls', 'work', 'codemap', 'Quels pièges et zones fragiles ?', 'Which traps and fragile areas?',
    'Là où les nouveaux cassent le plus.', 'Where newcomers break things most.'),
];

export const THEMES: readonly { readonly id: Theme; readonly label: Localized; readonly emoji: string }[] = [
  { id: 'purpose', emoji: '🎯', label: { fr: 'Le pourquoi', en: 'The why' } },
  { id: 'context', emoji: '🌐', label: { fr: 'Le contexte', en: 'The context' } },
  { id: 'architecture', emoji: '🏗️', label: { fr: 'L’architecture', en: 'The architecture' } },
  { id: 'local', emoji: '💻', label: { fr: 'Travailler en local', en: 'Working locally' } },
  { id: 'deliver', emoji: '🚀', label: { fr: 'Livrer et exploiter', en: 'Deliver and run' } },
  { id: 'work', emoji: '🛠️', label: { fr: 'Travailler dessus', en: 'Working on it' } },
];

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((x) => x.id === id);
}

/**
 * What the scan already offers for each question: places to read, not answers.
 * "hinted": the repository holds material for it; "needs-reading": the answer
 * is in code that must be read; "unknown": nothing points to an answer, ask.
 */
export function questionHints(map: Omit<RepoMap, 'questions'>): QuestionHint[] {
  const readme = map.docs.find((d) => d.kind === 'readme' && !d.path.includes('/'));
  const readmeEv: Evidence[] = readme ? [{ file: readme.path, line: 1, text: readme.title ?? readme.path }] : [];
  const docEv = (re: RegExp) => map.docs.filter((d) => re.test(d.path) || d.headings.some((h) => re.test(h)) || (d.title ? re.test(d.title) : false)).slice(0, 4).map((d) => ({ file: d.path, line: 1, text: d.title ?? d.path }));
  const cmd = (kinds: readonly string[]) => map.commands.filter((c) => kinds.includes(c.kind)).slice(0, 5).map((c) => c.evidence);
  const has = (ids: readonly string[]) => map.stack.filter((s) => ids.includes(s.id)).flatMap((s) => s.evidence.slice(0, 1));
  const hint = (id: string, evidence: readonly Evidence[], fallback: QuestionStatus = 'needs-reading', note?: string): QuestionHint => {
    const question = questionById(id)!;
    return { id, theme: question.theme, status: evidence.length ? 'hinted' : fallback, hints: evidence.slice(0, 6), ...(note ? { note } : {}) };
  };
  const pkgDesc: Evidence[] = map.repo.description ? readmeEv : [];
  return [
    hint('q-purpose', [...pkgDesc, ...readmeEv].slice(0, 2), 'needs-reading'),
    hint('q-users', [...map.provides.filter((p) => p.kind === 'ui-app').map((p) => p.evidence), ...docEv(/user|utilisateur|persona|role/i)], 'unknown'),
    hint('q-scope', docEv(/scope|périmètre|perimetre|out of scope|hors|limitation/i), 'unknown'),
    hint('q-glossary', [...map.glossary.slice(0, 6).map((t) => ({ file: t.where[0] ?? '', line: 1, text: t.term })), ...docEv(/glossa|terms|vocab/i)].filter((e) => e.file), 'needs-reading'),
    hint('q-upstream', map.provides.slice(0, 6).map((p) => p.evidence), 'unknown'),
    hint('q-downstream', map.consumes.filter((c) => c.kind !== 'package' && c.detail !== 'local').slice(0, 6).map((c) => c.evidence), 'unknown'),
    hint('q-data', [...map.entities.slice(0, 4).map((e) => e.evidence), ...map.consumes.filter((c) => c.kind === 'database').map((c) => c.evidence)], 'needs-reading'),
    hint('q-auth', [...map.consumes.filter((c) => c.kind === 'auth').map((c) => c.evidence), ...has(['sap-xsuaa', 'auth-lib']), ...docEv(/auth|sécurité|securit|role|droit/i)], 'unknown'),
    hint('q-modules', map.modules.filter((m) => m.path !== '.').slice(0, 6).map((m) => ({ file: m.readme ?? m.path, line: 1, text: `${m.path}${m.role ? ` (${m.role})` : ''}` })), 'needs-reading'),
    hint('q-flows', [...map.central.slice(0, 3).map((c) => ({ file: c.path, line: 1, text: `imported by ${c.importedBy} files` })), ...map.provides.filter((p) => p.kind === 'cds-service' || p.kind === 'http-route').slice(0, 3).map((p) => p.evidence)], 'needs-reading'),
    hint('q-stack', map.stack.slice(0, 6).flatMap((s) => s.evidence.slice(0, 1)), 'needs-reading'),
    hint('q-decisions', [...map.docs.filter((d) => d.kind === 'adr').slice(0, 5).map((d) => ({ file: d.path, line: 1, text: d.title ?? d.path })), ...docEv(/decision|architecture|design|choix/i)], 'unknown'),
    hint('q-prereqs', [...docEv(/prerequi|prérequi|requirement|getting started|setup|installation|installer/i), ...has(['node', 'java-maven', 'python', 'go', 'dotnet'])], 'needs-reading'),
    hint('q-run-local', [...cmd(['start', 'dev']), ...docEv(/run|start|lancer|démarrer|local|getting started/i)], 'unknown'),
    hint('q-test', [...cmd(['test']), ...map.docs.filter((d) => d.headings.some((h) => /test/i.test(h))).slice(0, 2).map((d) => ({ file: d.path, line: 1, text: d.title ?? d.path }))], 'unknown'),
    hint('q-config', [...map.env.slice(0, 4).flatMap((e) => e.evidence.slice(0, 1)), ...map.consumes.filter((c) => c.kind === 'destination').slice(0, 2).map((c) => c.evidence), ...map.configFiles.slice(0, 2).map((f) => ({ file: f, line: 1, text: f }))], 'unknown'),
    hint('q-debug', [...docEv(/debug|log|troubleshoot|dépann|diagnost/i), ...has(['logging', 'sap-logging', 'otel'])], 'unknown'),
    hint('q-envs', map.environments.slice(0, 5).flatMap((e) => e.evidence.slice(0, 1)), 'unknown'),
    hint('q-deploy', [...cmd(['deploy']), ...map.ci.slice(0, 2).map((c) => ({ file: c.path, line: 1, text: c.system })), ...has(['sap-mta', 'cloud-foundry', 'helm', 'kubernetes', 'docker'])], 'unknown'),
    hint('q-ci', map.ci.slice(0, 4).map((c) => ({ file: c.path, line: 1, text: `${c.system}: ${c.stages.join(', ')}` })), 'unknown'),
    hint('q-monitor', [...has(['sap-logging', 'otel', 'logging', 'sap-audit']), ...docEv(/monitor|alert|observab|supervision|kibana|grafana|dynatrace/i)], 'unknown'),
    hint('q-where', [...map.central.slice(0, 3).map((c) => ({ file: c.path, line: 1, text: `imported by ${c.importedBy} files` })), ...map.hotspots.slice(0, 3).map((h) => ({ file: h.path, line: 1, text: `${h.changes} changes in a year` }))], 'needs-reading'),
    hint('q-conventions', [...docEv(/contribut|convention|guideline|style|commit|branch|review/i), ...cmd(['lint'])], 'unknown'),
    hint('q-people', map.ownership.codeowners.slice(0, 4).map((o) => o.evidence), map.ownership.authors.length ? 'needs-reading' : 'unknown',
      map.ownership.authors.length ? `Git history: ${map.ownership.authors.slice(0, 3).map((a) => a.name).join(', ')}` : undefined),
    hint('q-pitfalls', map.risks.filter((r) => r.evidence && ['doc-drift', 'todo', 'large-file', 'secret-like', 'tracked-env'].includes(r.kind)).slice(0, 5).map((r) => r.evidence!), 'unknown'),
  ];
}
