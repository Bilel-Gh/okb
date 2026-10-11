import { z } from 'zod';
import { loadBundleFor } from '../../kb/bundle.js';
import { todayView } from '../../projects/today.js';
import { syncProjects } from '../../projects/sources.js';
import { defineOperation } from '../operation.js';
import { isSecret } from '../../security/confidential.js';
import { asBundlePath } from '../../util/paths.js';

export const todayViewOp = defineOperation({
  id: 'today.view',
  module: 'core',
  effect: 'read',
  summary: 'The person’s day: the projects to pick up (with where they left off), what to do, what they wait for, what was done, what entered the memory this week, the cards to review and one thing to understand.',
  input: z.object({}).strict(),
  async run({ config, env, actor }) {
    await syncProjects(config, env);
    const bundle = await loadBundleFor(config);
    const today = await todayView(config, env, bundle);
    return actor === 'agent' ? { ...today, notesToRecheck: today.notesToRecheck.filter((n) => { const e = bundle.byPath.get(asBundlePath(n.path)); return e && !isSecret(e.ext); }) } : today;
  },
});
