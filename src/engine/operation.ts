import type { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import type { ModuleId } from '../modules/catalog.js';

/**
 * One engine (F2.0-17): an action of OKB written once, then called by the web
 * app, the CLI and the assistants (MCP) through `invoke` (registry.ts).
 *
 * - `read` reads only.
 * - `state` writes OKB's own state (a suggestion card, the journal), never a note.
 * - `propose` prepares a proposal; only the person approves it.
 *
 * Approving, applying and deciding on a card are not operations: they stay the
 * person's own acts, in the app and the terminal, with their own checks.
 */
export type Effect = 'read' | 'state' | 'propose';

/** Who asks: the person (app, terminal), or an agent (Claude through the CLI, an assistant through MCP). */
export type Actor = 'person' | 'agent';

export type OpContext = {
  readonly config: OkbConfig;
  readonly env: NodeJS.ProcessEnv;
  readonly actor: Actor;
};

export type Operation<I = unknown, O = unknown> = {
  readonly id: string;
  readonly module: ModuleId;
  readonly effect: Effect;
  /** One sentence for the assistants (the MCP tool description). */
  readonly summary: string;
  readonly input: z.ZodType<I, z.ZodTypeDef, unknown>;
  readonly run: (ctx: OpContext, input: I) => Promise<O>;
};

export function defineOperation<I, O>(op: Operation<I, O>): Operation<I, O> {
  return op;
}
