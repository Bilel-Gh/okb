import type { OkbConfig } from '../config/schema.js';
import { invoke } from '../engine/registry.js';

/**
 * The routes of the 2.0's objects (projects, then actions and the journal):
 * each one only names an operation of the engine and builds its input, so the
 * app, the terminal and the assistants share one behaviour (F2.0-17).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KbConfig = (ctx: any, kb: unknown) => Promise<OkbConfig>;
type Body = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (ctx: any, q: URLSearchParams, b: Body) => Promise<unknown>;

const pick = (b: Body, keys: readonly string[]): Body => Object.fromEntries(keys.filter((k) => b[k] !== undefined && b[k] !== null).map((k) => [k, b[k]]));
const fromQuery = (q: URLSearchParams, keys: readonly string[]): Body => Object.fromEntries(keys.filter((k) => q.get(k)).map((k) => [k, q.get(k)!]));

export function engineRoutes(kbConfig: KbConfig): Record<string, Handler> {
  const op = (id: string, input: (q: URLSearchParams, b: Body) => unknown): Handler => async (ctx, q, b) =>
    invoke(id, input(q, b), { config: await kbConfig(ctx, q.get('kb') ?? b.kb), env: ctx.env, actor: 'person' });
  return {
    'GET /api/projects': op('projects.list', (q) => fromQuery(q, ['status', 'kind'])),
    'GET /api/project': op('projects.get', (q) => fromQuery(q, ['id'])),
    'POST /api/projects': op('projects.create', (_q, b) => pick(b, ['title', 'where', 'next', 'folder'])),
    'POST /api/project/update': op('projects.update', (_q, b) => pick(b, ['id', 'title', 'status', 'where', 'next'])),
    'POST /api/project/leave': op('projects.leave', (_q, b) => pick(b, ['id', 'done', 'tried', 'waiting', 'resume'])),
    'GET /api/today': op('today.view', () => ({})),
    'GET /api/actions': op('actions.list', (q) => fromQuery(q, ['project', 'status', 'kind'])),
    'GET /api/actions/detect': op('actions.detect', (q) => ({ text: q.get('text') ?? '' })),
    'POST /api/actions': op('actions.add', (_q, b) => pick(b, ['text', 'kind', 'project', 'who', 'due'])),
    'POST /api/action/update': op('actions.update', (_q, b) => pick(b, ['id', 'status', 'text', 'who', 'due'])),
    'GET /api/entries': op('journal.list', (q) => ({ ...fromQuery(q, ['project', 'day']), ...(q.get('limit') ? { limit: Number(q.get('limit')) } : {}) })),
    'POST /api/entries': op('journal.add', (_q, b) => pick(b, ['text', 'kind', 'project'])),
  };
}
