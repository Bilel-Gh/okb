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
  next?: string; waiting?: { status: string; detail: string } | null;
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

/* ------------------------------------------------ the sheet (F2.4-08..14, D70) */
export type Origin = 'person' | 'agent' | 'jira' | 'servicenow' | 'wiki' | 'github' | 'other';
export type FieldName = 'title' | 'summary' | 'description' | 'sourceStatus' | 'team' | 'product' | 'done' | 'blocker';
export type FieldValue = { field: FieldName; value: string; origin: Origin; url: string | null; at: string; manual: boolean };
export type FieldConflict = { field: FieldName; value: string; origin: Origin; url: string | null; at: string };
export type Importance = 'low' | 'medium' | 'high';
export type SheetAction = { id: string; text: string; status: 'open' | 'done' | 'dropped'; importance: Importance; pinned: boolean; source: 'person' | 'ai'; createdAt: string; doneAt: string | null; workRef: string | null };
export type JourneyStep = { id: 'understood' | 'work' | 'pr' | 'checks' | 'delivery'; state: 'done' | 'now' | 'wait' | 'unknown'; label: string; source: string | null; at: string | null };
export type TicketLink = { path: string; noteId: string | null; title: string | null; state: 'confirmed' | 'suggested' | 'dismissed'; origin: Origin; at: string; why: 'metadata' | 'folder' | 'mention' | 'manual'; missing: boolean };
export type TicketRequest = { id: string; ref: string; fields: string[]; state: string; createdAt: string; closedAt: string | null };
export type TicketSheet = {
  ref: string; followed: true; status: 'active' | 'done'; title: FieldValue | null;
  fields: Partial<Record<FieldName, FieldValue>>; notApplicable: Partial<Record<string, string>>; conflicts: FieldConflict[];
  next: SheetAction | null; todos: SheetAction[];
  completeness: { percent: number; present: string[]; missing: string[]; notApplicable: string[] };
  journey: JourneyStep[]; links: TicketLink[]; requests: TicketRequest[];
  criteria: TicketCriterion[]; states: TicketState[]; attempts: TicketAttempt[];
  external: null | { provider: string; url: string; status?: string };
  repos: { id: string; branch: string | null }[]; pinned: boolean;
  history: { at: string; kind: string; text: string }[];
  close: { allowed: boolean; missing: string[] };
};
export type DocumentedSheet = { ref: string; followed: false; links: TicketLink[] };
export const ORIGIN_WORDS: Record<Origin, readonly [string, string]> = {
  person: ['toi', 'you'], agent: ['agent', 'agent'], jira: ['Jira', 'Jira'], servicenow: ['ServiceNow', 'ServiceNow'], wiki: ['wiki', 'wiki'], github: ['GitHub', 'GitHub'], other: ['autre source', 'other source'],
};
export const RUBRIC_WORDS: Record<string, readonly [string, string]> = {
  title: ['Titre', 'Title'], summary: ['Le problème', 'The problem'], description: ['Description', 'Description'], criteria: ['Critères', 'Criteria'], sourceStatus: ['Statut source', 'Source status'],
  teamProduct: ['Équipe et produit', 'Team and product'], team: ['Équipe', 'Team'], product: ['Produit', 'Product'], done: ['Déjà fait', 'Already done'], next: ['Prochaine étape', 'Next step'], blocker: ['Ce qui bloque', 'What blocks'], repo: ['Repo', 'Repository'],
};
