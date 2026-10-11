import { z } from 'zod';
import { loadBundleFor } from '../../kb/bundle.js';
import { todayView } from '../../projects/today.js';
import { syncProjects } from '../../projects/sources.js';
import { defineOperation } from '../operation.js';

export const todayViewOp = defineOperation({
  id: 'today.view',
  module: 'core',
  effect: 'read',
  summary: 'The person’s day: the projects to pick up (with where they left off), what to do, what they wait for, what was done, what entered the memory this week, the cards to review and one thing to understand.',
  input: z.object({}).strict(),
  async run({ config, env }) {
    await syncProjects(config, env);
    return todayView(config, env, await loadBundleFor(config));
  },
});
