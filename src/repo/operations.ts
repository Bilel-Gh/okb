import { z } from 'zod';
import { defineOperation } from '../engine/operation.js';
import { listRepos } from './registry.js';

/** The developer module's operations (src/modules/catalog.ts): hidden when the module is off. */
export const reposList = defineOperation({
  id: 'repos.list',
  module: 'dev',
  effect: 'read',
  summary: 'The code repositories OKB documents, each with the knowledge base that holds its notes.',
  input: z.object({}).strict(),
  async run({ env }) {
    return { repos: await listRepos(env) };
  },
});
