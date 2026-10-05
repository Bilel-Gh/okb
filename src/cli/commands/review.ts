import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { applyProposal, rollback, type Receipt } from '../../apply/apply.js';
import { approvalPath, grantApproval } from '../../apply/approval.js';
import { commitKbChanges, type GitCommitResult } from '../../apply/git.js';
import { assertGuard, guardApply } from '../../apply/guard.js';
import type { OkbConfig } from '../../config/schema.js';
import { formatDate, relativeTime, t, tn } from '../../i18n/index.js';
import { unifiedDiff } from '../../proposal/diff.js';
import { expandBlockRanges } from '../../pipeline/analysis.js';
import { groupChangesByPath, materializeFile } from '../../proposal/materialize.js';
import { resolveSelection, type Proposal } from '../../proposal/model.js';
import { loadProposal, updateProposalStatus } from '../../proposal/store.js';
import { lastUndoable, proposalSummaries, proposalTitle, receipts, resolveProposalRef, summarize } from '../../status/status.js';
import { OkbError } from '../../util/errors.js';
import { readTextIfExists } from '../../util/fsx.js';
import { paginate } from '../../util/context-meter.js';
import { bundlePathToAbsolute } from '../../util/paths.js';
import { flagBool, flagList, flagNumber, flagString } from '../args.js';
import { choose, chooseMany, confirm, spin } from '../ui/prompt.js';
import { colorEnabled, diffLine, paint, sym } from '../ui/term.js';
import { canAsk, effective, kbFlag, type Ctx } from './common.js';

const ICON: Record<string, string> = { 'concept-card': '💡', article: '📘', link: '🔗', metadata: '🏷️' };

async function diffsFor(config: OkbConfig, proposal: Proposal, ids: readonly string[]) {
  const selected = proposal.changes.filter((c) => ids.includes(c.id));
  const out: { path: string; diff: string; stats: { added: number; removed: number }; created: boolean }[] = [];
  for (const [path, changes] of groupChangesByPath(selected)) {
    const before = await readTextIfExists(bundlePathToAbsolute(config.kb.root, path));
    const after = materializeFile(path, before, changes);
    const { text, stats } = unifiedDiff(before ?? '', after, { path });
    out.push({ path, diff: text, stats, created: before === null });
  }
  return out;
}

/** Long text goes to `less` on a terminal, so the screen is not flooded. */
function page(text: string): Promise<void> {
  return new Promise((done) => {
    const pager = spawn(process.env.PAGER || 'less', process.env.PAGER ? [] : ['-R', '-F', '-X'], { stdio: ['pipe', 'inherit', 'inherit'] });
    pager.on('error', () => { process.stdout.write(text); done(); });
    pager.on('close', () => done());
    pager.stdin.on('error', () => undefined);
    pager.stdin.end(text);
  });
}

function reportGit(ctx: Ctx, config: OkbConfig, git: GitCommitResult | null): void {
  if (!git) return;
  if (git.committed) ctx.out.ok(t('apply.committed', { sha: git.sha, files: git.paths }));
  else if (config.git.autoCommit) ctx.out.later(t('apply.notCommitted', { reason: git.reason }));
}

async function applyAndReport(ctx: Ctx, config: OkbConfig, proposal: Proposal, only?: readonly string[]): Promise<Receipt> {
  const s = spin(t('apply.running'));
  let receipt: Receipt;
  try {
    receipt = await applyProposal(config, proposal, only ? { only } : {});
    s.done(t('apply.done'));
  } catch (e) {
    s.fail(t('apply.failed'));
    throw e;
  }
  const written = receipt.results.filter((r) => r.action !== 'skipped').map((r) => r.path);
  const git = await commitKbChanges(config, written, `okb: apply ${proposal.id} (${written.length} file(s))\n\n${proposalTitle(proposal)}\nReceipt: ${receipt.id}`);
  const created = receipt.results.filter((r) => r.action === 'created').length;
  const updated = receipt.results.filter((r) => r.action === 'updated').length;
  ctx.out.ok(t('apply.summary', { created, updated, deleted: receipt.results.filter((r) => r.action === 'deleted').length }));
  reportGit(ctx, config, git);
  ctx.out.line(paint.dim(`  ${t('apply.undoHint')} ${paint.code(`okb undo${kbFlag(ctx.args)}`)}`));
  ctx.out.flush();
  return receipt;
}

