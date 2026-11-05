import { z } from 'zod';
import { trackerOf } from './tracker.js';
import { resumeTicket } from './ticket-resume.js';
import { loadBundleFor } from '../kb/bundle.js';
import { findRepo, listRepos } from '../repo/registry.js';
import { isSecret } from '../security/confidential.js';
import { OkbError } from '../util/errors.js';
import { addAttempt, addCriterion, attemptSchema, briefSchema, criterionPatch, criterionSchema, recordReuse, setTicketState, stateSchema, ticketDetail, updateCriterion, updateTicketBrief } from './ticket-state.js';
import { configureGithub, githubInput, githubSetupInput, importJiraSnapshot, jiraInput, readGithubPr } from './ticket-external.js';
import { detachRepo, finishTicket, listTickets, loadTicket, pinTicket, renameTicket, restoreTicket, setSourceLink, startTicket, syncTicket, ticketId, unfollowTicket } from './tickets.js';
import { clearField, FIELDS, markNotApplicable, ORIGINS, readFields, resolveConflict, setField, type NaTarget, type Origin } from './ticket-fields.js';
import { documentedRefs, linksFor, scanLinks, setLink } from './ticket-links.js';
import { cancelRequest, closeRequest, openRequests, requestFields, requestPrompt } from './ticket-requests.js';
import { ticketSheet } from './ticket-sheet.js';
import { defineOperation, type OpContext } from '../engine/operation.js';

const ref = z.string().trim().min(1).max(100);
const refOnly = z.object({ ref }).strict();
function person(ctx: OpContext): void { if (ctx.actor !== 'person') throw new OkbError('E_NOT_APPROVED', 'this ticket action belongs to the person', { key: 'ticketPersonOnly' }); }
async function view(ctx: OpContext, ticketRef: string) {
  const result = await ticketDetail(ctx.config, ticketRef);
  if (ctx.actor === 'agent') {
    const bundle = await loadBundleFor(ctx.config);
    result.detail.reuses = result.detail.reuses.filter((r) => { const e = bundle.byPath.get(r.path as never); return Boolean(e && !isSecret(e.ext)); });
  }
  return result;
}

