export const TICKET_STATES = {
  work: ['unknown', 'in-progress', 'done'],
  pr: ['unknown', 'not-open', 'draft', 'open', 'review', 'approved', 'changes-requested', 'merged', 'closed'],
  checks: ['unknown', 'pending', 'passed', 'failed'],
  waiting: ['unknown', 'none', 'waiting', 'blocked'],
  delivery: ['unknown', 'pending', 'deployed', 'verified', 'failed'],
} as const;
export type TicketDimension = keyof typeof TICKET_STATES;
export type TicketRecord = {
  ref: string; title: string; status: 'active' | 'done'; updatedAt: string; startedAt: string;
  repos: { id: string; branch: string | null }[];
  journal: { at: string; kind: string; text: string; repo?: string; sha?: string }[];
};
export type TicketState = { dimension: TicketDimension; environment: string | null; status: string; source: 'person' | 'agent' | 'github' | 'jira'; at: string | null; detail: string; url: string | null };
export type TicketCriterion = { id: string; kind: 'tests' | 'documentation' | 'acceptance' | 'confirmation' | 'other'; text: string; required: boolean; status: 'unknown' | 'pending' | 'met' | 'waived'; at: string };
export type TicketAttempt = { id: string; approach: string; conditions: string; result: string; next: string; at: string };
export type TicketView = {
  ticket: TicketRecord;
  brief: { goal: string; lastAction: string; next: string; failed: TicketAttempt[] };
  detail: {
    goal: string; lastAction: string; next: string; states: TicketState[]; criteria: TicketCriterion[]; attempts: TicketAttempt[];
    reuses: { id: string; path: string; title: string; sha256: string; why: string; at: string }[];
    external: null | { provider: 'github' | 'jira'; declared: boolean; observedAt: string; url: string; status: string; title?: string; issue?: string; repository?: string; number?: number };
    close: { allowed: boolean; missing: string[] };
  };
};
export type GithubPermission = { enabled: boolean; host: string; repositories: string[] };
export const DIMENSION_WORDS = {
  work: ['Travail', 'Work'], pr: ['PR et revue', 'PR and review'], checks: ['Vérifications CI', 'CI checks'], waiting: ['Attente', 'Waiting'], delivery: ['Livraison', 'Delivery'],
} as const;
export const STATE_WORDS: Record<string, readonly [string, string]> = {
  unknown: ['Inconnu', 'Unknown'], 'in-progress': ['En cours', 'In progress'], done: ['Travail terminé', 'Work done'],
  'not-open': ['Pas ouverte', 'Not open'], draft: ['Brouillon', 'Draft'], open: ['Ouverte', 'Open'], review: ['En revue', 'In review'], approved: ['Approuvée', 'Approved'],
  'changes-requested': ['Modifications demandées', 'Changes requested'], merged: ['Fusionnée', 'Merged'], closed: ['Fermée', 'Closed'],
  pending: ['En attente', 'Pending'], passed: ['Réussies', 'Passed'], failed: ['Échec', 'Failed'], none: ['Aucune attente', 'No waiting'], waiting: ['En attente', 'Waiting'], blocked: ['Bloqué', 'Blocked'],
  deployed: ['Déployée', 'Deployed'], verified: ['Vérifiée', 'Verified'],
};
export const CRITERION_WORDS = { tests: ['Tests', 'Tests'], documentation: ['Documentation', 'Documentation'], acceptance: ['Recette', 'Acceptance'], confirmation: ['Confirmation', 'Confirmation'], other: ['Autre', 'Other'] } as const;
