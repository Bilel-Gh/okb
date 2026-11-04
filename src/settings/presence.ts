import { readRootConfig } from '../kb/registry.js';

/**
 * How present OKB is while the person works with an assistant (D76).
 *
 * - `quiet` (default): OKB works in the background. It gives the assistant a
 *   short brief at the start of a session and answers when asked, but never
 *   offers a command, a card or a check during the work. What it spots is kept
 *   without a word and waits in the app.
 * - `assist`: the 2.4 behaviour — commands offered from the person's words,
 *   cards at the end of a session, announcements of todos and notes.
 *
 * One knob for the whole machine: the person sets it, never an assistant.
 */
export type Presence = 'quiet' | 'assist';

export async function presenceOf(env: NodeJS.ProcessEnv = process.env): Promise<Presence> {
  const root = await readRootConfig(env).catch(() => ({}) as Record<string, unknown>);
  return root.presence === 'assist' ? 'assist' : 'quiet';
}
