import { z } from 'zod';
import { indicators } from '../../indicators/indicators.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { defineOperation } from '../operation.js';

export const indicatorsView = defineOperation({
  id: 'indicators.view',
  module: 'core',
  effect: 'read',
  summary: 'Four indicators kept apart — coverage, freshness, quality, understanding — each with what it is made of (so many out of so many) and, for each gap, what to do. No figure when there is nothing to measure.',
  input: z.object({}).strict(),
  run: async (ctx) => ({ indicators: await indicators(ctx.config, await loadBundleFor(ctx.config), ctx.env) }),
});
