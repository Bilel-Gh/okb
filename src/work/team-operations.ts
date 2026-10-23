import { z } from 'zod';
import { defineOperation, type OpContext } from '../engine/operation.js';
import { clearSubjectField, dismissSuggestion, markSubjectNotApplicable, ORIGINS, resolveSubjectConflict, setSubjectField, SUBJECT_KINDS, type Origin, type SubjectKind } from './sourced-fields.js';
import { OkbError } from '../util/errors.js';
import { cancelTeamRequest, closeTeamRequest, openTeamRequests, requestTeam, teamOf, teamProduct, teamPrompt, teamRepo } from './team.js';

/**
 * The team responsible for a repository or a product, as engine operations
 * (F2.4-19, F2.4-20, D73): the app, `okb team …` and MCP share them.
 */
const kind = z.enum(SUBJECT_KINDS);
const subject = z.string().trim().min(1).max(150);
const target = z.object({ kind, subject }).strict();
const requestId = z.string().regex(/^T-[a-z0-9]{6}$/);

/** The subject as stored: a repository by its registry id, a product by its name. */
async function resolved(ctx: OpContext, k: SubjectKind, s: string): Promise<string> {
  return k === 'repo' ? (await teamRepo(ctx.config, s, ctx.env)).id : teamProduct(ctx.config, s, ctx.env);
}
/** The person writes in their own name whatever origin they type; only an agent keeps a source's origin (D70). */
const originOf = (ctx: OpContext, o?: Origin): Origin => (ctx.actor === 'person' ? 'person' : o && o !== 'person' ? o : 'agent');

export const teamGet = defineOperation({
  id: 'team.get', module: 'dev', effect: 'read', summary: 'The team responsible for a repository or a product: value with origin, link and date, the product’s team a repository inherits, conflicts, the CODEOWNERS suggestion and the open request.',
  input: target, run: async (ctx, i) => {
    // A repository the map knows from its notes but nobody registered has no team to show: say so, not an error.
    if (i.kind === 'repo' && !(await teamRepo(ctx.config, i.subject, ctx.env).then(() => true, () => false)))
      return { kind: i.kind, subject: i.subject, value: null, inherited: null, notApplicable: null, conflicts: [], suggestion: null, request: null, registered: false };
    return { ...(await teamOf(ctx.config, i.kind, i.subject, ctx.env)), registered: true };
  },
});
export const teamSet = defineOperation({
  id: 'team.set', module: 'dev', effect: 'state', summary: 'Write the team responsible with its origin and link. A team the person wrote is never replaced: a different one is kept as a conflict. Never invent a team.',
  input: target.extend({ value: z.string().max(400), origin: z.enum(ORIGINS).optional(), url: z.string().max(1500).optional() }).strict(),
  run: async (ctx, i) => {
    const id = await resolved(ctx, i.kind, i.subject);
    const r = await setSubjectField(ctx.config, i.kind, id, { field: 'team', value: i.value, origin: originOf(ctx, i.origin), ...(i.url ? { url: i.url } : {}) });
    return { ...r, team: await teamOf(ctx.config, i.kind, id, ctx.env) };
  },
});
export const teamClear = defineOperation({
  id: 'team.clear', module: 'dev', effect: 'state', agents: false, summary: 'Empty the team responsible.',
  input: target, run: async (ctx, i) => { const id = await resolved(ctx, i.kind, i.subject); clearSubjectField(ctx.config, i.kind, id, 'team'); return teamOf(ctx.config, i.kind, id, ctx.env); },
});
export const teamNa = defineOperation({
  id: 'team.na', module: 'dev', effect: 'state', agents: false, summary: 'Say the team does not apply here, with the reason (a shared library without an owner).',
  input: target.extend({ reason: z.string().trim().min(1).max(300) }).strict(),
  run: async (ctx, i) => { const id = await resolved(ctx, i.kind, i.subject); markSubjectNotApplicable(ctx.config, i.kind, id, 'team', i.reason); return teamOf(ctx.config, i.kind, id, ctx.env); },
});
export const teamConflictResolve = defineOperation({
  id: 'team.conflict.resolve', module: 'dev', effect: 'state', agents: false, summary: 'The person settles a conflict on the team: keep theirs, or take the one from a source.',
  input: target.extend({ keep: z.enum(['mine', ...ORIGINS]) }).strict(),
  run: async (ctx, i) => { const id = await resolved(ctx, i.kind, i.subject); resolveSubjectConflict(ctx.config, i.kind, id, 'team', i.keep); return teamOf(ctx.config, i.kind, id, ctx.env); },
});
export const teamSuggestionDismiss = defineOperation({
  id: 'team.suggestion.dismiss', module: 'dev', effect: 'state', agents: false, summary: 'Turn down the team CODEOWNERS suggests; it does not come back.',
  input: target.extend({ value: z.string().trim().min(1).max(200) }).strict(),
  run: async (ctx, i) => { const id = await resolved(ctx, i.kind, i.subject); dismissSuggestion(ctx.config, i.kind, id, 'team', i.value); return teamOf(ctx.config, i.kind, id, ctx.env); },
});
export const teamRequestsCreate = defineOperation({
  id: 'team.requests.create', module: 'dev', effect: 'state', summary: 'Ask the agent to find the team responsible (Jira, ServiceNow, wiki through its own tools). One open request per repository or product.',
  input: target, run: async (ctx, i) => requestTeam(ctx.config, i.kind, await resolved(ctx, i.kind, i.subject)),
});
export const teamRequestsList = defineOperation({
  id: 'team.requests.list', module: 'dev', effect: 'read', summary: 'Open requests to find a team responsible.',
  input: z.object({ kind: kind.optional(), subject: subject.optional() }).strict(),
  run: async (ctx, i) => ({ requests: openTeamRequests(ctx.config, i) }),
});
export const teamRequestsClose = defineOperation({
  id: 'team.requests.close', module: 'dev', effect: 'state', summary: 'Report on a team request: found or not, which sources were read, which could not be. Never claim a source you could not read.',
  input: z.object({ id: requestId, found: z.array(z.string().max(60)).max(20).default([]), missing: z.array(z.string().max(60)).max(20).default([]), read: z.array(z.string().max(60)).max(20).default([]), unavailable: z.array(z.string().max(60)).max(20).default([]), note: z.string().max(1000).default('') }).strict(),
  run: async (ctx, { id, ...report }) => closeTeamRequest(ctx.config, id, report),
});
export const teamRequestsCancel = defineOperation({
  id: 'team.requests.cancel', module: 'dev', effect: 'state', agents: false, summary: 'Cancel an open team request.',
  input: z.object({ id: requestId }).strict(), run: async (ctx, i) => { cancelTeamRequest(ctx.config, i.id); return { ok: true }; },
});
export const teamRequestsPrompt = defineOperation({
  id: 'team.requests.prompt', module: 'dev', effect: 'read', summary: 'A prompt to paste in an agent session to find the team now.',
  input: z.object({ id: requestId, lang: z.enum(['fr', 'en']).default('fr') }).strict(),
  run: async (ctx, i) => {
    const req = openTeamRequests(ctx.config).find((r) => r.id === i.id);
    if (!req) throw new OkbError('E_NOT_FOUND', `no open request ${i.id}`, { key: 'ticketRequestUnknown' });
    return { prompt: teamPrompt(req, i.lang) };
  },
});
