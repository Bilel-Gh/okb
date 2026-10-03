/**
 * Fixed words the product writes into notes. The prose is Claude's; these are
 * the only strings the renderer owns, so they follow the style language too.
 * Languages without a table fall back to English labels.
 */
export type Labels = {
  readonly notice: string;
  readonly inferred: string;
  readonly corrections: string;
  readonly openQuestions: string;
  readonly analogy: string;
  readonly limit: string;
  readonly example: string;
  readonly diagram: string;
  readonly readFirst: string;
  readonly goingFurther: string;
  readonly sourceId: string;
  readonly startHere: string;
  readonly seeAlso: string;
};

const FR: Labels = {
  notice: 'Source rapportée ; les déductions sont signalées. Aucune vérification technique automatique.',
  inferred: 'Déduction :',
  corrections: 'Corrections et exceptions',
  openQuestions: 'Questions ouvertes',
  analogy: 'Analogie',
  limit: 'Limite de l’analogie :',
  example: 'Exemple',
  diagram: 'Schéma',
  readFirst: 'À lire avant :',
  goingFurther: 'Pour aller plus loin',
  sourceId: 'Source ID',
  startHere: 'Commencer ici',
  seeAlso: 'Voir aussi',
};

const EN: Labels = {
  notice: 'Reported by the source; deductions are marked. No automatic technical verification.',
  inferred: 'Deduction:',
  corrections: 'Corrections and exceptions',
  openQuestions: 'Open questions',
  analogy: 'Analogy',
  limit: 'Where the analogy stops:',
  example: 'Example',
  diagram: 'Diagram',
  readFirst: 'Read first:',
  goingFurther: 'Going further',
  sourceId: 'Source ID',
  startHere: 'Start here',
  seeAlso: 'See also',
};

export function labelsFor(language: string): Labels {
  return language.toLowerCase().startsWith('fr') ? FR : EN;
}

/** Landmark emojis sit in front of fixed labels only — never inside facts or code. */
export const LANDMARKS = {
  notice: 'ℹ️',
  analogy: '🧭',
  example: '💡',
  diagram: '🗺️',
  readFirst: '📚',
  goingFurther: '➡️',
  corrections: '⚠️',
  openQuestions: '❓',
  seeAlso: '🔗',
} as const;
