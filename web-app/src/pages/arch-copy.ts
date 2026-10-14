import { useT } from '../app/i18n';
const words = {
  fr: {
    intro: (name: string) => `Le plan de ${name}, calculé depuis le code, sans IA. Choisis un repo ou une relation pour retrouver son contexte et les indices dans le code.`,
    low: (score: number) => `Le contrôle de structure signale des points à vérifier (${score}/100) :`,
    flowHidden: (n: number) => `${n} relations restent à afficher dans ce parcours. Toutes figurent dans la liste ci-dessous.`, moreFlow: 'Afficher les 12 relations suivantes',
    focus: 'Repo à explorer', relations: 'Relations', allRelations: 'Toutes les relations', focusedRelations: 'Autour du repo choisi',
    hidden: (n: number, e: number, neighbours: number) => `${n} éléments et ${e} relations hors du dessin${neighbours ? `, dont ${neighbours} voisins directs` : ''}. Ils restent accessibles ci-dessous.`,
    group: { repo: 'Repos masqués', datastore: 'Bases masquées', external: 'Systèmes externes masqués', system: 'Groupes masqués' },
    expand: { repo: 'Afficher les repos masqués', datastore: 'Afficher les bases masquées', external: 'Afficher les systèmes externes masqués', system: 'Afficher les groupes masqués' },
    reset: 'Revenir au contexte initial', sourceCount: (n: number) => `${n} repères dans le code`,
    structure: 'Contrôle de structure', structureWhy: 'Preuves présentes, noms et verbes. Ce contrôle ne prouve ni le comportement en exécution ni la vérité de chaque relation.',
    modelWhy: 'Scan statique : les chemins et méthodes trouvés sont des indices, à vérifier dans les fichiers cités. Les relations incertaines portent un point d’interrogation.',
    flowWhy: 'Parcours des dépendances possibles depuis cet appel. Le scan ne prouve pas leur ordre d’exécution ni qu’une route déclenche tous ces appels.',
    noRelations: 'Aucune relation trouvée dans ce contexte.',
  },
  en: {
    intro: (name: string) => `The map of ${name}, computed from code without AI. Choose a repository or a relation to see its context and code evidence.`,
    low: (score: number) => `The structure check found points to review (${score}/100):`,
    flowHidden: (n: number) => `${n} relations remain to display in this flow. All are in the list below.`, moreFlow: 'Show the next 12 relations',
    focus: 'Repository to explore', relations: 'Relations', allRelations: 'All relations', focusedRelations: 'Around the selected repository',
    hidden: (n: number, e: number, neighbours: number) => `${n} elements and ${e} relations outside the drawing${neighbours ? `, including ${neighbours} direct neighbours` : ''}. They remain accessible below.`,
    group: { repo: 'Hidden repositories', datastore: 'Hidden databases', external: 'Hidden external systems', system: 'Hidden groups' },
    expand: { repo: 'Show hidden repositories', datastore: 'Show hidden databases', external: 'Show hidden external systems', system: 'Show hidden groups' },
    reset: 'Return to the initial context', sourceCount: (n: number) => `${n} code locations`,
    structure: 'Structure check', structureWhy: 'Evidence present, names and verbs. This check does not prove runtime behaviour or that every relation is correct.',
    modelWhy: 'Static scan: detected paths and methods are clues to check in the cited files. Uncertain relations carry a question mark.',
    flowWhy: 'Possible dependencies reachable from this call. The scan does not prove their runtime order or that a route triggers every one of these calls.',
    noRelations: 'No relation found in this context.',
  },
};
export function useArchWords() { return words[useT().lang]; }
