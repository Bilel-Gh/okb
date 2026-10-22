import { z } from 'zod';
import { dueCount } from '../../learn/learn.js';
import { computeStatus } from '../../status/status.js';
import { loadQueue } from '../../suggest/suggest.js';
import { defineOperation } from '../operation.js';

export const kbStatus = defineOperation({
  id: 'kb.status',
  module: 'core',
  effect: 'read',
  summary: 'The state of the knowledge base: notes, categories, focus, inbox, proposals waiting, health, suggestion cards waiting and review cards due.',
  input: z.object({ light: z.boolean().default(false).describe('Skip the slower checks (maintenance, Git).') }).strict(),
  async run({ config }, input) {
    const [status, queue, due] = await Promise.all([
      computeStatus(config, { light: input.light }),
      loadQueue(config).catch(() => []),
      dueCount(config).catch(() => 0),
    ]);
    const { loadBundleFor } = await import('../../kb/bundle.js');
    const { validatedShare } = await import('../../review/state.js');
    const review = await validatedShare(config, await loadBundleFor(config)).then((r) => ({ pending: r.pending, share: r.share }), () => ({ pending: 0, share: null }));
    return { ...status, review, suggestions: queue.filter((q) => q.status === 'pending' || q.status === 'later').length, due };
  },
});
