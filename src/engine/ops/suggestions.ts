import { z } from 'zod';
import { noteType } from '../../brain/types.js';
import { knowledgeGaps } from '../../find/find.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { addSuggestion, contextFor, dailyBudget, loadQueue, SIGNALS, spentToday, type Signal } from '../../suggest/suggest.js';
import { defineOperation } from '../operation.js';

const word = (max: number) => z.string().trim().min(1).max(max);

export const suggestionsList = defineOperation({
  id: 'suggestions.list',
  module: 'core',
  effect: 'read',
  summary: 'The suggestion cards waiting for the person’s decision (or all of them), with the day’s token budget and the searches that found nothing.',
  input: z.object({ all: z.boolean().default(false).describe('Include decided and expired cards.') }).strict(),
  async run({ config, env }, input) {
    const queue = await loadQueue(config);
    const suggestions = queue.filter((s) => input.all || s.status === 'pending' || s.status === 'later').map((s) => ({ ...s, category: noteType(s.type)?.category ?? 'other' }));
    const waiting = suggestions.filter((s) => s.status === 'pending' || s.status === 'later');
    return {
      suggestions,
      totalTokens: waiting.reduce((n, s) => n + s.cost.tokens, 0),
      budget: { daily: await dailyBudget(env), spent: await spentToday(config) },
      gaps: await knowledgeGaps(config),
    };
  },
});

export const suggestionsAdd = defineOperation({
  id: 'suggestions.add',
  module: 'core',
  effect: 'state',
  summary: 'Suggest a note to the person: a card with its type, exact place, reason, overlapping notes and cost. Nothing is written until the person says yes.',
  input: z.object({
    type: word(40).describe('The note type (okb brain types), e.g. concept, decision, known-error.'),
    title: word(200),
    why: z.string().trim().max(500).default('').describe('Why this note is worth writing now.'),
    product: z.string().max(200).optional(),
    repo: z.string().max(200).optional(),
    theme: z.string().max(200).optional(),
    ref: z.string().max(100).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    level: z.enum(['root', 'drawer', 'domain', 'product', 'repo']).optional(),
    signal: z.enum(SIGNALS as [Signal, ...Signal[]]).optional(),
    source: z.string().max(300).optional(),
    scope: z.string().max(300).optional().describe('A folder: the card covers several notes under it.'),
    notes: z.number().int().min(1).max(50).optional(),
  }).strict(),
  async run({ config }, input) {
    const bundle = await loadBundleFor(config);
    return addSuggestion(config, input, await contextFor(config, bundle));
  },
});