export const ticketsList = defineOperation({
  id: 'tickets.list', module: 'dev', effect: 'read', summary: 'Local tickets; done describes the work, not CI, review or delivery.',
  input: z.object({}).strict(), run: async ({ config }) => ({ tickets: await Promise.all((await listTickets(config)).map(async (ticket) => { const detail = await ticketDetail(config, ticket.ref); const { fields } = readFields(config, ticket.ref); return { ...ticket, next: detail.detail.next, waiting: detail.detail.states.find((s) => s.dimension === 'waiting') ?? null, tracker: trackerOf(ticket.ref, detail.detail.external), mission: (fields.summary?.value ?? fields.description?.value ?? detail.detail.goal ?? '').split('\n')[0]!.slice(0, 200), sheetTitle: fields.title?.value ?? null, pr: detail.detail.states.find((s) => s.dimension === 'pr')?.status ?? 'unknown' }; })) }),
});
export const ticketsGet = defineOperation({
  id: 'tickets.get', module: 'dev', effect: 'read', summary: 'Resume a ticket: goal, last action, failed attempts with conditions, next step, separate states and exit criteria.',
  input: refOnly,
  run: async (ctx, input) => {
    const r = await loadTicket(ctx.config, input.ref);
    if (r) await syncTicket(ctx.config, r, (await listRepos(ctx.env)).filter((x) => x.kb === ctx.config.profile.id));
    return view(ctx, input.ref);
  },
});
export const ticketsStart = defineOperation({
  id: 'tickets.start', module: 'dev', effect: 'state', summary: 'Start local ticket follow-up in one registered repository; no KB or external ticket is changed.',
  input: z.object({ ref, repo: z.string().min(1).max(150), title: z.string().trim().max(200).optional(), text: z.string().max(20_000).optional() }).strict(),
  run: async (ctx, input) => {
    const repo = await findRepo(input.repo, ctx.env);
    if (!repo || repo.kb !== ctx.config.profile.id) throw new OkbError('E_NOT_FOUND', 'no registered repository in this profile', { key: 'repoUnknown', params: { id: input.repo } });
    const { record, created, attached } = await startTicket(ctx.config, { ...input, repo, origin: ctx.actor === 'person' ? 'person' : 'agent' });
    return { ...(await view(ctx, record.ref)), created, attached };
  },
});
export const ticketsResume = defineOperation({
  id: 'tickets.resume', module: 'dev', effect: 'propose', summary: 'Find or reconstruct a ticket from its exact reference, authorized notes and local Git; preserve human facts and prepare at most one note proposal.',
  input: briefSchema.extend({ ref, repo: z.string().min(1).max(150), title: z.string().trim().max(200).optional(), text: z.string().max(20_000).optional(), base: z.string().max(200).optional(), note: z.string().max(500).optional(), suggestion: z.string().max(100).optional(), context: z.string().trim().max(2000).optional(), decisions: z.array(z.object({ text: z.string().trim().min(1).max(900), why: z.string().trim().min(1).max(900) }).strict()).max(30).optional(), attempts: z.array(attemptSchema.extend({ next: z.string().max(600).default('') })).max(30).optional(), criteria: z.array(criterionSchema).max(30).optional(), sources: z.array(z.string().trim().min(1).max(1000)).max(30).optional(), waiting: z.object({ status: z.enum(['waiting', 'blocked', 'none']), detail: z.string().max(1000) }).strict().optional() }).strict(),
  run: async (ctx, input) => {
    const repo = await findRepo(input.repo, ctx.env);
    if (!repo || repo.kb !== ctx.config.profile.id) throw new OkbError('E_NOT_FOUND', 'no registered repository in this profile', { key: 'repoUnknown', params: { id: input.repo } });
    return resumeTicket(ctx.config, { ...input, repo }, { agent: ctx.actor === 'agent' });
  },
});
export const ticketsBrief = defineOperation({
  id: 'tickets.brief', module: 'dev', effect: 'state', summary: 'Correct the local resume brief: goal, last action and next step.',
  input: briefSchema.extend({ ref }).strict(), run: async (ctx, { ref: r, ...patch }) => { await updateTicketBrief(ctx.config, r, patch, ctx.actor === 'person' ? 'person' : 'agent'); return view(ctx, r); },
});
export const ticketsState = defineOperation({
  id: 'tickets.state', module: 'dev', effect: 'state', summary: 'Declare one independent ticket state; only delivery needs an environment. Unknown is a real state.',
  input: z.object({ ref, state: stateSchema }).strict(),
  run: async (ctx, input) => {
    if (input.state.dimension === 'work' && input.state.status === 'done') person(ctx);
    await setTicketState(ctx.config, input.ref, input.state, ctx.actor); return view(ctx, input.ref);
  },
});
const criterionInput = z.object({ ref, id: z.string().min(1).max(150).optional(), kind: criterionSchema.shape.kind.optional(), text: criterionPatch.shape.text, required: criterionPatch.shape.required, status: criterionPatch.shape.status }).strict();
export const ticketsCriterion = defineOperation({
  id: 'tickets.criterion', module: 'dev', effect: 'state', summary: 'Add or correct an exit criterion; required unknown/pending criteria prevent closing the work.',
  input: criterionInput,
  run: async (ctx, input) => {
    const { ref: r, id, kind, ...patch } = input;
    if (id) await updateCriterion(ctx.config, r, id, patch);
    else {
      const parsed = criterionSchema.safeParse({ kind, text: input.text, ...(input.required === undefined ? {} : { required: input.required }) });
      if (!parsed.success || input.status !== undefined) throw new OkbError('E_INVALID', 'a new criterion needs kind and text, and starts unknown', { key: 'ticketDetailInvalid' });
      await addCriterion(ctx.config, r, parsed.data);
    }
    return view(ctx, r);
  },
});
export const ticketsAttempt = defineOperation({
  id: 'tickets.attempt', module: 'dev', effect: 'state', summary: 'Remember a failed approach and the conditions it was tried in, with a possible next step.',
  input: attemptSchema.extend({ ref }).strict(), run: async (ctx, { ref: r, ...input }) => { await addAttempt(ctx.config, r, input); return view(ctx, r); },
});
export const ticketsReuse = defineOperation({
  id: 'tickets.reuse', module: 'dev', effect: 'state', summary: 'Record that a note helped on this ticket, with the note’s actual revision; it is not rewritten.',
  input: z.object({ ref, path: z.string().min(1).max(500), why: z.string().trim().max(600).optional() }).strict(),
  run: async (ctx, { ref: r, ...input }) => { await recordReuse(ctx.config, r, await loadBundleFor(ctx.config), input, ctx.actor); return view(ctx, r); },
});
export const ticketsClose = defineOperation({
  id: 'tickets.close', module: 'dev', effect: 'state', agents: false, summary: 'The person marks the work finished after reviewing its required exit criteria. Delivery stays independent.',
  input: refOnly, run: async (ctx, input) => { person(ctx); await finishTicket(ctx.config, input.ref); return view(ctx, input.ref); },
});
export const ticketsGithubConfig = defineOperation({
  id: 'tickets.github.configure', module: 'dev', effect: 'state', agents: false, summary: 'Opt in to read-only GitHub observations through an existing gh session, for listed repositories only.',
  input: githubSetupInput, run: (ctx, input) => { person(ctx); return configureGithub(ctx.config, ctx.env, input); },
});
export const ticketsGithubStatus = defineOperation({
  id: 'tickets.github.status', module: 'dev', effect: 'read', summary: 'The GitHub read opt-in for this profile: enabled, host and complete repository allowlist; no credential is read.',
  input: z.object({}).strict(), run: async ({ config }) => config.connectors.github ?? { enabled: false, host: 'github.com', repositories: [] },
});
export const ticketsGithub = defineOperation({
  id: 'tickets.github', module: 'dev', effect: 'state', agents: false, summary: 'Explicitly read a GitHub PR and CI through the configured gh session; nothing is written to GitHub and no delivery is inferred.',
  input: githubInput.extend({ ref }).strict(), run: async (ctx, { ref: r, ...input }) => { person(ctx); await readGithubPr(ctx.config, r, input, undefined, ctx.env); return view(ctx, r); },
});
export const ticketsJira = defineOperation({
  id: 'tickets.jira', module: 'dev', effect: 'state', agents: false, summary: 'Keep a person-provided Jira observation with its source and date. Jira is not contacted.',
  input: jiraInput.extend({ ref }).strict(), run: async (ctx, { ref: r, ...input }) => { person(ctx); await importJiraSnapshot(ctx.config, r, input); return view(ctx, r); },
});

