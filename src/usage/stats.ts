import { join } from 'node:path';
import { okbHome } from '../config/load.js';
import { isInside, listKbs } from '../kb/registry.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { claudeProjectsDir, fingerprint, listSessions, mergeUsage, summariseSession, type OkbRun, type SessionSummary, type Usage } from './claude-logs.js';
import { addTokens, modelLabel, noTokens, PRICES_AS_OF, totalTokens, type Tokens } from './prices.js';
import { TOKEN_ESTIMATE_DIVISOR } from '../util/context-meter.js';
import { PRODUCT_ROOT } from '../integrations/system.js';

/**
 * OKB usage over a period: what each workflow costs, on which model, how much
 * the subagents weigh, what the CLI outputs and skills put into the context,
 * and plain advice drawn from those numbers. Computed from the local Claude
 * Code logs (claude-logs.ts); a cache keeps each log's summary, so only new or
 * changed logs are read again.
 */
const CACHE_VERSION = 3;
type Cache = { version: number; entries: Record<string, { fp: string; summary: SessionSummary }> };

export function usageDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(okbHome(env), 'usage');
}

export async function readSessions(env: NodeJS.ProcessEnv = process.env): Promise<{ sessions: SessionSummary[]; logs: number; read: number }> {
  const cachePath = join(usageDir(env), 'claude-logs.json');
  const cache = (await readJsonIfExists<Cache>(cachePath)) ?? { version: CACHE_VERSION, entries: {} };
  if (cache.version !== CACHE_VERSION) { cache.version = CACHE_VERSION; cache.entries = {}; }
  const kbs = (await listKbs(env).catch(() => [])).filter((k) => k.root);
  const profileOf = (cwd: string) => kbs.find((k) => isInside(cwd, k.root))?.id ?? null;
  const entries = await listSessions(claudeProjectsDir(env));
  const sessions: SessionSummary[] = [];
  const next: Cache['entries'] = {};
  let read = 0;
  for (const entry of entries) {
    let fp: string;
    try { fp = await fingerprint(entry); } catch { continue; }
    const cached = cache.entries[entry.file];
    let summary: SessionSummary;
    if (cached && cached.fp === fp) summary = cached.summary;
    else {
      try { summary = await summariseSession(entry, profileOf, PRODUCT_ROOT); read += 1; } catch { continue; }
    }
    next[entry.file] = { fp, summary };
    sessions.push(summary);
  }
  if (read || Object.keys(next).length !== Object.keys(cache.entries).length) {
    await writeJsonAtomic(cachePath, { version: CACHE_VERSION, entries: next } satisfies Cache).catch(() => undefined);
  }
  return { sessions, logs: entries.length, read };
}

export type Amount = { costUsd: number; tokens: number };
export type WorkflowStats = Amount & {
  readonly workflow: string;
  runs: number;
  agentsCostUsd: number;
  minutes: number[];
  readonly costs: number[];
};
export type Advice = { readonly key: string; readonly params: Record<string, string> };

export type UsageStats = {
  readonly from: string;
  readonly to: string;
  readonly days: number;
  readonly pricesAsOf: string;
  readonly logs: number;
  readonly okb: Amount & {
    readonly runs: number;
    readonly tokensByKind: Tokens;
    readonly cacheHitRatio: number | null;
    readonly agentsCostUsd: number;
    readonly byWorkflow: readonly (Amount & { workflow: string; runs: number; avgCostUsd: number; avgTokens: number; agentsCostUsd: number; medianMinutes: number })[];
    readonly byModel: readonly (Amount & { model: string; label: string })[];
    readonly byProfile: readonly (Amount & { profile: string; runs: number })[];
    readonly agents: readonly (Amount & { type: string; runs: number; models: readonly string[] })[];
    readonly outputs: readonly { command: string; calls: number; bytes: number; tokensEstimated: number }[];
    readonly skillTokensEstimated: number;
    readonly hook: { readonly runs: number; readonly tokensEstimated: number };
    readonly errors: number;
    readonly calls: number;
    readonly heaviest: readonly (Amount & { workflow: string; start: string; profile: string | null })[];
  };
  readonly other: Amount;
  readonly daily: readonly { day: string; okbCostUsd: number; otherCostUsd: number }[];
  readonly advice: readonly Advice[];
};

const usageAmount = (u: Usage): Amount => {
  let costUsd = 0;
  let tokens = 0;
  for (const m of Object.values(u)) { costUsd += m.costUsd; tokens += totalTokens(m.tokens); }
  return { costUsd, tokens };
};

const runUsage = (r: OkbRun): Usage => {
  const all: Usage = {};
  mergeUsage(all, r.main);
  for (const a of r.agents) mergeUsage(all, a.usage);
  return all;
};

