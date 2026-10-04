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
};

declare module 'claude-code' {
  interface PluginState {
    okb: { snapshot: OkbSnapshot | null; pendingSeen: number };
  }
}
