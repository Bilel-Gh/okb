import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { listProducts, productOfRepo } from '../brain/products.js';
import { isDismissed, readSubjectFields, type SourcedConflict, type SourcedValue, type SubjectKind } from './sourced-fields.js';
import { newId } from '../projects/projects.js';
import { findRepo, listRepos, type RepoEntry } from '../repo/registry.js';
import { loadMap, repoPaths } from '../repo/state.js';
import { assertNoSecrets } from '../security/guard.js';
import { openDb } from '../state/db.js';
import { OkbError } from '../util/errors.js';

/**
 * The team responsible for a repository or a product (F2.4-19, D73). A
 * repository without its own team shows its product's, marked as inherited.
 * CODEOWNERS that names a team gives a suggestion, never a value: who reviews
 * the code is not always the team responsible.
 */
export type Team = {
  readonly kind: SubjectKind;
  readonly subject: string;
  readonly value: SourcedValue | null;
  readonly inherited: { readonly product: string; readonly value: SourcedValue } | null;
  readonly notApplicable: string | null;
  readonly conflicts: readonly SourcedConflict[];
  readonly suggestion: { readonly value: string; readonly origin: 'github'; readonly file: string; readonly line: number } | null;
  readonly request: SubjectRequest | null;
};

/** The repository, which must belong to this KB. */
export async function teamRepo(config: OkbConfig, subject: string, env: NodeJS.ProcessEnv = process.env): Promise<RepoEntry> {
  const repo = await findRepo(subject, env);
  if (!repo || repo.kb !== config.profile.id) throw new OkbError('E_NOT_FOUND', 'no registered repository in this profile', { key: 'repoUnknown', params: { id: subject } });
  return repo;
}

/** A product: a folder of the brain, or the product chosen for one of this KB's repositories. */
export async function teamProduct(config: OkbConfig, subject: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const name = subject.trim();
  const known = new Set([...(await listProducts(config, env)).map((p) => p.name), ...(await listRepos(env)).filter((r) => r.kb === config.profile.id && r.product).map((r) => r.product!)]);
  if (!known.has(name)) throw new OkbError('E_NOT_FOUND', `no product ${name} in this knowledge base`, { key: 'productUnknown', params: { name } });
  return name;
}

export async function productOf(config: OkbConfig, repo: RepoEntry): Promise<string | null> {
  return (await productOfRepo(config, repo).catch(() => null)) ?? repo.product ?? null;
}

/** The first team CODEOWNERS names for the whole repository (`*`), else for any path. */
async function codeownersTeam(config: OkbConfig, repo: RepoEntry): Promise<Team['suggestion']> {
  const map = await loadMap(repoPaths(config, repo.id)).catch(() => null);
  if (!map) return null;
  const rules = [...map.ownership.codeowners].sort((a, b) => Number(b.pattern === '*') - Number(a.pattern === '*'));
  for (const r of rules) {
    const team = r.owners.find((o) => /^@[\w.-]+\/[\w.-]+$/.test(o));
    if (team) return { value: team, origin: 'github', file: r.evidence.file, line: r.evidence.line };
  }
  return null;
}

export async function teamOf(config: OkbConfig, kind: SubjectKind, subject: string, env: NodeJS.ProcessEnv = process.env): Promise<Team> {
  const id = kind === 'repo' ? (await teamRepo(config, subject, env)).id : await teamProduct(config, subject, env);
  const own = readSubjectFields(config, kind, id);
  const value = own.fields.team ?? null;
  const notApplicable = own.notApplicable.team ?? null;
  let inherited: Team['inherited'] = null;
  let suggestion: Team['suggestion'] = null;
  if (kind === 'repo') {
    const repo = await teamRepo(config, id, env);
    const product = await productOf(config, repo);
    const fromProduct = product ? readSubjectFields(config, 'product', product).fields.team : undefined;
    if (!value && !notApplicable && product && fromProduct) inherited = { product, value: fromProduct };
    const found = await codeownersTeam(config, repo);
    if (found && found.value !== value?.value && !isDismissed(config, 'repo', id, 'team', found.value)) suggestion = found;
  }
  return { kind, subject: id, value, inherited, notApplicable, conflicts: own.conflicts, suggestion, request: openTeamRequests(config, { kind, subject: id })[0] ?? null };
}

/* ------------------------------------------------------------ requests */