function printHeader(ctx: Ctx, proposal: Proposal, number: number | null): void {
  const s = summarize(proposal, number);
  const lines = [
    `${paint.bold(s.title)}`,
    `${tn('review.files', s.files)} · ${t('review.createdUpdated', { created: s.created, updated: s.updated })} · ${t('review.prepared', { when: relativeTime(s.createdAt) })}`,
    paint.dim(`${proposal.id}`),
  ];
  ctx.out.box(lines, number ? t('review.boxTitleN', { n: number }) : t('review.boxTitle'), proposal.status === 'prepared' ? 'brand' : 'plain');
}

function printChanges(ctx: Ctx, proposal: Proposal, diffs: Awaited<ReturnType<typeof diffsFor>>): void {
  const byPath = new Map(diffs.map((d) => [d.path, d]));
  const rows = [...new Map(proposal.changes.map((c) => [c.path, c])).values()].map((c) => {
    const d = byPath.get(c.path);
    return [ICON[c.category] ?? '📄', c.path, d ? `${paint.added(`+${d.stats.added}`)} ${paint.removed(`−${d.stats.removed}`)}` : '', d?.created ? t('review.new') : t('review.changed')];
  });
  ctx.out.grid(rows, ['', t('review.col.file'), t('review.col.lines'), '']);
  const notes = proposal.notes.filter(Boolean);
  if (notes.length) ctx.out.box(notes.slice(0, 8).map((n) => `• ${n}`), t('review.notes'), 'info');
  for (const c of proposal.contradictions) ctx.out.warn(t('review.contradiction', { path: c.path, existing: c.existingClaim, incoming: c.incomingClaim }));
}

