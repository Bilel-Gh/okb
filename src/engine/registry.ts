import { enabledModules, moduleDef } from '../modules/catalog.js';
import { reposList } from '../repo/operations.js';
import { teamClear, teamConflictResolve, teamGet, teamNa, teamRequestsCancel, teamRequestsClose, teamRequestsCreate, teamRequestsList, teamRequestsPrompt, teamSet, teamSuggestionDismiss } from '../work/team-operations.js';
import { archConflictResolve, archLinkAdd, archLinkConfirm, archLinkExclude, archLinkReset, archLinkRetarget, archMap, archUrlClassify } from '../arch/operations.js';
import { OkbError } from '../util/errors.js';
import { backupStatusOp } from './ops/backup.js';
import { baggageDraftOp, baggageKeep } from './ops/baggage.js';
import { dayViewOp } from './ops/day.js';
import { documentsAdd, documentsList, documentsUpdate } from './ops/documents.js';
import { eveningViewOp } from './ops/evening.js';
import { indicatorsView } from './ops/indicators.js';
import { sharedFind, sharedGlossary, sharedKeep, sharedMap, sharedRead, shareMark, sharePreviewOp, shareReceive, shareSend, shareSetup, shareStatus, shareUnmark } from './ops/share.js';
import { kbStatus } from './ops/kb.js';
import { notesFind, notesRead } from './ops/notes.js';
import { actionsAdd, actionsDelete, actionsDetect, actionsList, actionsRestore, actionsUpdate, journalAdd, journalList } from './ops/actions.js';
import { projectsCreate, projectsGet, projectsLeave, projectsList, projectsUpdate } from './ops/projects.js';
import { suggestionsAdd, suggestionsList } from './ops/suggestions.js';
import { todayViewOp } from './ops/today.js';
import { notesKeep, notesReviewList, notesReviewRequestCheck } from './ops/review.js';
import { assistantAction, assistantAsk, assistantCancel, assistantConfigure, assistantConversation, assistantConversations, assistantEnd, assistantStart, assistantStatus } from './ops/assistant.js';
import { exportSpace } from './ops/export.js';
import { understandingReadOp, understandingKeepOp, understandingRecordOp, understandingOverviewOp, understandingMeetingOp, understandingReadinessOp, understandingLearningOp, understandingProgressOp, understandingObjectiveAddOp, understandingObjectiveDoneOp, understandingReviewOp, learnFormationsOp } from './ops/understanding.js';
import type { Operation, OpContext } from './operation.js';
import { ticketsList, ticketsGet, ticketsStart, ticketsResume, ticketsBrief, ticketsState, ticketsCriterion, ticketsAttempt, ticketsReuse, ticketsClose, ticketsGithubConfig, ticketsGithubStatus, ticketsGithub, ticketsJira, ticketsSheet, ticketsFieldSet, ticketsFieldClear, ticketsFieldNa, ticketsConflictResolve, ticketsRename, ticketsPin, ticketsSource, ticketsReposDetach, ticketsUnfollow, ticketsRestore, ticketsLinksList, ticketsLinksSet, ticketsLinksScan, ticketsRequestsCreate, ticketsRequestsList, ticketsRequestsClose, ticketsRequestsCancel, ticketsRequestsPrompt, metaMap } from '../work/operations.js';

export { jsonSchemaOf } from './schema.js';
export type { Actor, Effect, OpContext, Operation } from './operation.js';

