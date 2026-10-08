export type OkbSnapshot = {
  ui: 'fr' | 'en';
  line: string;
  profile: string;
  name: string;
  focus: { exists: boolean; ageDays: number | null; stale: boolean };
  next: string | null;
  inbox: number;
  pending: { number: number | null; title: string; files: number }[];
  notes: number;
  /** Suggestion cards waiting for the person's decision. */
  suggestions: number;
  /** Review cards due now. */
  due: number;
  /** The repository and ticket OKB is narrowed to, if any. */
  scope: { repo: string | null; ticket: string | null } | null;
};

declare module 'claude-code' {
  interface PluginState {
    okb: { snapshot: OkbSnapshot | null; pendingSeen: number };
  }
}