/** `okb review` — what waits for you, then one proposal: read, choose, approve and apply. */
export async function cmdReview(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const ref = args.positionals[0];

  if (flagBool(args, 'list') || (!ref && !canAsk(ctx))) {
    const all = await proposalSummaries(config, { all: flagBool(args, 'all') });
    if (ctx.mode === 'json') {
      out.json({ ok: true, proposals: all.map((p) => ({ id: p.id, number: p.number, title: p.title, createdAt: p.createdAt, status: p.status, changes: p.changes, files: p.files })) });
      return 0;
    }
    const pending = all.filter((p) => p.status === 'prepared');
    if (!pending.length) out.ok(t('review.nothingPending'));
    else out.grid(pending.map((p) => [paint.bold(`#${p.number}`), p.title, tn('review.files', p.files), relativeTime(p.createdAt)]), ['', t('review.col.proposal'), t('review.col.size'), t('review.col.prepared')]);
    const history = all.filter((p) => p.status !== 'prepared');
    if (flagBool(args, 'all') && history.length) {
      out.heading(t('review.history'));
      out.grid(history.map((p) => [t(`review.status.${p.status}`), p.title, tn('review.files', p.files), formatDate(p.createdAt)]));
    } else if (!flagBool(args, 'all')) {
      const hidden = (await proposalSummaries(config, { all: true })).filter((p) => p.status !== 'prepared').length;
      if (hidden) out.line(paint.dim(t('review.hidden', { n: hidden })));
    }
    if (pending.length) out.next([`okb review ${pending.length === 1 ? '1' : '<n>'}${kbFlag(args)}`]);
    return 0;
  }

  let proposal: Proposal;
  let number: number | null = null;
  if (!ref) {
    const pending = (await proposalSummaries(config)).filter((p) => p.number !== null);
    if (!pending.length) { out.ok(t('review.nothingPending')); return 0; }
    const pick = pending.length === 1 ? pending[0]!.id : await choose(t('review.pick'), pending.map((p) => ({ value: p.id, label: `#${p.number}  ${p.title}`, hint: `${tn('review.files', p.files)} · ${relativeTime(p.createdAt)}` })));
    proposal = await loadProposal(config, pick);
  } else {
    proposal = await resolveProposalRef(config, ref);
  }
  number = (await proposalSummaries(config)).find((p) => p.id === proposal.id)?.number ?? null;

  if (flagBool(args, 'discard')) {
    if (proposal.status !== 'prepared') throw new OkbError('E_CONFLICT', `proposal ${proposal.id} is ${proposal.status}; only a prepared proposal can be discarded`, { key: 'discardNotPending', params: { status: t(`review.status.${proposal.status}`) } });
    await updateProposalStatus(config, proposal.id, 'superseded');
    await rm(approvalPath(config, proposal.id), { force: true });
    if (ctx.mode === 'json') out.json({ ok: true, discarded: proposal.id });
    else out.ok(t('review.discarded'));
    return 0;
  }

  const done = proposal.status === 'applied' || proposal.status === 'partially-applied';
  if (done && flagBool(args, 'approve')) {
    throw new OkbError('E_CONFLICT', `proposal ${proposal.id} is already ${proposal.status} (receipt rcpt-${proposal.id}); nothing to approve`, {
      key: 'alreadyApplied', params: { when: '' }, hint: 'Nothing to do: it is already in your KB.',
    });
  }
  if (flagBool(args, 'approve') && proposal.status === 'superseded') throw new OkbError('E_CONFLICT', 'a superseded proposal cannot be approved; prepare a new proposal', { key: 'supersededProposal' });

  const only = flagList(args, 'only');
  const requested = only.length > 0 ? only : proposal.changes.map((c) => c.id);
  const { accepted, dropped } = resolveSelection(proposal, requested);
  if (!done) assertGuard(await guardApply(config, proposal, proposal.changes.filter((c) => accepted.includes(c.id))));

  if (flagBool(args, 'approve')) {
    const approval = await grantApproval(config, proposal, accepted, config.profile.humanActor);
    if (ctx.mode === 'json') { out.json({ ok: true, approved: accepted, dropped, contentHash: proposal.contentHash, approvedAt: approval.approvedAt }); return 0; }
    out.ok(t('review.approved', { n: accepted.length, id: proposal.id }));
    for (const d of dropped) out.line(paint.dim(`  ${t('review.dropped', { id: d.id, reason: d.reason })}`));
    out.next([`okb apply ${proposal.id}${only.length ? ` --only ${accepted.join(',')}` : ''}${kbFlag(args)}`]);
    return 0;
  }

  const diffs = done ? [] : await diffsFor(config, proposal, accepted);
  if (ctx.mode === 'json') {
    const limit = flagNumber(args, 'limit') ?? config.context.pageSize;
    const cursor = flagString(args, 'cursor');
    out.json({
      ok: true,
      proposal: { id: proposal.id, status: proposal.status, contentHash: proposal.contentHash, notes: proposal.notes, title: proposalTitle(proposal), number },
      changes: proposal.changes.map((c) => ({ id: c.id, category: c.category, kind: c.kind, path: c.path, label: c.label, rationale: c.rationale, dependsOn: c.dependsOn })),
      contradictions: proposal.contradictions,
      analysisSummary: proposal.analysis ? { reviewedBlocks: expandBlockRanges(proposal.analysis.reviewedBlockIds).length, claims: proposal.analysis.sections.flatMap((s) => s.claims).length, corrections: proposal.analysis.corrections, caveat: 'coverage is an author declaration; quote identity is checked; entailment needs review' } : null,
      claims: proposal.analysis ? paginate(proposal.analysis.sections.flatMap((s) => s.claims), { limit, cursor }) : null,
      evidence: paginate(proposal.evidence, { limit, cursor }).page,
      evidencePagination: paginate(proposal.evidence, { limit, cursor }).truncation,
      diffs: flagBool(args, 'diff') ? paginate(diffs, { limit, cursor }).page : diffs.map(({ path, stats }) => ({ path, stats })),
      diffPagination: paginate(diffs, { limit, cursor }).truncation,
    });
    return 0;
  }

  printHeader(ctx, proposal, number);
  if (done) {
    out.ok(t('review.alreadyApplied'));
    return 0;
  }
  if (proposal.status === 'superseded') { out.info(t('review.superseded')); return 0; }
  printChanges(ctx, proposal, diffs);

  if (flagBool(args, 'diff') || !canAsk(ctx)) {
    if (flagBool(args, 'diff')) for (const d of diffs) out.line(`\n${paint.bold(`# ${d.path}`)}  ${paint.added(`+${d.stats.added}`)}/${paint.removed(`-${d.stats.removed}`)}\n${d.diff.split('\n').map(diffLine).join('\n')}`);
    out.next([`okb review ${number ?? proposal.id}${kbFlag(args)}`, `okb review ${proposal.id} --approve${kbFlag(args)}`]);
    return 0;
  }

  // Interactive: the person at the keyboard reads, chooses, then approves and applies.
  let selection = accepted;
  for (;;) {
    const action = await choose(t('review.action.q'), [
      { value: 'apply', label: t('review.action.apply'), hint: tn('review.changesHint', selection.length), recommended: true },
      { value: 'diff', label: t('review.action.diff') },
      { value: 'select', label: t('review.action.select') },
      { value: 'approve', label: t('review.action.approveOnly') },
      { value: 'discard', label: t('review.action.discard') },
      { value: 'quit', label: t('review.action.later') },
    ]);
    if (action === 'quit') { out.info(t('review.later')); return 0; }
    if (action === 'diff') {
      const current = await diffsFor(config, proposal, selection);
      const text = current.map((d) => `${paint.bold(`# ${d.path}`)}  +${d.stats.added}/-${d.stats.removed}\n${d.diff.split('\n').map((l) => (colorEnabled() ? diffLine(l) : l)).join('\n')}\n`).join('\n');
      await page(text);
      continue;
    }
    if (action === 'select') {
      const groups = [...groupChangesByPath(proposal.changes)].map(([path, changes]) => ({ path, ids: changes.map((c) => c.id), category: changes[0]!.category }));
      const keep = await chooseMany(t('review.select.q'), groups.map((g) => ({ value: g.path as string, label: `${ICON[g.category] ?? '📄'} ${g.path}` })), groups.filter((g) => g.ids.some((id) => selection.includes(id))).map((g) => g.path as string));
      const ids = groups.filter((g) => keep.includes(g.path)).flatMap((g) => g.ids);
      const res = resolveSelection(proposal, ids.length ? ids : []);
      selection = res.accepted;
      for (const d of res.dropped) out.line(paint.dim(`  ${t('review.dropped', { id: d.id, reason: d.reason })}`));
      out.info(tn('review.selectionNow', selection.length));
      continue;
    }
    if (action === 'discard') {
      if (await confirm(t('review.discard.q'), false)) {
        await updateProposalStatus(config, proposal.id, 'superseded');
        out.ok(t('review.discarded'));
        return 0;
      }
      continue;
    }
    if (!selection.length) { out.warn(t('review.emptySelection')); continue; }
    if (!(await confirm(action === 'apply' ? t('review.confirmApply', { n: selection.length }) : t('review.confirmApprove', { n: selection.length }), true))) continue;
    await grantApproval(config, proposal, selection, config.profile.humanActor);
    out.ok(t('review.approvedShort'));
    if (action === 'apply') await applyAndReport(ctx, config, proposal, selection.length < proposal.changes.length ? selection : undefined);
    else out.next([`okb apply ${proposal.id}${kbFlag(args)}`]);
    return 0;
  }
}

/** `okb apply` — kept for scripts and Claude; people usually approve and apply from `okb review`. */
export async function cmdApply(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const rollbackId = flagString(args, 'rollback');
  if (rollbackId) return undo(ctx, config, rollbackId);
  const ref = args.positionals[0];
  if (!ref) throw new OkbError('E_INVALID', 'usage: okb apply <proposal-id>', { key: 'usage', params: { usage: 'okb apply <proposal>' } });
  const proposal = await resolveProposalRef(config, ref);
  if (flagBool(args, 'dry-run') || ctx.mode === 'json') {
    const receipt = await applyProposal(config, proposal, {
      ...(flagList(args, 'only').length > 0 ? { only: flagList(args, 'only') } : {}),
      ...(flagBool(args, 'resume') ? { resume: true } : {}),
      ...(flagBool(args, 'dry-run') ? { dryRun: true } : {}),
    });
    const written = flagBool(args, 'dry-run') ? [] : receipt.results.filter((r) => r.action !== 'skipped').map((r) => r.path);
    const git = flagBool(args, 'dry-run') ? null : await commitKbChanges(config, written, `okb: apply ${proposal.id} (${written.length} file(s))\n\n${proposalTitle(proposal)}\nReceipt: ${receipt.id}`);
    if (ctx.mode === 'json') { out.json({ ok: true, receipt, ...(git ? { git } : {}) }); return 0; }
    out.ok(t('apply.dryRun', { n: receipt.results.length }));
    return 0;
  }
  const receipt = await applyAndReport(ctx, config, proposal, flagList(args, 'only').length ? flagList(args, 'only') : undefined);
  if (flagBool(args, 'verbose')) out.grid(receipt.results.map((r) => [r.action, r.path]));
  return 0;
}

async function undo(ctx: Ctx, config: OkbConfig, receiptId: string): Promise<number> {
  const results = await rollback(config, receiptId);
  const git = await commitKbChanges(config, results.map((r) => r.path), `okb: roll back ${receiptId}\n\n${results.length} file(s) restored.`);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, restored: results, git }); return 0; }
  ctx.out.ok(tn('undo.restored', results.length));
  reportGit(ctx, config, git);
  ctx.out.flush();
  return 0;
}

