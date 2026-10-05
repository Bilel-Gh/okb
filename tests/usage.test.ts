import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProposal } from '../src/apply/apply.js';
import { grantApproval } from '../src/apply/approval.js';
import { proposeCategory } from '../src/categories/assign.js';
import { saveProposal } from '../src/proposal/store.js';
import { listSessions, summariseSession } from '../src/usage/claude-logs.js';
import { collectUsage } from '../src/usage/collect.js';
import { addFeedback, readEvents, recordEvent } from '../src/usage/events.js';
import { costOf, modelLabel, priceOf } from '../src/usage/prices.js';
import { qualitySignals } from '../src/usage/quality.js';
import { commandStats, renderReport } from '../src/usage/report.js';
import { computeStats } from '../src/usage/stats.js';
import { suggestIntent } from '../src/routing/intent.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const sandboxes: Sandbox[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const usage = (input: number, output: number, read = 0, write1h = 0) => ({
  input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write1h,
  cache_creation: { ephemeral_1h_input_tokens: write1h, ephemeral_5m_input_tokens: 0 }, speed: 'standard',
});

/** A fictitious Claude Code log: an ingest, a plain question, a turn developing OKB. */
async function fakeLogs(devRoot: string) {
  const root = await mkdtemp(resolve(tmpdir(), 'okb-claude-'));
  dirs.push(root);
  const project = join(root, 'projects', '-tmp-kb');
  await mkdir(join(project, 's1', 'subagents'), { recursive: true });
  let n = 0;
  const line = (o: Record<string, unknown>) => JSON.stringify({ uuid: `u${++n}`, cwd: '/tmp/kb', ...o });
  const at = (m: number) => `2026-10-04T10:${String(m).padStart(2, '0')}:00.000Z`;
  const answer = (id: string, model: string, u: object, content: object[], m: number) => line({ type: 'assistant', timestamp: at(m), message: { id, model, usage: u, content } });
  const rows = [
    line({ type: 'attachment', timestamp: at(0), attachment: { type: 'hook_success', hookEvent: 'SessionStart', stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'OKB: active profile "acme"' } }) } }),
    line({ type: 'user', timestamp: at(1), message: { content: '<command-name>/okb:ingest</command-name> notes.vtt' } }),
    line({ type: 'user', timestamp: at(1), isMeta: true, message: { content: 'Base directory for this skill: /x/plugin/skills/okb-ingest\n# Prepare a sourced knowledge change' } }),
    // One answer written as two lines (one per content block): counted once.
    answer('m1', OPUS, usage(10, 100, 1000, 2000), [{ type: 'text', text: 'Je lis la source.' }], 2),
    answer('m1', OPUS, usage(10, 100, 1000, 2000), [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'okb ingest notes.vtt --extract-only --json' } }], 2),
    line({ type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(3800) }] } }),
    answer('m2', OPUS, usage(5, 50, 3000), [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'okb:okb-evidence-reviewer' } }], 4),
    line({ type: 'user', timestamp: at(9), message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }),
    // A background subagent ending: same task, not a new message from the person.
    line({ type: 'user', timestamp: at(10), message: { content: '<task-notification>\n<task-id>a1</task-id>\n</task-notification>' } }),
    answer('m2b', OPUS, usage(1, 5), [{ type: 'text', text: 'Relecture reçue.' }], 11),
    // A plain question: not OKB.
    line({ type: 'user', timestamp: at(20), message: { content: 'Quelle heure est-il ?' } }),
    answer('m3', OPUS, usage(20, 10), [{ type: 'text', text: 'Midi.' }], 21),
    // Someone changing OKB's own code, then trying the CLI: development, not usage.
    line({ type: 'user', timestamp: at(30), message: { content: 'Corrige le bug' } }),
    answer('m4', OPUS, usage(1, 10), [{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: `${devRoot}/src/a.ts` } }, { type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'okb status --kb acme' } }], 31),
  ];
  // A resumed session copies earlier lines with the same ids.
  rows.push(rows[3]!, rows[4]!);
  await writeFile(join(project, 's1.jsonl'), `${rows.join('\n')}\n`);
  await writeFile(join(project, 's1', 'subagents', 'agent-a.meta.json'), JSON.stringify({ agentType: 'okb:okb-evidence-reviewer', toolUseId: 't2' }));
  await writeFile(join(project, 's1', 'subagents', 'agent-a.jsonl'), [
    JSON.stringify({ uuid: 'a1', type: 'assistant', message: { id: 'sa1', model: SONNET, usage: usage(100, 200, 5000) } }),
    JSON.stringify({ uuid: 'a2', type: 'assistant', message: { id: 'sa1', model: SONNET, usage: usage(100, 200, 5000) } }),
  ].join('\n'));
  return { root, projects: join(root, 'projects') };
}