const median = (xs: readonly number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const estimate = (bytes: number) => Math.ceil(bytes / TOKEN_ESTIMATE_DIVISOR);
const dayOf = (iso: string) => iso.slice(0, 10);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function computeStats(sessions: readonly SessionSummary[], options: { days?: number; now?: Date; logs?: number } = {}): UsageStats {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const fromDate = new Date(now.getTime() - days * 86_400_000);
  const from = fromDate.toISOString();
  const inPeriod = (iso: string) => iso >= from && iso <= now.toISOString();

  const runs = sessions.flatMap((s) => s.okbRuns).filter((r) => inPeriod(r.start || r.end));
  const tokensByKind = noTokens();
  const byModel = new Map<string, Amount>();
  const byWorkflow = new Map<string, WorkflowStats>();
  const byProfile = new Map<string, Amount & { runs: number }>();
  const agents = new Map<string, Amount & { runs: number; models: Set<string> }>();
  const outputs = new Map<string, { calls: number; bytes: number }>();
  const daily = new Map<string, { okbCostUsd: number; otherCostUsd: number }>();
  let skillBytes = 0;
  let errors = 0;
  let calls = 0;
  let agentsCost = 0;
  const amounts: (Amount & { workflow: string; start: string; profile: string | null })[] = [];

  for (const r of runs) {
    const all = runUsage(r);
    const amount = usageAmount(all);
    for (const [model, use] of Object.entries(all)) {
      addTokens(tokensByKind, use.tokens);
      const m = byModel.get(model) ?? { costUsd: 0, tokens: 0 };
      m.costUsd += use.costUsd; m.tokens += totalTokens(use.tokens);
      byModel.set(model, m);
    }
    const agentCost = r.agents.reduce((s, a) => s + usageAmount(a.usage).costUsd, 0);
    agentsCost += agentCost;
    const w = byWorkflow.get(r.workflow) ?? { workflow: r.workflow, runs: 0, costUsd: 0, tokens: 0, agentsCostUsd: 0, minutes: [], costs: [] };
    w.runs += 1; w.costUsd += amount.costUsd; w.tokens += amount.tokens; w.agentsCostUsd += agentCost; w.costs.push(amount.costUsd);
    if (r.start && r.end) w.minutes.push((Date.parse(r.end) - Date.parse(r.start)) / 60_000);
    byWorkflow.set(r.workflow, w);
    const pid = r.profile ?? '?';
    const p = byProfile.get(pid) ?? { costUsd: 0, tokens: 0, runs: 0 };
    p.costUsd += amount.costUsd; p.tokens += amount.tokens; p.runs += 1;
    byProfile.set(pid, p);
    for (const a of r.agents) {
      const am = usageAmount(a.usage);
      const g = agents.get(a.type) ?? { costUsd: 0, tokens: 0, runs: 0, models: new Set<string>() };
      g.costUsd += am.costUsd; g.tokens += am.tokens; g.runs += 1;
      for (const model of Object.keys(a.usage)) g.models.add(model);
      agents.set(a.type, g);
    }
    for (const [command, bytes] of Object.entries(r.outputBytes)) {
      const o = outputs.get(command) ?? { calls: 0, bytes: 0 };
      o.bytes += bytes;
      o.calls += r.outputCalls?.[command] ?? 1;
      outputs.set(command, o);
    }
    calls += r.okbCalls;
    errors += r.okbErrors;
    skillBytes += r.skillBytes;
    const d = daily.get(dayOf(r.start)) ?? { okbCostUsd: 0, otherCostUsd: 0 };
    d.okbCostUsd += amount.costUsd;
    daily.set(dayOf(r.start), d);
    amounts.push({ ...amount, workflow: r.workflow, start: r.start, profile: r.profile });
  }

  const other: Amount = { costUsd: 0, tokens: 0 };
  let hookRuns = 0;
  let hookBytes = 0;
  for (const s of sessions) {
    if (s.start && s.end && (s.end < from || s.start > now.toISOString())) continue;
    hookRuns += s.hookRuns;
    hookBytes += s.hookBytes;
    for (const [day, u] of Object.entries(s.other)) {
      if (day < dayOf(from) || day > dayOf(now.toISOString())) continue;
      const a = usageAmount(u);
      other.costUsd += a.costUsd; other.tokens += a.tokens;
      const d = daily.get(day) ?? { okbCostUsd: 0, otherCostUsd: 0 };
      d.otherCostUsd += a.costUsd;
      daily.set(day, d);
    }
  }

  const okbCost = [...byWorkflow.values()].reduce((s, w) => s + w.costUsd, 0);
  const okbTokens = [...byWorkflow.values()].reduce((s, w) => s + w.tokens, 0);
  const inputSide = tokensByKind.input + tokensByKind.write5m + tokensByKind.write1h + tokensByKind.read;
  const cacheHitRatio = inputSide ? tokensByKind.read / inputSide : null;

  const workflows = [...byWorkflow.values()].sort((a, b) => b.costUsd - a.costUsd).map((w) => ({
    workflow: w.workflow, runs: w.runs, costUsd: round(w.costUsd, 4), tokens: w.tokens,
    avgCostUsd: round(w.costUsd / w.runs, 4), avgTokens: Math.round(w.tokens / w.runs),
    agentsCostUsd: round(w.agentsCostUsd, 4), medianMinutes: round(median(w.minutes), 1),
  }));
  const outputList = [...outputs].map(([command, o]) => ({ command, calls: o.calls, bytes: o.bytes, tokensEstimated: estimate(o.bytes) })).sort((a, b) => b.bytes - a.bytes);
  const agentList = [...agents].map(([type, a]) => ({ type, runs: a.runs, costUsd: round(a.costUsd, 4), tokens: a.tokens, models: [...a.models].map(modelLabel) })).sort((a, b) => b.costUsd - a.costUsd);

  const stats: UsageStats = {
    from, to: now.toISOString(), days, pricesAsOf: PRICES_AS_OF, logs: options.logs ?? sessions.length,
    okb: {
      runs: runs.length, costUsd: round(okbCost, 4), tokens: okbTokens, tokensByKind,
      cacheHitRatio: cacheHitRatio === null ? null : round(cacheHitRatio, 3),
      agentsCostUsd: round(agentsCost, 4),
      byWorkflow: workflows,
      byModel: [...byModel].map(([model, a]) => ({ model, label: modelLabel(model), costUsd: round(a.costUsd, 4), tokens: a.tokens })).sort((a, b) => b.costUsd - a.costUsd),
      byProfile: [...byProfile].map(([profile, a]) => ({ profile, runs: a.runs, costUsd: round(a.costUsd, 4), tokens: a.tokens })).sort((a, b) => b.costUsd - a.costUsd),
      agents: agentList,
      outputs: outputList,
      skillTokensEstimated: estimate(skillBytes),
      hook: { runs: hookRuns, tokensEstimated: estimate(hookBytes) },
      errors, calls,
      heaviest: amounts.sort((a, b) => b.costUsd - a.costUsd).slice(0, 5).map((a) => ({ ...a, costUsd: round(a.costUsd, 4) })),
    },
    other: { costUsd: round(other.costUsd, 4), tokens: other.tokens },
    daily: [...daily].map(([day, d]) => ({ day, okbCostUsd: round(d.okbCostUsd, 4), otherCostUsd: round(d.otherCostUsd, 4) })).sort((a, b) => a.day.localeCompare(b.day)),
    advice: [],
  };
  return { ...stats, advice: adviseFrom(stats, [...byWorkflow.values()]) };
}

/** Plain advice from the numbers, most useful first. Never a model call. */
function adviseFrom(s: UsageStats, workflows: readonly WorkflowStats[]): Advice[] {
  const out: Advice[] = [];
  const okb = s.okb;
  if (!okb.runs) return out;
  const pct = (x: number) => `${Math.round(x * 100)}`;
  // Subagents on a top model, when they weigh in the bill.
  for (const a of okb.agents) {
    // The evidence reviewer is the safeguard: it stays on a strong model.
    if (!a.type.startsWith('okb:') || a.type === 'okb:okb-evidence-reviewer' || !okb.costUsd) continue;
    const top = a.models.find((m) => /^(Opus|Fable|Mythos)/.test(m));
    if (top && a.costUsd / okb.costUsd >= 0.15) out.push({ key: 'usage.advice.agentModel', params: { agent: a.type, model: top, share: pct(a.costUsd / okb.costUsd) } });
  }
  // CLI outputs that fill the context.
  for (const o of okb.outputs) {
    const perCall = o.tokensEstimated / Math.max(1, o.calls);
    if (perCall >= 4_000) out.push({ key: 'usage.advice.bigOutput', params: { command: `okb ${o.command}`, tokens: String(Math.round(perCall)) } });
  }
  // A cache that rarely hits: long pauses or very short sessions.
  if (okb.cacheHitRatio !== null && okb.cacheHitRatio < 0.6 && okb.tokens > 200_000) out.push({ key: 'usage.advice.cache', params: { ratio: pct(okb.cacheHitRatio) } });
  // Runs far above their workflow's usual cost.
  for (const w of workflows) {
    if (w.runs < 3) continue;
    const med = median(w.costs);
    const outliers = w.costs.filter((c) => med > 0 && c > med * 3).length;
    if (outliers) out.push({ key: 'usage.advice.outliers', params: { workflow: w.workflow, count: String(outliers), median: med.toFixed(2) } });
  }
  if (okb.calls >= 10 && okb.errors / okb.calls >= 0.1) out.push({ key: 'usage.advice.errors', params: { share: pct(okb.errors / okb.calls) } });
  if (okb.hook.runs && okb.hook.tokensEstimated / okb.hook.runs > 1_200) out.push({ key: 'usage.advice.focus', params: { tokens: String(Math.round(okb.hook.tokensEstimated / okb.hook.runs)) } });
  return out;
}
