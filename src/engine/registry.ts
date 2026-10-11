import { enabledModules, moduleDef } from '../modules/catalog.js';
import { reposList } from '../repo/operations.js';
import { OkbError } from '../util/errors.js';
import { documentsAdd, documentsList, documentsUpdate } from './ops/documents.js';
import { kbStatus } from './ops/kb.js';
import { notesFind, notesRead } from './ops/notes.js';
import { actionsAdd, actionsDetect, actionsList, actionsUpdate, journalAdd, journalList } from './ops/actions.js';
import { projectsCreate, projectsGet, projectsLeave, projectsList, projectsUpdate } from './ops/projects.js';
import { suggestionsAdd, suggestionsList } from './ops/suggestions.js';
import { todayViewOp } from './ops/today.js';
import type { Operation, OpContext } from './operation.js';

export { jsonSchemaOf } from './schema.js';
export type { Actor, Effect, OpContext, Operation } from './operation.js';

/** Every operation of the engine, the core's then each module's. */
const OPS = {
  'notes.find': notesFind,
  'notes.read': notesRead,
  'kb.status': kbStatus,
  'suggestions.list': suggestionsList,
  'suggestions.add': suggestionsAdd,
  'projects.list': projectsList,
  'projects.get': projectsGet,
  'projects.create': projectsCreate,
  'projects.update': projectsUpdate,
  'projects.leave': projectsLeave,
  'actions.add': actionsAdd,
  'actions.list': actionsList,
  'actions.update': actionsUpdate,
  'actions.detect': actionsDetect,
  'journal.add': journalAdd,
  'journal.list': journalList,
  'today.view': todayViewOp,
  'documents.add': documentsAdd,
  'documents.list': documentsList,
  'documents.update': documentsUpdate,
  'repos.list': reposList,
} as const;

export type OpId = keyof typeof OPS;
type OutputOf<K extends OpId> = Awaited<ReturnType<(typeof OPS)[K]['run']>>;

/** An operation of any input: its input is checked by its own schema before it runs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOperation = Operation<any, unknown>;

export const OPERATIONS: readonly AnyOperation[] = Object.values(OPS);

export function operation(id: string): AnyOperation | undefined {
  return (OPS as Record<string, AnyOperation>)[id];
}

/** The operations of the modules in use: what the assistants see and the app may call. */
export async function available(env: NodeJS.ProcessEnv = process.env): Promise<AnyOperation[]> {
  const on = await enabledModules(env);
  return OPERATIONS.filter((o) => on.has(o.module));
}

/**
 * Run an operation: refused when its module is off, its input validated
 * (an invalid input never reaches the operation), then run.
 */
export async function invoke<K extends OpId>(id: K, input: unknown, ctx: OpContext): Promise<OutputOf<K>>;
export async function invoke(id: string, input: unknown, ctx: OpContext): Promise<unknown>;
export async function invoke(id: string, input: unknown, ctx: OpContext): Promise<unknown> {
  const op = operation(id);
  if (!op) throw new OkbError('E_NOT_FOUND', `no operation "${id}"`, { key: 'operationUnknown', params: { id } });
  if (!(await enabledModules(ctx.env)).has(op.module)) {
    const name = moduleDef(op.module)?.id ?? op.module;
    throw new OkbError('E_CONFIG', `module ${name} is turned off`, { key: 'moduleOff', params: { id: name }, hint: `okb modules on ${name}` });
  }
  const parsed = op.input.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = issue.path.join('.') || '(input)';
    throw new OkbError('E_INVALID', `${id}: ${field}: ${issue.message}`, { key: 'invalidInput', params: { field, problem: issue.message }, detail: { issues: parsed.error.issues } });
  }
  return op.run(ctx, parsed.data);
}