describe('what OKB costs', () => {
  it('prices tokens like the API, cache and fast mode included', () => {
    expect(priceOf('claude-opus-5-5-20261001')).toMatchObject({ input: 4, read: 0.2, output: 20, write1h: 8 });
    expect(priceOf('claude-opus-5')?.input).toBe(5);
    expect(costOf(OPUS, { input: 1_000_000, output: 0, write5m: 0, write1h: 0, read: 0 }, 'fast')).toBe(8);
    expect(costOf('claude-haiku-4-5-20251001', { input: 0, output: 1_000_000, write5m: 0, write1h: 0, read: 1_000_000 })).toBeCloseTo(5.1);
    expect(costOf('mystery-model', { input: 1e6, output: 1e6, write5m: 0, write1h: 0, read: 0 })).toBe(0);
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel(OPUS)).toBe('Opus 5.5');
    // Through a cloud provider or a company gateway.
    expect(priceOf('us.anthropic.claude-sonnet-4-5-20250929-v1:0')?.input).toBe(3);
    expect(priceOf('claude-opus-4-5@20251101')?.input).toBe(5);
    expect(priceOf('anthropic/claude-sonnet-4.5')?.input).toBe(3);
    expect(modelLabel('eu.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Haiku 4.5');
  });

  it('reads Claude Code logs: each answer once, OKB tasks apart, subagents with their task, development left out', async () => {
    const devRoot = '/work/okb';
    const { projects } = await fakeLogs(devRoot);
    const [entry] = await listSessions(projects);
    const s = await summariseSession(entry!, () => 'acme', devRoot);
    expect(s.okbRuns.map((r) => r.workflow)).toEqual(['ingest']);
    const run = s.okbRuns[0]!;
    // m1, m2 and the answer after the notification, each once despite the duplicated lines.
    expect(run.main[OPUS]!.requests).toBe(3);
    expect(run.main[OPUS]!.tokens).toEqual({ input: 16, output: 155, write5m: 0, write1h: 2000, read: 4000 });
    expect(run.main[OPUS]!.costUsd).toBeCloseTo((16 * 4 + 155 * 20 + 2000 * 8 + 4000 * 0.2) / 1e6);
    expect(run.agents).toHaveLength(1);
    expect(run.agents[0]!.type).toBe('okb:okb-evidence-reviewer');
    expect(run.agents[0]!.usage[SONNET]!.requests).toBe(1);
    expect(run.outputBytes).toEqual({ ingest: 3800 });
    expect(run.outputCalls).toEqual({ ingest: 1 });
    expect(run.skillBytes).toBeGreaterThan(30);
    expect(run.profile).toBe('acme');
    // The question and the development turn count as other usage.
    expect(Object.keys(s.other)).toEqual(['2026-10-04']);
    expect(s.other['2026-10-04']![OPUS]!.requests).toBe(2);
    expect(s.hookRuns).toBe(1);
  });

  it('turns sessions into stats and advice, without a model call', async () => {
    const { projects } = await fakeLogs('/work/okb');
    const [entry] = await listSessions(projects);
    const s = await summariseSession(entry!, () => 'acme', '/work/okb');
    const stats = computeStats([s], { days: 7, now: new Date('2026-10-05T00:00:00Z') });
    expect(stats.okb.runs).toBe(1);
    expect(stats.okb.byWorkflow[0]).toMatchObject({ workflow: 'ingest', runs: 1 });
    expect(stats.okb.agents[0]).toMatchObject({ type: 'okb:okb-evidence-reviewer', models: ['Sonnet 5.5'] });
    expect(stats.okb.outputs[0]).toMatchObject({ command: 'ingest', calls: 1, tokensEstimated: 1000 });
    expect(stats.other.costUsd).toBeGreaterThan(0);
    expect(stats.okb.cacheHitRatio).toBeGreaterThan(0.5);
    // Out of the period: nothing.
    expect(computeStats([s], { days: 1, now: new Date('2026-10-20T00:00:00Z') }).okb.runs).toBe(0);
  });

  it('logs commands without their arguments, keeps remarks, and writes a report free of note text', async () => {
    const sb = await makeSandbox({ profileId: 'acme' });
    sandboxes.push(sb);
    const { root } = await fakeLogs('/work/okb');
    const env = { ...sb.env, CLAUDE_CONFIG_DIR: root };
    await recordEvent({ at: new Date().toISOString(), command: 'capture', ok: true, ms: 12, by: 'person' }, env);
    await recordEvent({ at: new Date().toISOString(), command: 'ingest', ok: false, code: 'E_EVIDENCE', ms: 40, kb: 'acme', by: 'claude' }, env);
    const events = await readEvents(env);
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toMatch(/notes\.vtt/);
    expect(commandStats(events, '')).toEqual(expect.arrayContaining([expect.objectContaining({ command: 'ingest', failures: 1, codes: { E_EVIDENCE: 1 }, byClaude: 1 })]));
    await addFeedback({ at: new Date().toISOString(), text: 'Le résumé a oublié la décision', where: 'cli' }, env);

    // A proposal half approved, then a note retouched by hand.
    const config = await sb.config();
    const proposal = await proposeCategory(config, 'concepts/idempotence.md', 'guide');
    await saveProposal(config, proposal);
    await grantApproval(config, proposal, proposal.changes.map((c) => c.id), 'human:testuser');
    await applyProposal(config, proposal);
    const path = resolve(sb.vault, 'concepts/idempotence.md');
    await writeFile(path, `${await readFile(path, 'utf8')}\nAjout à la main.\n`);
    const q = await qualitySignals(config);
    expect(q).toMatchObject({ proposals: 1, applied: 1, pending: 0, editedAfter: 1, appliedFiles: 1, editedPaths: ['concepts/idempotence.md'] });

    const data = await collectUsage({ days: 30, env });
    expect(data.feedback).toHaveLength(1);
    expect(data.quality.map((x) => x.kb)).toEqual(['acme']);
    const report = renderReport({ ...data, version: '0.7.0' });
    expect(report).toContain('ingest');
    expect(report).toContain('Le résumé a oublié la décision');
    expect(report).not.toContain('Ajout à la main');
    expect(report).not.toContain('concepts/idempotence.md');
    expect(renderReport({ ...data, version: '0.7.0', withPaths: true })).toContain('concepts/idempotence.md');
  });

  it('offers usage and feedback from plain words', () => {
    const none = { kbs: [], otherTools: [] };
    expect(suggestIntent('combien me coûte okb ce mois-ci ?', none)?.command).toBe('okb usage');
    expect(suggestIntent('how much does okb cost?', none)?.command).toBe('okb usage');
    expect(suggestIntent('note un retour sur okb : le résumé a oublié la décision', none)?.command).toBe('okb feedback');
    expect(suggestIntent('report a bug to okb: the graph is empty', none)?.command).toBe('okb feedback');
    expect(suggestIntent('combien coûte un robot ?', none)).toBeNull();
  });
});
