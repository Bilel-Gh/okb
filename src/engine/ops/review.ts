import { z } from 'zod';
import { keepProposal } from '../../review/keep.js';
import { requestCheck, reviewList } from '../../review/gestures.js';
import { defineOperation } from '../operation.js';

const proposal = z.string().regex(/^p-[A-Za-z0-9-]{8,80}$/).describe('A proposal id, as returned when it was prepared.');

/** D71: keep what was prepared — at once and to review in a `review-later` KB; otherwise it waits for the person. */
export const notesKeep = defineOperation({
  id: 'notes.keep', module: 'core', effect: 'state',
  summary: 'Keep a prepared note proposal. In a KB set to « the agent files, I review later », new notes and notes still to review go in at once, marked to review; a change to a validated note waits for the person. Otherwise nothing is applied.',
  input: z.object({ proposal }).strict(),
  async run({ config, env, actor }, input) {
    const r = await keepProposal(config, input.proposal, env);
    return { applied: r.applied, waiting: r.waiting, receipt: r.receipt?.id ?? null };
  },
});

const path = z.string().trim().min(1).max(1000);
/** Saying yes, no, moving or applying stays the person's own act in the app (src/web/api.ts), never an operation (F2.0-17). */
const person = { module: 'core' as const, effect: 'state' as const, agents: false };

export const notesReviewList = defineOperation({
  id: 'notes.review.list', module: 'core', effect: 'read',
  summary: 'What waits for the person: notes the agent filed to review (oldest first, with where and why), changes waiting on validated notes, and checks the person asked for.',
  input: z.object({}).strict(), run: async ({ config }) => reviewList(config),
});
export const notesReviewRequestCheck = defineOperation({ ...person, id: 'notes.review.requestCheck', summary: 'The person asks the agent to check a note against its sources at the next session.', input: z.object({ path }).strict(), run: async ({ config }, i) => ({ id: requestCheck(config, i.path) }) });
