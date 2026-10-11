import { z } from 'zod';
import { dayView } from '../../projects/dayview.js';
import { defineOperation } from '../operation.js';

export const dayViewOp = defineOperation({
  id: 'day.view',
  module: 'core',
  effect: 'read',
  summary: 'What happened on one day: the lines of the journal of that day. The day is said in plain words (« mardi », « hier », « le 14 février ») or as a date (2027-03-02).',
  input: z.object({ day: z.string().min(1).max(60) }).strict(),
  run: (ctx, input) => dayView(ctx.config, ctx.env, input.day),
});