/** `okb undo` — take back the last apply of this KB, after saying what goes away. */
export async function cmdUndo(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  if (flagBool(args, 'list')) {
    const all = (await receipts(config)).filter((r) => r.sameKb);
    if (ctx.mode === 'json') { out.json({ ok: true, receipts: all }); return 0; }
    out.grid(all.map((r) => [r.rolledBack ? t('undo.undone') : r.complete ? t('undo.applied') : t('undo.interrupted'), formatDate(r.appliedAt), tn('review.files', r.files), r.id]), [t('undo.col.state'), t('undo.col.when'), t('undo.col.size'), t('undo.col.receipt')]);
    return 0;
  }
  const id = args.positionals[0] ?? (await lastUndoable(config))?.id;
  if (!id) { if (ctx.mode === 'json') out.json({ ok: true, restored: [] }); else out.info(t('undo.nothing')); return 0; }
  const target = (await receipts(config)).find((r) => r.id === id || r.id === `rcpt-${id}`);
  const receiptId = target?.id ?? id;
  if (canAsk(ctx)) {
    out.box([
      t('undo.what', { when: target ? formatDate(target.appliedAt) : '?' }),
      tn('undo.removes', target?.created ?? 0),
      tn('undo.restores', target?.updated ?? 0),
    ], t('undo.title'), 'warn');
    if (!(await confirm(t('undo.q'), false))) return 130;
  } else if (!flagBool(args, 'yes') && ctx.mode !== 'json') {
    throw new OkbError('E_INVALID', 'undo needs confirmation: okb undo --yes', { key: 'undoNeedsYes', params: { receipt: receiptId } });
  }
  return undo(ctx, config, receiptId);
}
