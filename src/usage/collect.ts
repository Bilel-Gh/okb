import { loadConfig } from '../config/load.js';
import { listKbs } from '../kb/registry.js';
import { readEvents, readFeedback } from './events.js';
import { qualitySignals, type QualitySignals } from './quality.js';
import { commandStats } from './report.js';
import { computeStats, readSessions } from './stats.js';

/** Everything the usage page and the report show, for the last `days` days. */
export async function collectUsage(options: { days?: number; env?: NodeJS.ProcessEnv; now?: Date } = {}) {
  const env = options.env ?? process.env;
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { sessions, logs, read } = await readSessions(env);
  const stats = computeStats(sessions, { days, now, logs });
  const quality: QualitySignals[] = [];
  for (const kb of await listKbs(env).catch(() => [])) {
    if (!kb.exists) continue;
    try {
      const { config } = await loadConfig({ profileId: kb.id, env });
      const q = await qualitySignals(config, { since, now });
      if (q.proposals || q.appliedFiles) quality.push(q);
    } catch { /* a KB that does not load is reported by okb doctor */ }
  }
  const commands = commandStats(await readEvents(env), since);
  const feedback = (await readFeedback(env)).filter((f) => f.at >= since);
  return { stats, quality, commands, feedback, logsRead: read };
}
