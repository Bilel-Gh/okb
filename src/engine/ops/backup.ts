import { z } from 'zod';
import { backupStatus } from '../../brain/backup.js';
import { defineOperation } from '../operation.js';

export const backupStatusOp = defineOperation({
  id: 'backup.status',
  module: 'core',
  effect: 'read',
  summary: 'Where the backup stands: the last snapshot, whether it is late, and when a restore was last really tried.',
  input: z.object({}).strict(),
  run: (ctx) => backupStatus(ctx.config, ctx.env),
});