export type SubjectRequest = {
  readonly id: string;
  readonly kind: SubjectKind;
  readonly subject: string;
  readonly fields: readonly string[];
  readonly state: 'pending' | 'done' | 'partial' | 'failed' | 'cancelled';
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly report: { readonly found: string[]; readonly missing: string[]; readonly read: string[]; readonly unavailable: string[]; readonly note: string } | null;
};
type Row = { id: string; kind: SubjectKind; subject: string; fields: string; state: SubjectRequest['state']; created_at: string; closed_at: string | null; report: string | null };
const fromRow = (r: Row): SubjectRequest => ({ id: r.id, kind: r.kind, subject: r.subject, fields: JSON.parse(r.fields) as string[], state: r.state, createdAt: r.created_at, closedAt: r.closed_at, report: r.report ? JSON.parse(r.report) as SubjectRequest['report'] : null });
export const reportSchema = z.object({ found: z.array(z.string().max(60)).max(20), missing: z.array(z.string().max(60)).max(20), read: z.array(z.string().max(60)).max(20), unavailable: z.array(z.string().max(60)).max(20), note: z.string().max(1000) }).strict();

/** Ask the agent to find the team (F2.4-20): one open request per subject, never repeated. OKB contacts no source. */
export function requestTeam(config: OkbConfig, kind: SubjectKind, subject: string): SubjectRequest {
  const db = openDb(config);
  return db.tx(() => {
    const open = db.get<Row>("SELECT * FROM subject_requests WHERE kind = ? AND subject = ? AND state = 'pending'", kind, subject);
    if (open) return fromRow(open);
    const row: Row = { id: newId('T'), kind, subject, fields: JSON.stringify(['team']), state: 'pending', created_at: new Date().toISOString(), closed_at: null, report: null };
    db.run('INSERT INTO subject_requests (id, kind, subject, fields, state, created_at) VALUES (?, ?, ?, ?, ?, ?)', row.id, row.kind, row.subject, row.fields, row.state, row.created_at);
    return fromRow(row);
  });
}

export function openTeamRequests(config: OkbConfig, filter: { kind?: SubjectKind; subject?: string } = {}): SubjectRequest[] {
  return openDb(config).all<Row>("SELECT * FROM subject_requests WHERE state = 'pending' ORDER BY created_at")
    .filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.subject || r.subject === filter.subject)).map(fromRow);
}

export function closeTeamRequest(config: OkbConfig, id: string, report: z.input<typeof reportSchema>): SubjectRequest {
  const p = reportSchema.safeParse(report);
  if (!p.success) throw new OkbError('E_INVALID', p.error.issues[0]?.message ?? 'invalid report', { key: 'ticketRequestReport' });
  assertNoSecrets(p.data, 'request report');
  const db = openDb(config);
  const row = db.get<Row>('SELECT * FROM subject_requests WHERE id = ?', id);
  if (!row) throw new OkbError('E_NOT_FOUND', `no request ${id}`, { key: 'ticketRequestUnknown' });
  if (row.state !== 'pending') throw new OkbError('E_CONFLICT', `request ${id} is already ${row.state}`, { key: 'ticketRequestClosed' });
  const state: SubjectRequest['state'] = !p.data.missing.length ? 'done' : !p.data.found.length && p.data.unavailable.length ? 'failed' : 'partial';
  const closed = { ...row, state, closed_at: new Date().toISOString(), report: JSON.stringify(p.data) };
  db.run('UPDATE subject_requests SET state = ?, closed_at = ?, report = ? WHERE id = ?', closed.state, closed.closed_at, closed.report, id);
  return fromRow(closed);
}

export function cancelTeamRequest(config: OkbConfig, id: string): void {
  openDb(config).run("UPDATE subject_requests SET state = 'cancelled', closed_at = ? WHERE id = ? AND state = 'pending'", new Date().toISOString(), id);
}

/** A name the agent pastes into a command stays one argument: single quotes, never interpreted. */
const shellQuote = (s: string) => (/^[\w.@/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** A prompt to paste in an agent session: where to look, how to write, what to report. */
export function teamPrompt(req: SubjectRequest, lang: 'fr' | 'en'): string {
  const what = req.kind === 'repo' ? (lang === 'fr' ? `du repo ${req.subject}` : `of repository ${req.subject}`) : (lang === 'fr' ? `du produit « ${req.subject} »` : `of product "${req.subject}"`);
  const set = `okb team set ${req.kind} ${shellQuote(req.subject)} --value "<…>" --origin <servicenow|jira|wiki|other> --url <…>`;
  return lang === 'fr'
    ? `Trouve l’équipe responsable ${what} dans OKB. Cherche avec tes outils : groupe d’affectation du service dans ServiceNow, équipe ou composant du projet dans Jira, page « Équipe » du wiki. Écris-la avec \`${set}\`, puis rends compte avec \`okb team requests close ${req.id} --found … --missing … --read … --unavailable …\`. N’invente rien ; dis ce que tu n’as pas pu lire.`
    : `Find the team responsible ${what} in OKB. Look with your tools: the service's assignment group in ServiceNow, the project's team or component in Jira, the wiki's team page. Write it with \`${set}\`, then report with \`okb team requests close ${req.id} --found … --missing … --read … --unavailable …\`. Do not invent anything; say what you could not read.`;
}
