import { z } from 'zod';
import { ACTION_KINDS, addAction, deleteAction, IMPORTANCES, listActions, updateAction } from '../../projects/actions.js';
import { detectAction } from '../../projects/detect.js';
import { addEntry, ENTRY_KINDS, listEntries } from '../../projects/journal.js';
import { defineOperation } from '../operation.js';

const project = z.string().regex(/^P-[a-z0-9]{6}$/).describe('A project id, as returned by projects.list.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('A day, YYYY-MM-DD.');
/** The work an action is tied to, as a module names it (a ticket reference, normalised by the caller). */
const workRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).describe('The work it belongs to, such as a ticket reference.');
const PERSON_KINDS = ['note', 'decision', 'done', 'tried', 'meeting'] as const;

export const actionsAdd = defineOperation({
  id: 'actions.add',
  module: 'core',
  effect: 'state',
  summary: 'Add an action: something to do (todo), something expected from someone (waiting), something someone asked (asked), or an open question of a project (question); with a day when there is one.',
  input: z.object({
    text: z.string().trim().min(1).max(300),
    kind: z.enum(ACTION_KINDS).default('todo'),
    project: project.optional(),
    who: z.string().trim().min(1).max(80).optional().describe('Who it is expected from, or who asked.'),
    due: day.optional(),
    workRef: workRef.optional(),
    importance: z.enum(IMPORTANCES).optional(),
    pinned: z.boolean().optional(),
  }).strict(),
  async run({ config, actor }, input) {
    return addAction(config, { ...input, source: actor === 'agent' ? 'ai' : 'person' });
  },
});

export const actionsList = defineOperation({
  id: 'actions.list',
  module: 'core',
  effect: 'read',
  summary: 'The actions, the late ones first: open by default, of one project or of all.',
  input: z.object({ project: project.optional(), status: z.enum(['open', 'done', 'dropped', 'all']).default('open'), kind: z.enum(ACTION_KINDS).optional() }).strict(),
  async run({ config, env }, input) {
    return { actions: await listActions(config, env, input) };
  },
});

export const actionsUpdate = defineOperation({
  id: 'actions.update',
  module: 'core',
  effect: 'state',
  summary: 'Change an action: mark it done (it leaves a line in its project’s journal), drop it, reopen it, or change its text, date, person, importance, pin or the work it belongs to.',
  input: z.object({
    id: z.string().regex(/^A-[a-z0-9]{6}$/),
    status: z.enum(['open', 'done', 'dropped']).optional(),
    text: z.string().trim().min(1).max(300).optional(),
    who: z.string().trim().max(80).optional(),
    due: day.optional(),
    importance: z.enum(IMPORTANCES).optional(),
    pinned: z.boolean().optional(),
    workRef: workRef.nullable().optional(),
  }).strict(),
  async run({ config }, input) {
    const { id, ...patch } = input;
    return updateAction(config, id, patch);
  },
});

export const actionsDelete = defineOperation({
  id: 'actions.delete',
  module: 'core',
  effect: 'state',
  agents: false,
  summary: 'Delete an action for good.',
  input: z.object({ id: z.string().regex(/^A-[a-z0-9]{6}$/) }).strict(),
  async run({ config }, input) {
    deleteAction(config, input.id);
    return { ok: true };
  },
});

export const journalAdd = defineOperation({
  id: 'journal.add',
  module: 'core',
  effect: 'state',
  summary: 'Write a line in the journal, of a project or of the day: a note, a decision, something done, something tried that did not work, a meeting.',
  input: z.object({ text: z.string().trim().min(1).max(600), kind: z.enum(PERSON_KINDS).default('note'), project: project.optional() }).strict(),
  async run({ config, actor }, input) {
    return addEntry(config, { ...input, source: actor === 'agent' ? 'ai' : 'person' });
  },
});

export const journalList = defineOperation({
  id: 'journal.list',
  module: 'core',
  effect: 'read',
  summary: 'The journal, the latest first: of one project, of one day, or the last lines. What happened, decided, tried and done.',
  input: z.object({ project: project.optional(), day: day.optional(), limit: z.number().int().min(1).max(500).default(100) }).strict(),
  async run({ config, env }, input) {
    return { entries: await listEntries(config, env, input), kinds: ENTRY_KINDS };
  },
});

export const actionsDetect = defineOperation({
  id: 'actions.detect',
  module: 'core',
  effect: 'read',
  summary: 'Spot an action in a line (a thing to do with its date, or something expected from someone), without AI; null for a plain fact.',
  input: z.object({ text: z.string().max(400) }).strict(),
  async run(_ctx, input) {
    return { action: detectAction(input.text) };
  },
});