/* ------------------------------------------------ the sheet (F2.4-08..14, D70) */

const fieldName = z.enum(FIELDS);
const origin = z.enum(ORIGINS);
const actorOrigin = (ctx: OpContext, asked?: Origin): Origin => {
  if (ctx.actor === 'person') return 'person';
  if (asked === 'person') throw new OkbError('E_NOT_APPROVED', 'an agent cannot write as the person', { key: 'ticketPersonOnly' });
  return asked ?? 'agent';
};

export const ticketsSheet = defineOperation({
  id: 'tickets.sheet', module: 'dev', effect: 'read', summary: 'The ticket sheet: fields with their origin, conflicts, next step (its first todo), todos, completeness, journey, linked notes and open requests. A ticket only documented in notes comes back with followed: false.',
  input: refOnly,
  run: async (ctx, input) => {
    const id = ticketId(input.ref);
    if (await loadTicket(ctx.config, id)) return ticketSheet(ctx.config, id, ctx.actor);
    if ((await documentedRefs(ctx.config)).includes(id)) return { ref: id, followed: false as const, links: await linksFor(ctx.config, id, ctx.actor) };
    throw new OkbError('E_NOT_FOUND', `no ticket ${id}`, { key: 'ticketUnknown', params: { ref: id } });
  },
});
export const ticketsFieldSet = defineOperation({
  id: 'tickets.field.set', module: 'dev', effect: 'state', summary: 'Fill a field of the ticket sheet with its origin and link. A value the person wrote is never replaced: a different one is kept as a conflict. Never invent a value.',
  input: z.object({ ref, field: fieldName, value: z.string().max(8000), origin: origin.optional(), url: z.string().max(1500).optional() }).strict(),
  run: async (ctx, i) => ({ ...(await setField(ctx.config, i.ref, { field: i.field, value: i.value, origin: actorOrigin(ctx, i.origin), ...(i.url ? { url: i.url } : {}) })), sheet: await ticketSheet(ctx.config, i.ref, ctx.actor) }),
});
export const ticketsFieldClear = defineOperation({
  id: 'tickets.field.clear', module: 'dev', effect: 'state', agents: false, summary: 'Empty a field of the ticket sheet.',
  input: z.object({ ref, field: fieldName }).strict(),
  run: async (ctx, i) => { await clearField(ctx.config, i.ref, i.field); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsFieldNa = defineOperation({
  id: 'tickets.field.na', module: 'dev', effect: 'state', agents: false, summary: 'Declare a field not applicable, with the reason; it leaves the completeness count.',
  input: z.object({ ref, field: z.enum(['title', 'summary', 'description', 'sourceStatus', 'team', 'product', 'done', 'criteria'] satisfies NaTarget[] as [NaTarget, ...NaTarget[]]), reason: z.string().trim().min(1).max(300) }).strict(),
  run: async (ctx, i) => { await markNotApplicable(ctx.config, i.ref, i.field, i.reason); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsConflictResolve = defineOperation({
  id: 'tickets.conflict.resolve', module: 'dev', effect: 'state', agents: false, summary: 'The person settles a conflict: keep their value, or take the one from a source.',
  input: z.object({ ref, field: fieldName, keep: z.enum(['mine', ...ORIGINS]) }).strict(),
  run: async (ctx, i) => { await resolveConflict(ctx.config, i.ref, i.field, i.keep); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsRename = defineOperation({
  id: 'tickets.rename', module: 'dev', effect: 'state', agents: false, summary: 'The person names the ticket.',
  input: z.object({ ref, title: z.string().trim().min(1).max(200) }).strict(),
  run: async (ctx, i) => { await renameTicket(ctx.config, i.ref, i.title); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsPin = defineOperation({
  id: 'tickets.pin', module: 'dev', effect: 'state', agents: false, summary: 'Pin a ticket first on Today, or unpin it.',
  input: z.object({ ref, pinned: z.boolean() }).strict(),
  run: async (ctx, i) => { await pinTicket(ctx.config, i.ref, i.pinned); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsSource = defineOperation({
  id: 'tickets.source', module: 'dev', effect: 'state', agents: false, summary: 'Point the ticket to its page in Jira, ServiceNow or elsewhere; OKB never contacts it.',
  input: z.object({ ref, provider: z.enum(['jira', 'servicenow', 'other']), url: z.string().max(1500) }).strict(),
  run: async (ctx, i) => { await setSourceLink(ctx.config, i.ref, { provider: i.provider, url: i.url }); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsReposDetach = defineOperation({
  id: 'tickets.repos.detach', module: 'dev', effect: 'state', agents: false, summary: 'Take a repository off a ticket; it keeps at least one.',
  input: z.object({ ref, repo: z.string().min(1).max(150) }).strict(),
  run: async (ctx, i) => { await detachRepo(ctx.config, i.ref, i.repo); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsUnfollow = defineOperation({
  id: 'tickets.unfollow', module: 'dev', effect: 'state', agents: false, summary: 'Stop following a ticket; its notes stay, and it can be restored for 30 days.',
  input: refOnly, run: async (ctx, i) => { await unfollowTicket(ctx.config, i.ref); return { ok: true, ref: ticketId(i.ref) }; },
});
export const ticketsRestore = defineOperation({
  id: 'tickets.restore', module: 'dev', effect: 'state', agents: false, summary: 'Follow again a ticket stopped less than 30 days ago.',
  input: refOnly, run: async (ctx, i) => { await restoreTicket(ctx.config, i.ref); return ticketSheet(ctx.config, i.ref, ctx.actor); },
});
export const ticketsLinksList = defineOperation({
  id: 'tickets.links.list', module: 'dev', effect: 'read', summary: 'The notes of a ticket: declared, filed under it, tied by hand, or suggested by a mention.',
  input: refOnly, run: async (ctx, i) => ({ links: await linksFor(ctx.config, i.ref, ctx.actor) }),
});
export const ticketsLinksSet = defineOperation({
  id: 'tickets.links.set', module: 'dev', effect: 'state', summary: 'Tie a note to a ticket, confirm a suggestion, or dismiss it for good.',
  input: z.object({ ref, path: z.string().trim().min(1).max(1000), state: z.enum(['confirmed', 'dismissed']) }).strict(),
  run: async (ctx, i) => {
    // Dismissing hides a note from the sheet for good: the person's call, not an agent's (D70).
    if (i.state === 'dismissed' && ctx.actor !== 'person') throw new OkbError('E_NOT_APPROVED', 'only the person dismisses a note', { key: 'ticketPersonOnly' });
    setLink(ctx.config, i.ref, i.path, i.state, actorOrigin(ctx)); return { links: await linksFor(ctx.config, i.ref, ctx.actor) };
  },
});
export const ticketsLinksScan = defineOperation({
  id: 'tickets.links.scan', module: 'dev', effect: 'state', summary: 'Suggest links from notes that mention a followed ticket; nothing is written in the KB.',
  input: z.object({}).strict(), run: async (ctx) => scanLinks(ctx.config),
});
export const ticketsRequestsCreate = defineOperation({
  id: 'tickets.requests.create', module: 'dev', effect: 'state', summary: 'Ask the agent to find fields of a ticket (none named: everything missing). One open request per ticket.',
  input: z.object({ ref, fields: z.array(z.string().max(40)).max(12).default([]) }).strict(),
  run: async (ctx, i) => requestFields(ctx.config, i.ref, i.fields),
});
export const ticketsRequestsList = defineOperation({
  id: 'tickets.requests.list', module: 'dev', effect: 'read', summary: 'Open requests to complete tickets, for this repository or all.',
  input: z.object({ ref: ref.optional(), repo: z.string().max(150).optional() }).strict(),
  run: async (ctx, i) => ({ requests: openRequests(ctx.config, i) }),
});
export const ticketsRequestsClose = defineOperation({
  id: 'tickets.requests.close', module: 'dev', effect: 'state', summary: 'Report on a request: what was found, what is missing, which sources were read, which could not be. Never claim a source you could not read.',
  input: z.object({ id: z.string().regex(/^R-[a-z0-9]{6}$/), found: z.array(z.string().max(60)).max(20).default([]), missing: z.array(z.string().max(60)).max(20).default([]), read: z.array(z.string().max(60)).max(20).default([]), unavailable: z.array(z.string().max(60)).max(20).default([]), note: z.string().max(1000).default('') }).strict(),
  run: async (ctx, { id, ...report }) => closeRequest(ctx.config, id, report),
});
export const ticketsRequestsCancel = defineOperation({
  id: 'tickets.requests.cancel', module: 'dev', effect: 'state', agents: false, summary: 'Cancel an open request.',
  input: z.object({ id: z.string().regex(/^R-[a-z0-9]{6}$/) }).strict(),
  run: async (ctx, i) => { cancelRequest(ctx.config, i.id); return { ok: true }; },
});
export const ticketsRequestsPrompt = defineOperation({
  id: 'tickets.requests.prompt', module: 'dev', effect: 'read', summary: 'A prompt to paste in an agent session to handle a request now.',
  input: z.object({ id: z.string().regex(/^R-[a-z0-9]{6}$/), lang: z.enum(['fr', 'en']).default('fr') }).strict(),
  run: async (ctx, i) => {
    const req = openRequests(ctx.config).find((r) => r.id === i.id);
    if (!req) throw new OkbError('E_NOT_FOUND', `no open request ${i.id}`, { key: 'ticketRequestUnknown' });
    return { prompt: requestPrompt(req, i.lang) };
  },
});
