import { ticketId } from '../work/tickets.js';
import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { getDocument } from '../documents/documents.js';
import { invoke } from '../engine/registry.js';
import { openFile } from '../integrations/system.js';
import { renderMarkdown } from './render.js';

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

/** A ticket reference typed in the app (`#demo_4211`) is normalised here, where the modules meet (F2.0-25). */
function withWork<T extends Record<string, unknown>>(input: T): T {
  const ref = input.workRef;
  if (typeof ref !== 'string') return input;
  const bare = ref.trim().replace(/^#/, '');
  return { ...input, workRef: bare ? ticketId(bare) : null };
}

export function engineRoutes(kbConfig: KbConfig): Record<string, Handler> {
  const op = (id: string, input: (q: URLSearchParams, b: Body) => unknown): Handler => async (ctx, q, b) =>
    invoke(id, input(q, b), { config: await kbConfig(ctx, q.get('kb') ?? b.kb), env: ctx.env, actor: 'person' });
  return {
    'GET /api/tickets': op('tickets.list', () => ({})),
    'GET /api/ticket': op('tickets.get', (q) => fromQuery(q, ['ref'])),
    'POST /api/tickets/resume': op('tickets.resume', (_q, b) => pick(b, ['ref', 'repo', 'title', 'text', 'goal', 'lastAction', 'next', 'note', 'suggestion', 'context', 'decisions', 'attempts', 'criteria', 'sources', 'waiting'])),
    'POST /api/tickets/start': op('tickets.start', (_q, b) => pick(b, ['ref', 'repo', 'title', 'text'])),
    'GET /api/ticket/sheet': op('tickets.sheet', (q) => fromQuery(q, ['ref'])),
    'POST /api/ticket/field': op('tickets.field.set', (_q, b) => pick(b, ['ref', 'field', 'value', 'url'])),
    'POST /api/ticket/field/clear': op('tickets.field.clear', (_q, b) => pick(b, ['ref', 'field'])),
    'POST /api/ticket/field/na': op('tickets.field.na', (_q, b) => pick(b, ['ref', 'field', 'reason'])),
    'POST /api/ticket/conflict': op('tickets.conflict.resolve', (_q, b) => pick(b, ['ref', 'field', 'keep'])),
    'POST /api/ticket/rename': op('tickets.rename', (_q, b) => pick(b, ['ref', 'title'])),
    'POST /api/ticket/pin': op('tickets.pin', (_q, b) => pick(b, ['ref', 'pinned'])),
    'POST /api/ticket/source': op('tickets.source', (_q, b) => pick(b, ['ref', 'provider', 'url'])),
    'POST /api/ticket/repos/detach': op('tickets.repos.detach', (_q, b) => pick(b, ['ref', 'repo'])),
    'POST /api/ticket/unfollow': op('tickets.unfollow', (_q, b) => pick(b, ['ref'])),
    'POST /api/ticket/restore': op('tickets.restore', (_q, b) => pick(b, ['ref'])),
    'GET /api/ticket/links': op('tickets.links.list', (q) => fromQuery(q, ['ref'])),
    'POST /api/ticket/links': op('tickets.links.set', (_q, b) => pick(b, ['ref', 'path', 'state'])),
    'POST /api/ticket/links/scan': op('tickets.links.scan', () => ({})),
    'GET /api/ticket/requests': op('tickets.requests.list', (q) => fromQuery(q, ['ref', 'repo'])),
    'POST /api/ticket/requests': op('tickets.requests.create', (_q, b) => pick(b, ['ref', 'fields'])),
    'POST /api/ticket/requests/cancel': op('tickets.requests.cancel', (_q, b) => pick(b, ['id'])),
    'GET /api/ticket/requests/prompt': op('tickets.requests.prompt', (q) => fromQuery(q, ['id', 'lang'])),
    'POST /api/ticket/brief': op('tickets.brief', (_q, b) => pick(b, ['ref', 'goal', 'lastAction', 'next'])),
    'POST /api/ticket/state': op('tickets.state', (_q, b) => ({ ref: b.ref, state: pick(b, ['dimension', 'environment', 'status', 'detail', 'url']) })),
    'POST /api/ticket/criterion': op('tickets.criterion', (_q, b) => pick(b, ['ref', 'id', 'kind', 'text', 'required', 'status'])),
    'POST /api/ticket/attempt': op('tickets.attempt', (_q, b) => pick(b, ['ref', 'approach', 'conditions', 'result', 'next'])),
    'POST /api/ticket/reuse': op('tickets.reuse', (_q, b) => pick(b, ['ref', 'path', 'why'])),
    'POST /api/ticket/close': op('tickets.close', (_q, b) => pick(b, ['ref'])),
    'POST /api/ticket/github/config': op('tickets.github.configure', (_q, b) => pick(b, ['enabled', 'host', 'repositories', 'allowed'])),
    'GET /api/ticket/github/config': op('tickets.github.status', () => ({})),
    'POST /api/ticket/github': op('tickets.github', (_q, b) => pick(b, ['ref', 'repository', 'number'])),
    'POST /api/ticket/jira': op('tickets.jira', (_q, b) => pick(b, ['ref', 'issue', 'status', 'url', 'observedAt'])),
    'POST /api/space/export': op('space.export', (_q, b) => pick(b, ['folder'])),
    'GET /api/understanding/overview': op('understanding.overview', () => ({})),
    'GET /api/understanding/learning': op('understanding.learning', (q) => fromQuery(q, ['subject', 'path'])),
    'POST /api/understanding/read': op('understanding.read', (_q, b) => pick(b, ['path', 'mode', 'projectId'])),
    'POST /api/understanding/keep': op('understanding.keep', (_q, b) => pick(b, ['readingId'])),
    'POST /api/understanding/record': op('understanding.record', (_q, b) => pick(b, ['path', 'kind', 'point', 'projectId', 'eventId'])),
    'POST /api/understanding/readiness': op('understanding.readiness', (_q, b) => pick(b, ['path', 'answer'])),
    'POST /api/understanding/meeting': op('understanding.meeting', (_q, b) => pick(b, ['query', 'projectId'])),
    'POST /api/understanding/progress': op('understanding.progress', (_q, b) => pick(b, ['enabled'])),
    'POST /api/understanding/objective/add': op('understanding.objective.add', (_q, b) => pick(b, ['text', 'subject', 'by'])),
    'POST /api/understanding/objective/done': op('understanding.objective.done', (_q, b) => pick(b, ['id'])),
    'POST /api/understanding/review': op('understanding.review', (_q, b) => pick(b, ['id', 'rating'])),
    'GET /api/assistant/status': op('assistant.status', () => ({})),
    'POST /api/assistant/config': op('assistant.configure', (_q, b) => pick(b, ['agent'])),
    'GET /api/assistant/conversations': op('assistant.conversations', () => ({})),
    'POST /api/assistant/start': op('assistant.start', () => ({})),
    'GET /api/assistant/conversation': op('assistant.conversation', (q) => fromQuery(q, ['id'])),
    'POST /api/assistant/ask': op('assistant.ask', (_q, b) => pick(b, ['question', 'conversation', 'mode', 'project', 'work'])),
    'POST /api/assistant/cancel': op('assistant.cancel', (_q, b) => pick(b, ['conversation'])),
    'POST /api/assistant/end': op('assistant.end', (_q, b) => pick(b, ['conversation', 'later'])),
    'POST /api/assistant/action': op('assistant.action', (_q, b) => pick(b, ['conversation', 'message', 'index'])),
    'GET /api/projects': op('projects.list', (q) => fromQuery(q, ['status', 'kind'])),
    'GET /api/project': op('projects.get', (q) => fromQuery(q, ['id'])),
    'POST /api/projects': op('projects.create', (_q, b) => pick(b, ['title', 'where', 'next', 'folder'])),
    'POST /api/project/update': op('projects.update', (_q, b) => pick(b, ['id', 'title', 'status', 'where', 'next'])),
    'POST /api/project/leave': op('projects.leave', (_q, b) => pick(b, ['id', 'done', 'tried', 'waiting', 'resume'])),
    'GET /api/today': op('today.view', () => ({})),
    'GET /api/actions': op('actions.list', (q) => fromQuery(q, ['project', 'status', 'kind'])),
    'GET /api/actions/detect': op('actions.detect', (q) => ({ text: q.get('text') ?? '' })),
    'POST /api/actions': op('actions.add', (_q, b) => withWork(pick(b, ['text', 'kind', 'project', 'who', 'due', 'workRef', 'importance', 'pinned']))),
    'POST /api/action/update': op('actions.update', (_q, b) => withWork(pick(b, ['id', 'status', 'text', 'who', 'due', 'importance', 'pinned', 'workRef']))),
    'POST /api/action/delete': op('actions.delete', (_q, b) => pick(b, ['id'])),
    'GET /api/review': op('notes.review.list', () => ({})),
    'POST /api/review/check': op('notes.review.requestCheck', (_q, b) => pick(b, ['path'])),
    'GET /api/entries': op('journal.list', (q) => ({ ...fromQuery(q, ['project', 'day']), ...(q.get('limit') ? { limit: Number(q.get('limit')) } : {}) })),
    'POST /api/entries': op('journal.add', (_q, b) => pick(b, ['text', 'kind', 'project'])),
    'GET /api/documents': op('documents.list', (q) => ({ ...fromQuery(q, ['project', 'query']), ...(q.get('limit') ? { limit: Number(q.get('limit')) } : {}) })),
    'POST /api/documents': op('documents.add', (_q, b) => pick(b, ['name', 'data', 'title', 'project', 'note'])),
    'POST /api/document/update': op('documents.update', (_q, b) => ({ ...pick(b, ['id', 'title', 'note', 'secret']), ...(b.project !== undefined ? { project: b.project } : {}) })),
    'GET /api/evening': op('evening.view', () => ({})),
    'GET /api/backup/status': op('backup.status', () => ({})),
    'GET /api/indicators': op('indicators.view', () => ({})),
    'GET /api/day': op('day.view', (q) => ({ day: q.get('day') ?? '' })),
    'GET /api/share': op('share.status', () => ({})),
    'GET /api/share/preview': op('share.preview', () => ({})),
    'POST /api/share/setup': op('share.setup', (_q, b) => pick(b, ['folder', 'drawer', 'allowed'])),
    'POST /api/share/mark': op('share.mark', (_q, b) => pick(b, ['paths'])),
    'POST /api/share/unmark': op('share.unmark', (_q, b) => pick(b, ['paths'])),
    'POST /api/share/send': op('share.send', (_q, b) => pick(b, ['push', 'previewHash'])),
    'POST /api/share/receive': op('share.receive', () => ({})),
    'GET /api/shared/find': op('shared.find', (q) => ({ query: q.get('q') ?? '' })),
    'GET /api/shared/map': op('shared.map', () => ({})),
    'GET /api/shared/glossary': op('shared.glossary', () => ({})),
    'POST /api/shared/keep': op('shared.keep', (_q, b) => pick(b, ['drawer', 'path'])),
    // A colleague's note, rendered like one of the person's own: it is text to read, nothing in it runs.
    'GET /api/shared/note': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const note = await invoke('shared.read', { drawer: q.get('drawer') ?? '', path: q.get('path') ?? '' }, { config, env: ctx.env, actor: 'person' });
      return { ...note, html: await renderMarkdown(note.markdown, note.path) };
    },
    'GET /api/baggage/draft': op('baggage.draft', (q) => ({ path: q.get('path') ?? '' })),
    'POST /api/baggage/keep': op('baggage.keep', (_q, b) => pick(b, ['path', 'text', 'title'])),
    // Open the file itself, with the application the computer uses for it.
    'POST /api/document/open': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const doc = getDocument(config, String(b.id ?? ''));
      const file = resolve(config.kb.root, doc.path);
      // When nothing could open it, the page says where the file is.
      return { ok: await openFile(file, ctx.env), file };
    },
  };
}
