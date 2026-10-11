export const UNDERSTANDING_LEVELS = ['encountered', 'consulted', 'practiced', 'explained', 'reused'] as const;
export type UnderstandingLevel = typeof UNDERSTANDING_LEVELS[number];
export type UnderstandingKind = UnderstandingLevel | 'unclear' | 'resolved';
export type UnderstandingEvent = { id: string; path: string; subject: string; kind: UnderstandingKind; point: string; projectId: string | null; at: string };
export type SubjectLevel = { path: string; subject: string; level: UnderstandingLevel | null; events: number; lastAt: string | null; evidence: UnderstandingEvent[] };
export type UnderstandingDebt = { id: string; path: string; subject: string; point: string; reason: 'unclear' | 'repeated'; encounters: number; since: string; minutes: number };
export type UnderstandingOverview = {
  subjects: SubjectLevel[]; graph: { nodes: { id: string; title: string; level: UnderstandingLevel | null }[]; edges: { source: string; target: string }[] }; debts: UnderstandingDebt[]; today: UnderstandingDebt | null; limitations: string[];
  progress: { enabled: boolean; private: true; xp: number; level: { level: number; from: number; to: number }; counts: { resolved: number; explained: number; reused: number }; badges: { id: string; count: number; tier: 'none' | 'bronze' | 'silver' | 'gold'; next: number | null }[] };
};
export type ReadingMode = 'auto' | 'simple' | 'technical' | 'short' | 'detailed' | 'project-example' | 'analogy';
export type UnderstandingSource = { path: string; title: string; hash: string; quote: string };
export type Reading = { id: string; path: string; title: string; subject: string; sourceHash: string; mode: Exclude<ReadingMode, 'auto'>; level: UnderstandingLevel | null; explanation: string; example: string; conditions: string[]; unclear: string[]; sources: UnderstandingSource[]; markdown: string; cached: boolean; tokens: number; estimated?: boolean; limitations: string[] };
export type Readiness = { grade: 'right' | 'partial' | 'wrong' | 'ungraded'; feedback: string; missing: string[]; sources: UnderstandingSource[]; tokens: number; estimated?: boolean; limitations: string[] };
export type MeetingBrief = { project: { id: string; title: string; where: string; next: string } | null; known: { path: string; title: string; description: string; sources: UnderstandingSource[] }[]; open: { id: string; text: string; kind: string; source: string }[]; questions: { text: string; source: { kind: 'action' | 'debt' | 'note'; id: string; path?: string } }[]; limitations: string[] };
export type LearningPathways = { pathways: { id: string; text: string; subject: string | null; by: string | null; doneAt: string | null; steps: { kind: 'consult' | 'explain' | 'review' | 'reuse'; path: string; title: string; done: boolean }[] }[]; limitations: string[] };
export const LEVEL_WORDS: Record<UnderstandingLevel, [string, string]> = { encountered: ['Rencontré', 'Encountered'], consulted: ['Consulté', 'Consulted'], practiced: ['Pratiqué', 'Practiced'], explained: ['Expliqué', 'Explained'], reused: ['Réutilisé', 'Reused'] };
export const READING_WORDS: Record<ReadingMode, [string, string]> = { auto: ['Adaptée à mes gestes enregistrés', 'Adapted to my recorded actions'], simple: ['Plus simple', 'Simpler'], technical: ['Plus technique', 'More technical'], short: ['Plus court', 'Shorter'], detailed: ['Plus détaillé', 'More detailed'], 'project-example': ['Un exemple de mes projets', 'An example from my projects'], analogy: ['Avec une analogie', 'With an analogy'] };
/** Retrying the same human gesture preserves its id; editing it creates a new gesture. */
export const understandingEventId = () => `ui:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
