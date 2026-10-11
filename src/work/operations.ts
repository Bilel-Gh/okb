import { z } from 'zod';
import { loadBundleFor } from '../kb/bundle.js';
import { findRepo, listRepos } from '../repo/registry.js';
import { isSecret } from '../security/confidential.js';
import { OkbError } from '../util/errors.js';
import { addAttempt, addCriterion, attemptSchema, briefSchema, criterionPatch, criterionSchema, recordReuse, setTicketState, stateSchema, ticketDetail, updateCriterion, updateTicketBrief } from './ticket-state.js';
import { configureGithub, githubInput, githubSetupInput, importJiraSnapshot, jiraInput, readGithubPr } from './ticket-external.js';
import { finishTicket, listTickets, loadTicket, startTicket, syncTicket } from './tickets.js';
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
  input: z.object({}).strict(), run: async ({ config }) => ({ tickets: await listTickets(config) }),
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
    const { record, created, attached } = await startTicket(ctx.config, { ...input, repo });
    return { ...(await view(ctx, record.ref)), created, attached };
  },
});
export const ticketsBrief = defineOperation({
  id: 'tickets.brief', module: 'dev', effect: 'state', summary: 'Correct the local resume brief: goal, last action and next step.',
  input: briefSchema.extend({ ref }).strict(), run: async (ctx, { ref: r, ...patch }) => { await updateTicketBrief(ctx.config, r, patch); return view(ctx, r); },
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
