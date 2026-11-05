import { z } from 'zod';
import { addObjective, finishObjective, gradeCard, parseRating } from '../../learn/learn.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { collectCards } from '../../learn/learn.js';
import { understandingReading, keepReading, checkReadiness, READING_MODES } from '../../understanding/reading.js';
import { prepareMeeting, understandingLearning } from '../../understanding/planning.js';
import { recordUnderstanding, understandingOverview, setUnderstandingProgress, UNDERSTANDING_KINDS } from '../../understanding/state.js';
import { OkbError } from '../../util/errors.js';
import { defineOperation, type OpContext } from '../operation.js';

const text = (max: number) => z.string().trim().min(1).max(max);
function person(ctx: OpContext): void {
  if (ctx.actor !== 'person') throw new OkbError('E_NOT_APPROVED', 'Only the person records an act of understanding or chooses a learning goal.');
}

export const understandingReadOp = defineOperation({
  id: 'understanding.read', module: 'core', effect: 'state',
  summary: 'Read a note in a different style with exact supporting quotations. Reuses a cache tied to source content, context, observed level and style. Protected notes are excluded.',
  input: z.object({ path: text(500), mode: z.enum(READING_MODES).default('auto'), projectId: text(100).optional() }).strict(),
  async run({ config, env }, input) { return understandingReading(config, input, env); },
});

export const understandingKeepOp = defineOperation({
  id: 'understanding.keep', module: 'core', effect: 'propose',
  summary: 'Prepare a normal note revision from a current cached reading, preserving citations, literal code and metadata. This neither approves nor writes the note.',
  input: z.object({ readingId: text(100) }).strict(),
  async run({ config }, input) { return keepReading(config, input.readingId); },
});

export const understandingRecordOp = defineOperation({
  id: 'understanding.record', module: 'core', effect: 'state', agents: false,
  summary: 'Record a person’s encounter, consultation, practice, explanation, reuse, unclear point or resolved understanding debt. Stable event ids make retries idempotent.',
  input: z.object({ path: text(500), kind: z.enum(UNDERSTANDING_KINDS), point: z.string().max(4000).optional(), projectId: text(100).optional(), eventId: text(150) }).strict(),
  async run(ctx, input) { person(ctx); return recordUnderstanding(ctx.config, input); },
});

export const understandingOverviewOp = defineOperation({
  id: 'understanding.overview', module: 'core', effect: 'read', agents: false,
  summary: 'The person’s observed understanding levels, skills map, open debts, one five-minute subject today and optional private progress. No expertise certification or ranking.',
  input: z.object({}).strict(),
  async run(ctx) { person(ctx); return understandingOverview(ctx.config); },
});

export const understandingMeetingOp = defineOperation({
  id: 'understanding.meeting', module: 'core', effect: 'read',
  summary: 'Prepare a meeting from existing project notes, open actions and recorded questions, preserving their sources. Works without a model and does not invent likely questions.',
  input: z.object({ projectId: text(100).optional(), query: text(500).optional() }).strict(),
  async run({ config, env }, input) { return prepareMeeting(config, input, env); },
});

export const understandingReadinessOp = defineOperation({
  id: 'understanding.readiness', module: 'core', effect: 'state', agents: false,
  summary: 'Compare the person’s own explanation against exact passages of one note, using exam grades. Never promotes a skill level or claims readiness for a real situation.',
  input: z.object({ path: text(500), answer: text(12000) }).strict(),
  async run(ctx, input) { person(ctx); return checkReadiness(ctx.config, input, ctx.env); },
});

export const understandingLearningOp = defineOperation({
  id: 'understanding.learning', module: 'core', effect: 'read', agents: false,
  summary: 'The person’s chosen learning goals, short paths and cards due under the existing FSRS schedule. Does not reset or grade any card.',
  input: z.object({ subject: text(200).optional(), path: text(500).optional() }).strict(),
  async run(ctx, input) { person(ctx); return understandingLearning(ctx.config, input); },
});

export const understandingProgressOp = defineOperation({
  id: 'understanding.progress', module: 'core', effect: 'state', agents: false,
  summary: 'Turn optional private understanding XP and badges on or off. They reward resolved debts, explanations and actual declared reuse; never ranking.',
  input: z.object({ enabled: z.boolean() }).strict(),
  async run(ctx, input) { person(ctx); setUnderstandingProgress(ctx.config, input.enabled); return { enabled: input.enabled, private: true }; },
});

export const understandingObjectiveAddOp = defineOperation({
  id: 'understanding.objective.add', module: 'core', effect: 'state', agents: false,
  summary: 'The person chooses a learning objective, with an optional existing card subject and target date. Reuses the learning module’s objectives.',
  input: z.object({ text: text(1000), subject: text(200).optional(), by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  async run(ctx, input) { person(ctx); return addObjective(ctx.config, input); },
});

export const understandingObjectiveDoneOp = defineOperation({
  id: 'understanding.objective.done', module: 'core', effect: 'state', agents: false,
  summary: 'The person marks an existing learning objective complete. Does not infer competence or promote understanding levels.',
  input: z.object({ id: text(100) }).strict(),
  async run(ctx, input) { person(ctx); const result = await finishObjective(ctx.config, input.id); if (!result) throw new OkbError('E_NOT_FOUND', 'No such learning objective.'); return result; },
});

export const understandingReviewOp = defineOperation({
  id: 'understanding.review', module: 'core', effect: 'state', agents: false,
  summary: 'Grade one current non-protected study card using the existing FSRS scheduler. Does not claim practice, explanation or reuse.',
  input: z.object({ id: text(100), rating: z.enum(['again', 'hard', 'good', 'easy']) }).strict(),
  async run(ctx, input) {
    person(ctx);
    const bundle = await loadBundleFor(ctx.config);
    if (!collectCards(ctx.config, bundle).some((c) => c.id === input.id)) throw new OkbError('E_NOT_FOUND', 'No such current study card.');
    return gradeCard(ctx.config, input.id, parseRating(input.rating)!);
  },
});

export const UNDERSTANDING_OPERATIONS = [understandingReadOp, understandingKeepOp, understandingRecordOp, understandingOverviewOp, understandingMeetingOp, understandingReadinessOp, understandingLearningOp, understandingProgressOp, understandingObjectiveAddOp, understandingObjectiveDoneOp, understandingReviewOp] as const;

/** Chantier 5: the formations agents prepared (notes of type Formation), with each step's level and cards. Read only. */
export const learnFormationsOp = defineOperation({
  id: 'learn.formations', module: 'core', effect: 'read',
  summary: 'The formations: learning paths kept as notes of type Formation (or in formations/), their goal (revision, certification, skill), the date to be ready by, each linked step with the person’s observed level and its revision cards due. To create one, write a Formation note through the usual proposal: its links, in order, are the steps.',
  input: z.object({}).strict(),
  async run(ctx) {
    const { listFormations } = await import('../../learn/formations.js');
    const { loadBundleFor } = await import('../../kb/bundle.js');
    return { formations: await listFormations(ctx.config, await loadBundleFor(ctx.config)) };
  },
});