/** Every operation of the engine, the core's then each module's. */
const OPS = {
  'team.get': teamGet,
  'team.set': teamSet,
  'team.clear': teamClear,
  'team.na': teamNa,
  'team.conflict.resolve': teamConflictResolve,
  'team.suggestion.dismiss': teamSuggestionDismiss,
  'team.requests.create': teamRequestsCreate,
  'team.requests.list': teamRequestsList,
  'team.requests.close': teamRequestsClose,
  'team.requests.cancel': teamRequestsCancel,
  'team.requests.prompt': teamRequestsPrompt,
  'arch.map': archMap,
  'arch.link.confirm': archLinkConfirm,
  'arch.link.exclude': archLinkExclude,
  'arch.link.retarget': archLinkRetarget,
  'arch.link.add': archLinkAdd,
  'arch.link.reset': archLinkReset,
  'arch.url.classify': archUrlClassify,
  'arch.conflict.resolve': archConflictResolve,
  'meta.map': metaMap,
  'tickets.list': ticketsList,
  'tickets.get': ticketsGet,
  'tickets.start': ticketsStart,
  'tickets.resume': ticketsResume,
  'tickets.brief': ticketsBrief,
  'tickets.state': ticketsState,
  'tickets.criterion': ticketsCriterion,
  'tickets.attempt': ticketsAttempt,
  'tickets.reuse': ticketsReuse,
  'tickets.sheet': ticketsSheet,
  'tickets.field.set': ticketsFieldSet,
  'tickets.field.clear': ticketsFieldClear,
  'tickets.field.na': ticketsFieldNa,
  'tickets.conflict.resolve': ticketsConflictResolve,
  'tickets.rename': ticketsRename,
  'tickets.pin': ticketsPin,
  'tickets.source': ticketsSource,
  'tickets.repos.detach': ticketsReposDetach,
  'tickets.unfollow': ticketsUnfollow,
  'tickets.restore': ticketsRestore,
  'tickets.links.list': ticketsLinksList,
  'tickets.links.set': ticketsLinksSet,
  'tickets.links.scan': ticketsLinksScan,
  'tickets.requests.create': ticketsRequestsCreate,
  'tickets.requests.list': ticketsRequestsList,
  'tickets.requests.close': ticketsRequestsClose,
  'tickets.requests.cancel': ticketsRequestsCancel,
  'tickets.requests.prompt': ticketsRequestsPrompt,
  'tickets.close': ticketsClose,
  'tickets.github.configure': ticketsGithubConfig,
  'tickets.github.status': ticketsGithubStatus,
  'tickets.github': ticketsGithub,
  'tickets.jira': ticketsJira,
  'space.export': exportSpace,
  'understanding.read': understandingReadOp,
  'understanding.keep': understandingKeepOp,
  'understanding.record': understandingRecordOp,
  'understanding.overview': understandingOverviewOp,
  'understanding.meeting': understandingMeetingOp,
  'understanding.readiness': understandingReadinessOp,
  'understanding.learning': understandingLearningOp,
  'learn.formations': learnFormationsOp,
  'understanding.progress': understandingProgressOp,
  'understanding.objective.add': understandingObjectiveAddOp,
  'understanding.objective.done': understandingObjectiveDoneOp,
  'understanding.review': understandingReviewOp,
  'assistant.status': assistantStatus,
  'assistant.configure': assistantConfigure,
  'assistant.conversations': assistantConversations,
  'assistant.start': assistantStart,
  'assistant.conversation': assistantConversation,
  'assistant.ask': assistantAsk,
  'assistant.cancel': assistantCancel,
  'assistant.end': assistantEnd,
  'assistant.action': assistantAction,
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
  'actions.delete': actionsDelete,
  'actions.restore': actionsRestore,
  'notes.keep': notesKeep,
  'notes.review.list': notesReviewList,
  'notes.review.requestCheck': notesReviewRequestCheck,
  'actions.detect': actionsDetect,
  'journal.add': journalAdd,
  'journal.list': journalList,
  'today.view': todayViewOp,
  'documents.add': documentsAdd,
  'documents.list': documentsList,
  'documents.update': documentsUpdate,
  'baggage.draft': baggageDraftOp,
  'baggage.keep': baggageKeep,
  'evening.view': eveningViewOp,
  'backup.status': backupStatusOp,
  'indicators.view': indicatorsView,
  'day.view': dayViewOp,
  'share.status': shareStatus,
  'share.setup': shareSetup,
  'share.mark': shareMark,
  'share.unmark': shareUnmark,
  'share.preview': sharePreviewOp,
  'share.send': shareSend,
  'share.receive': shareReceive,
  'shared.find': sharedFind,
  'shared.read': sharedRead,
  'shared.keep': sharedKeep,
  'shared.map': sharedMap,
  'shared.glossary': sharedGlossary,
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
  if (ctx.actor === 'agent' && op.agents === false) throw new OkbError('E_NOT_APPROVED', 'this operation is the person’s own act', { ...(op.id.startsWith('documents.') ? { key: 'documentPersonOnly' } : {}) });
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
