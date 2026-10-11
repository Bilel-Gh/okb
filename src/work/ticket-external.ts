import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { z } from 'zod';
import { configSchema, type OkbConfig } from '../config/schema.js';
import { loadConfig, okbHome } from '../config/load.js';
import { OkbError } from '../util/errors.js';
import { writeTextAtomic } from '../util/fsx.js';
import { withStateLock } from '../util/state-lock.js';
import { recordExternal, safeUrl } from './ticket-state.js';
import { loadTicket } from './tickets.js';

export const githubInput = z.object({ repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/), number: z.number().int().positive().max(1_000_000_000) }).strict();
const githubConfig = configSchema.shape.connectors.removeDefault().shape.github.unwrap();
export const githubSetupInput = githubConfig.extend({ allowed: z.boolean().refine((v) => v === true, 'The person must opt in explicitly.') }).strict();
export const jiraInput = z.object({ issue: z.string().regex(/^[A-Z][A-Z0-9]{0,15}-\d{1,7}$/), status: z.string().trim().min(1).max(200), url: safeUrl, observedAt: z.string().datetime() }).strict();
const check = z.object({ status: z.string().optional(), conclusion: z.string().nullable().optional(), state: z.string().optional() }).passthrough().refine((v) => Boolean(v.status || v.state), 'A check needs a status.');
const prSchema = z.object({ number: z.number().int().positive(), title: z.string().max(1000), state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean(), reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', '']).nullable(), statusCheckRollup: z.array(check).max(1000).nullable(), url: safeUrl }).passthrough();
export type GithubRunner = (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string>;
const exec = promisify(execFile);
const runGithub: GithubRunner = async (command, args, env) => {
  try {
    return (await exec(command, [...args], { env, encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000 })).stdout;
  } catch (cause) {
    // CLI errors can include authentication headers: do not put its stderr into logs or API replies.
    throw new OkbError('E_IO', 'GitHub read failed; check the gh session for this host', { key: 'ticketGithubReadFailed', cause });
  }
};

/** No login, token read or remote write: only gh pr view, on a repository opted in by the person. */
export async function readGithubPr(config: OkbConfig, ref: string, input: z.infer<typeof githubInput>, runner: GithubRunner = runGithub, env: NodeJS.ProcessEnv = process.env) {
  const p = githubInput.safeParse(input);
  if (!p.success) throw new OkbError('E_INVALID', 'invalid GitHub PR reference');
  const setup = config.connectors.github;
  if (!setup?.enabled || !setup.repositories.includes(p.data.repository) || (config.policy.allowedConnectors !== null && !config.policy.allowedConnectors.includes('github'))) throw new OkbError('E_NOT_APPROVED', 'GitHub read is not configured and allowed for this repository', { key: 'ticketGithubNotAllowed' });
  if (!(await loadTicket(config, ref))) throw new OkbError('E_NOT_FOUND', `no ticket ${ref}`, { key: 'ticketUnknown', params: { ref } });
  const ghEnv: NodeJS.ProcessEnv = { ...env, GH_HOST: setup.host, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', GH_TELEMETRY: 'false' };
  delete ghEnv.GH_DEBUG;
  delete ghEnv.DEBUG;
  const raw = await runner('gh', ['pr', 'view', String(p.data.number), '--repo', `${setup.host}/${p.data.repository}`, '--json', 'number,title,state,isDraft,reviewDecision,statusCheckRollup,url'], ghEnv);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new OkbError('E_INVALID', 'GitHub returned invalid JSON', { key: 'ticketExternalInvalid' }); }
  const result = prSchema.safeParse(data);
  if (!result.success || result.data.number !== p.data.number || new URL(result.data.url).hostname !== setup.host || new URL(result.data.url).pathname !== `/${p.data.repository}/pull/${p.data.number}`) throw new OkbError('E_INVALID', 'GitHub returned an invalid PR snapshot', { key: 'ticketExternalInvalid' });
  const pr = result.data;
  const checks = pr.statusCheckRollup ?? [];
  const outcomes = checks.map((c) => c.state || (c.status === 'COMPLETED' ? c.conclusion ?? 'UNKNOWN' : 'PENDING'));
  const checkStatus = !outcomes.length ? 'unknown' : outcomes.some((o) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(o)) ? 'failed' : outcomes.some((o) => o === 'PENDING') ? 'pending' : outcomes.every((o) => o === 'SUCCESS') ? 'passed' : 'unknown';
  const status = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : pr.reviewDecision === 'APPROVED' ? 'approved' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'changes-requested' : pr.reviewDecision === 'REVIEW_REQUIRED' ? 'review' : 'open';
  const snapshot = { provider: 'github', declared: false, repository: p.data.repository, number: pr.number, title: pr.title, status: pr.state, reviewDecision: pr.reviewDecision, url: pr.url, observedAt: new Date().toISOString() };
  await recordExternal(config, ref, snapshot, [{ dimension: 'pr', status, url: pr.url }, { dimension: 'checks', status: checkStatus, url: pr.url }]);
  return snapshot;
}

/** A person-provided observation; no claim that Jira was contacted or its workflow understood. */
export async function importJiraSnapshot(config: OkbConfig, ref: string, input: z.infer<typeof jiraInput>) {
  const p = jiraInput.safeParse(input);
  if (!p.success || p.data.issue !== ref.toUpperCase()) throw new OkbError('E_INVALID', 'the declared Jira snapshot must name this ticket', { key: 'ticketExternalInvalid' });
  const snapshot = { provider: 'jira', declared: true, ...p.data };
  await recordExternal(config, ref, snapshot);
  return snapshot;
}

export async function configureGithub(config: OkbConfig, env: NodeJS.ProcessEnv, input: z.input<typeof githubSetupInput>) {
  const p = githubSetupInput.safeParse(input);
  if (!p.success) throw new OkbError('E_NOT_APPROVED', 'the person must explicitly allow this GitHub read configuration', { key: 'ticketGithubNotAllowed' });
  if (config.policy.allowedConnectors !== null && !config.policy.allowedConnectors.includes('github')) throw new OkbError('E_CONFIG', 'GitHub is blocked by this profile’s connector policy');
  const { allowed: _allowed, ...github } = p.data;
  const file = resolve(okbHome(env), 'profiles', config.profile.id, 'profile.yaml');
  await withStateLock(file, async () => {
    const doc = YAML.parseDocument(await readFile(file, 'utf8'));
    doc.setIn(['connectors', 'github'], github);
    await writeTextAtomic(file, String(doc));
  });
  await loadConfig({ env, profileId: config.profile.id });
  return github;
}
