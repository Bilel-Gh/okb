import { resolve } from 'node:path';
import { loadBundleFor } from '../kb/bundle.js';
import { assertNoSecrets } from '../security/guard.js';
import { OkbError } from '../util/errors.js';
import { writeTextAtomic } from '../util/fsx.js';
import { branchBase, commitsBetween, diffNames, gitIdentity, type CommitInfo, type FileChange } from './git.js';
import { classify } from './inventory.js';
import { repoNotes, type RepoContext } from './notes.js';
import { notePath, ticketPath } from './pack.js';
import { repoPlace } from '../brain/products.js';
import { loadProgress } from './state.js';

/**
 * After a ticket: everything OKB can establish without guessing — the branch,
 * its commits, the files it changed, the notes that cite those files — saved as
 * a dated context document (with the ticket text the person gave), so the
 * skill can enrich the repository's KB from facts: the final code, the commit
 * messages and the person's own words.
 */
export type TicketContext = {
  readonly file: string;
  readonly title: string;
  readonly branch: string | null;
  readonly base: { readonly ref: string; readonly sha: string };
  readonly head: string | null;
  readonly commits: readonly CommitInfo[];
  readonly changes: readonly (FileChange & { readonly kind: string })[];
  /** Notes that cite a changed file: candidates for a dated update. */
  readonly affectedNotes: readonly { readonly path: string; readonly files: readonly string[] }[];
  readonly suggested: { readonly ticketNote: string; readonly codemap: string };
};

/** What a followed ticket already knows: where it started, its branch, its journal. */
export type TicketFollow = {
  readonly from: { readonly ref: string; readonly sha: string };
  /** The branch's tip (`HEAD` when checked out), or null when the branch is gone. */
  readonly to: string | null;
  readonly journal: readonly { readonly kind: string; readonly text: string; readonly sha?: string; readonly repo?: string }[];
};

export async function ticketContext(ctx: RepoContext, input: { base?: string; title?: string; ticket?: string; by?: string; follow?: TicketFollow }): Promise<TicketContext> {
  const { repo, config, paths } = ctx;
  const follow = input.follow;
  const base = follow?.from ?? await branchBase(repo.path, input.base);
  if (!base) throw new OkbError('E_NOT_FOUND', 'cannot find where this branch started', { key: 'repoNoBase', hint: 'Pass the branch it started from: --base main (or origin/develop).' });
  const identity = await gitIdentity(repo.path);
  const tip = follow ? follow.to : 'HEAD';
  const commits = tip ? await commitsBetween(repo.path, base.sha, tip) : [];
  // Without a follow-up, uncommitted work counts too (diff against the working tree).
  const changes = (tip ? (await diffNames(repo.path, base.sha, follow ? tip : undefined)) ?? [] : []).map((c) => ({ ...c, kind: classify(c.path).kind }));
  const journal = (follow?.journal ?? []).filter((j) => !j.repo || j.repo === repo.id);
  const lostCommits = journal.filter((j) => j.kind === 'commit' && j.sha && !commits.some((c) => c.sha === j.sha));
  const learned = journal.filter((j) => ['decision', 'trap', 'question', 'note'].includes(j.kind));
  if (!commits.length && !changes.length && !lostCommits.length && !learned.length) throw new OkbError('E_NOT_FOUND', 'nothing changed on this branch yet', { key: 'repoNoChanges', params: { base: base.ref } });
  if (input.ticket) assertNoSecrets({ ticket: input.ticket }, 'ticket text');
  const lang = config.writing.language ?? config.profile.answer.language;
  const fr = lang.startsWith('fr');
  const title = input.title?.trim() || commits[commits.length - 1]?.subject || identity.branch || 'ticket';
  const day = new Date().toISOString().slice(0, 10);

  const bundle = await loadBundleFor(config);
  const progress = await loadProgress(paths);
  const changed = new Set(changes.flatMap((c) => [c.path, ...(c.from ? [c.from] : [])]));
  const prefix = `${repo.name}/`;
  const place = await repoPlace(config, repo);
  const affectedNotes = repoNotes(bundle, repo.id, place).map((n) => {
    const fromAnchors = Object.keys(progress.anchors[n.path]?.files ?? {});
    const sources = bundle.docs.get(n.path)?.data.sources;
    const fromSources = Array.isArray(sources) ? (sources as { title?: unknown }[]).map((s) => (typeof s?.title === 'string' && s.title.startsWith(prefix) ? s.title.slice(prefix.length) : null)).filter((x): x is string => x !== null) : [];
    return { path: n.path as string, files: [...new Set([...fromAnchors, ...fromSources])].filter((f) => changed.has(f)) };
  }).filter((n) => n.files.length);

  const lines = [
    `# ${fr ? 'Contexte du ticket' : 'Ticket context'} — ${title}`,
    '',
    `${fr ? 'Repo' : 'Repository'} ${repo.name} · ${fr ? 'branche' : 'branch'} ${identity.branch ?? '?'} · ${fr ? 'depuis' : 'since'} ${base.ref} (${base.sha.slice(0, 10)}) · ${day}`,
    '',
  ];
  if (input.ticket?.trim()) {
    lines.push(`## ${fr ? 'Le ticket, tel que donné par' : 'The ticket, as given by'} ${input.by?.trim() || (fr ? 'la personne' : 'the person')}`, '', input.ticket.trim(), '');
  }
  if (commits.length) {
    lines.push(`## ${fr ? 'Commits' : 'Commits'}`, '');
    for (const c of [...commits].reverse()) {
      lines.push(`- ${c.sha.slice(0, 10)} ${c.date.slice(0, 10)} ${c.author} : ${c.subject}`);
      if (c.body) for (const l of c.body.split('\n').filter(Boolean).slice(0, 12)) lines.push(`  ${l}`);
    }
    lines.push('');
  }
  if (lostCommits.length) {
    lines.push(`## ${fr ? 'Commits relevés pendant le travail (plus sur la branche)' : 'Commits seen during the work (no longer on the branch)'}`, '');
    for (const c of lostCommits) lines.push(`- ${c.sha!.slice(0, 10)} : ${c.text}`);
    lines.push('');
  }
  if (learned.length) {
    const label: Record<string, string> = fr
      ? { decision: 'Décision', trap: 'Piège', question: 'Question', note: 'Note' }
      : { decision: 'Decision', trap: 'Trap', question: 'Question', note: 'Note' };
    lines.push(`## ${fr ? 'Journal du ticket (noté pendant le travail)' : 'Ticket journal (noted during the work)'}`, '');
    for (const j of learned) lines.push(`- ${label[j.kind] ?? j.kind} : ${j.text}`);
    lines.push('');
  }
  if (changes.length) {
    lines.push(`## ${fr ? 'Fichiers modifiés' : 'Changed files'}`, '');
    for (const c of changes) lines.push(`- ${c.status} ${c.from ? `${c.from} → ` : ''}${c.path}`);
    lines.push('');
  }
  const text = lines.join('\n');
  assertNoSecrets({ text }, 'ticket context');
  const file = resolve(paths.tickets, `${day}-${title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'ticket'}.md`);
  await writeTextAtomic(file, text);
  return {
    file, title, branch: identity.branch, base, head: identity.head, commits, changes, affectedNotes,
    suggested: { ticketNote: ticketPath(repo.id, title, new Date(), place), codemap: notePath(repo.id, 'codemap', lang, place) },
  };
}
