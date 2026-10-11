import { z } from 'zod';
import { eveningView } from '../../evening/evening.js';
import { defineOperation } from '../operation.js';

export const eveningViewOp = defineOperation({
  id: 'evening.view',
  module: 'core',
  effect: 'read',
  summary: 'What waits for the person’s yes: the notes an assistant proposed to write (with their cost) and the changes ready to apply. Saying yes is theirs, in the app or the terminal.',
  input: z.object({}).strict(),
  run: (ctx) => eveningView(ctx.config, ctx.env),
});
