#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { applyProposal, loadReceipt, rollback } from '../apply/apply.js';
import { grantApproval } from '../apply/approval.js';
import { guardApply, assertGuard, checkPathPolicy } from '../apply/guard.js';
import { loadConfig, okbHome, type EffectiveConfig } from '../config/load.js';
import { configSchema } from '../config/schema.js';
import { anonymizeHome, redact } from '../config/redact.js';
import { doctor, measureContext } from '../doctor/doctor.js';
import { loadBundleFor } from '../kb/bundle.js';
import { applyFileEdits, checkLinks, planMove } from '../links/check.js';
import { maintain } from '../maintain/maintain.js';
import { applyMigration, planMigration, rollbackMigration } from '../migrate/migrate.js';
import { buildNavigation } from '../nav/nav.js';
import { route } from '../routing/table.js';
import { ask } from '../pipeline/ask.js';
import { checkpointIsUsable, loadCheckpoint, saveCheckpoint, loadNormalized, saveNormalized } from '../pipeline/checkpoint.js';
import { proposeFiles } from '../proposal/files.js';
import { analysisTemplate } from '../pipeline/analysis.js';
import { detectCorrections } from '../pipeline/corrections.js';
import { prepareProposal } from '../pipeline/ingest.js';
import { unifiedDiff } from '../proposal/diff.js';
import { groupChangesByPath, materializeFile } from '../proposal/materialize.js';
import { resolveSelection } from '../proposal/model.js';
import { listProposals, loadProposal, saveProposal } from '../proposal/store.js';
import { retainAcquired } from '../sources/retention.js';
import { acquire, extractSource, supportMatrix } from '../sources/registry.js';
import { parseConceptAssist, runSetup, switchProfile, CONCEPT_ASSIST_HELP } from '../setup/setup.js';
import { ensureState, statePaths } from '../state/paths.js';
import { estimateTokens, paginate } from '../util/context-meter.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic, writeJsonAtomic } from '../util/fsx.js';
import { shortId } from '../util/hash.js';
import { asBundlePath, bundlePathToAbsolute } from '../util/paths.js';
import { flagBool, flagList, flagNumber, flagString, parseArgs, type ParsedArgs } from './args.js';
import { Output, reportError, type OutputMode } from './output.js';

const HELP = `okb — Open Knowledge Brain

  okb setup      --profile <id> --kb-root <path> --concept-assist off|targeted|pedagogical
  okb config     show [--defaults] [--json]
  okb ingest     <source> --analysis-file <dossier.json> --append <path> --heading <text> | --create <path> --title <text>
  okb ask        "<question>" [--limit N] [--cursor C]
  okb review     [<proposal-id>] [--list] [--diff] [--approve --only a,b]
  okb apply      <proposal-id> [--only a,b] [--resume] [--dry-run] [--rollback <receipt>]
  okb maintain   [--fix-links] [--json]
  okb doctor     [--json]
  okb concepts   detect <source> | list
  okb links      check [--renderer r] | move <from> <to> (prepare move proposal)
  okb nav        [--json]  (prepare navigation proposal)
  okb migrate    portable-links [--write] | --rollback <id>
  okb route      "<request>"
  okb context    [--json]

Every command accepts --json for machine-readable output and --profile <id>.`;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const mode: OutputMode = flagBool(args, 'json') ? 'json' : 'text';
  const out = new Output(mode);

  try {
    switch (args.command) {
      case 'setup':
        return await cmdSetup(args, out, mode);
      case 'config':
        return await cmdConfig(args, out, mode);
      case 'ingest':
        return await cmdIngest(args, out, mode);
      case 'ask':
        return await cmdAsk(args, out, mode);
      case 'review':
        return await cmdReview(args, out, mode);
      case 'apply':
        return await cmdApply(args, out, mode);
      case 'maintain':
        return await cmdMaintain(args, out, mode);
      case 'doctor':
        return await cmdDoctor(args, out, mode);
      case 'concepts':
        return await cmdConcepts(args, out, mode);
      case 'links':
        return await cmdLinks(args, out, mode);
      case 'nav':
        return await cmdNav(args, out, mode);
      case 'migrate':
        return await cmdMigrate(args, out, mode);
      case 'route':
        return cmdRoute(args, out, mode);
      case 'context':
        return await cmdContext(args, out, mode);
      case 'help':
      case '--help':
      case '-h':
        out.line(HELP);
        return 0;
      case 'version':
      case '--version':
        out.line(await packageVersion());
        return 0;
      default:
        throw new OkbError('E_INVALID', `unknown command "${args.command}"`, { hint: HELP });
    }
  } catch (error) {
    return reportError(error, mode);
  }
}

async function effective(args: ParsedArgs): Promise<EffectiveConfig> {
  const profileId = flagString(args, 'profile');
  const result = await loadConfig({
    ...(profileId ? { profileId } : {}),
    ...(flagString(args, 'org-config') ? { orgConfigPath: flagString(args, 'org-config')! } : {}),
    flags: buildFlagOverrides(args),
  });
  await ensureState(statePaths(result.config));
  return result;
}

function buildFlagOverrides(args: ParsedArgs): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const kbRoot = flagString(args, 'kb-root');
  if (kbRoot) overrides.kb = { root: kbRoot };
  const assist = flagString(args, 'concept-assist');
  if (assist) overrides.conceptAssist = { level: parseConceptAssist(assist) };
  return overrides;
}

async function cmdSetup(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  if (args.positionals[0] === 'switch') {
    const target = args.positionals[1];
    if (!target) throw new OkbError('E_INVALID', 'usage: okb setup switch <profile-id>');
    const path = await switchProfile(target);
    out.line(`active profile is now "${target}" (${path})`);
    return 0;
  }

  const fromFile = flagString(args, 'from');
  const fromAnswers = fromFile
    ? ((YAML.parse(await readFile(resolve(fromFile), 'utf8')) as Record<string, unknown>) ?? {})
    : {};

  const profileId = flagString(args, 'profile') ?? (fromAnswers.profileId as string | undefined);
  const kbRoot = flagString(args, 'kb-root') ?? (fromAnswers.kbRoot as string | undefined);
  const assistRaw =
    flagString(args, 'concept-assist') ?? (fromAnswers.conceptAssist as string | undefined);

  if (!profileId) throw new OkbError('E_CONFIG', 'missing --profile <id>');
  if (!kbRoot) throw new OkbError('E_CONFIG', 'missing --kb-root <path>');
  if (!assistRaw) {
    throw new OkbError('E_CONFIG', 'concept assist level must be chosen explicitly', {
      hint: CONCEPT_ASSIST_HELP,
    });
  }

  const result = await runSetup({
    ...(fromAnswers as Record<string, never>),
    profileId,
    kbRoot: resolve(kbRoot),
    conceptAssist: parseConceptAssist(assistRaw),
    ...(flagString(args, 'display-name') ? { displayName: flagString(args, 'display-name')! } : {}),
    ...(flagString(args, 'human-actor') ? { humanActor: flagString(args, 'human-actor')! } : {}),
    ...(flagString(args, 'locale') ? { locale: flagString(args, 'locale')! } : {}),
    ...(flagString(args, 'role') ? { role: flagString(args, 'role')! } : {}),
    ...(flagList(args, 'project').length > 0 ? { projects: flagList(args, 'project') } : {}),
    ...(flagString(args, 'concepts-folder') ? { conceptsFolder: flagString(args, 'concepts-folder')! } : {}),
    ...(flagList(args, 'exclude').length > 0 ? { exclude: flagList(args, 'exclude') } : {}),
    ...(flagString(args, 'answer-language') ? { answerLanguage: flagString(args, 'answer-language')! } : {}),
    ...(flagString(args, 'org-config') ? { orgConfig: resolve(flagString(args, 'org-config')!) } : {}),

  });

  if (mode === 'json') {
    out.json({ ok: true, ...result });
    return 0;
  }
  out.line(`${result.created ? 'created' : 'updated'} profile at ${result.profilePath}`);
  out.line(`active profile list at ${result.rootConfigPath}`);
  if (result.preserved.length > 0) {
    out.line(`preserved custom keys: ${result.preserved.join(', ')}`);
  }
  out.line('next: okb doctor');
  return 0;
}

async function cmdConfig(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  if (flagBool(args, 'defaults')) {
    // Every key with its default, so a profile can be written against something
    // explicit rather than against the documentation.
    const defaults = configSchema.parse({
      profile: { id: 'example' },
      kb: { root: '/path/to/knowledge-bundle' },
    });
    if (mode === 'json') {
      out.json({ ok: true, defaults });
      return 0;
    }
    out.line('# every configuration key with its default value');
    out.line(YAML.stringify(defaults, { lineWidth: 0 }).trimEnd());
    return 0;
  }

  const { config, layers, clamped, disabled, ignoredKeys } = await effective(args);
  const safe = redact(config);

  if (mode === 'json') {
    out.json({
      ok: true,
      config: safe,
      layers: layers.map((l) => ({ name: l.name, origin: l.origin })),
      clamped,
      disabled,
      ignoredKeys,
    });
    return 0;
  }

  const home = okbHome();
  out.line('# effective configuration (secrets redacted)');
  out.line(anonymizeHome(YAML.stringify(safe, { lineWidth: 0 }).trimEnd(), home));
  out.line();
  out.line('# layers, lowest precedence first');
  out.table(layers.map((l) => [l.name, anonymizeHome(l.origin, home)]));
  if (clamped.length > 0) {
    out.line();
    out.line('# narrowed by organisation policy');
    out.table(clamped.map((c) => [c.path, `${JSON.stringify(c.requested)} -> ${JSON.stringify(c.effective)}`, c.reason]));
  }
  if (disabled.length > 0) {
    out.line();
    out.line(`# disabled capabilities: ${disabled.join(', ')}`);
  }
  if (ignoredKeys.length > 0) {
    out.line();
    out.line(`# kept in the file but not applied by okb: ${ignoredKeys.join(', ')}`);
  }
  return 0;
}

async function cmdIngest(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const sourceArg = args.positionals[0];
  if (!sourceArg) throw new OkbError('E_INVALID', 'usage: okb ingest <file-or-url> --append <path> --heading <text>');

  const runFlag = flagString(args, 'run');
  const cached = runFlag ? await loadNormalized(config, runFlag) : null;
  const kindFlag = flagString(args, 'kind');
  const acquired = cached ? null : await acquire(sourceArg, config);
  const doc = cached ?? await extractSource(acquired!, config, kindFlag ? { kind: kindFlag as never } : {});
  if (acquired) await retainAcquired(config, acquired, doc);
  const runId = runFlag ?? shortId(`${doc.source.id}:${doc.source.sha256}`);
  await saveNormalized(config, runId, doc);
  if (flagBool(args, 'template')) {
    const path = resolve(statePaths(config).runs, runId, 'analysis-template.json');
    await writeJsonAtomic(path, analysisTemplate(doc));
    if (mode === 'json') out.json({ ok: true, runId, path, source: doc.source, totalBlocks: doc.blocks.length });
    else out.line(path);
    return 0;
  }

  if (args.positionals[1] === 'extract' || flagBool(args, 'extract-only')) {
    return emitExtract(args, out, mode, config, doc);
  }

  const appendPath = flagString(args, 'append');
  const createPath = flagString(args, 'create');
  if (appendPath && createPath) throw new OkbError('E_INVALID', 'choose only one target mode');
  if (!appendPath && !createPath) {
    throw new OkbError('E_INVALID', 'choose a destination: --append <path> or --create <path>', {
      hint: 'Run with --extract-only to inspect the source before deciding.',
    });
  }

  const sectionFile = flagString(args, 'section-file');
  const analysisFile = flagString(args, 'analysis-file');
  if (sectionFile && analysisFile) throw new OkbError('E_INVALID', 'choose --analysis-file only for sourced prose');
  if (sectionFile) throw new OkbError('E_INVALID', '--section-file was replaced by --analysis-file: claims need located evidence');
  const report = await prepareProposal(config, doc, {
    target: appendPath
      ? {
          mode: 'append',
          path: asBundlePath(appendPath),
          heading: flagString(args, 'heading') ?? doc.source.title ?? 'Notes importées',
        }
      : {
          mode: 'create',
          path: asBundlePath(createPath!),
          title: flagString(args, 'title') ?? doc.source.title ?? 'Notes importées',
        },
    ...(analysisFile ? { analysis: JSON.parse(await readFile(resolve(analysisFile), 'utf8')) } : {}),
    ...(flagString(args, 'concept-assist')
      ? { conceptAssistLevel: parseConceptAssist(flagString(args, 'concept-assist')!) }
      : {}),
    ...(flagString(args, 'domain') ? { domain: flagString(args, 'domain')! } : {}),
    ...(flagBool(args, 'reprocess') ? { reprocess: true } : {}),
    ...(flagList(args, 'link-into').length > 0
      ? { linkInto: flagList(args, 'link-into').map(asBundlePath) }
      : {}),
  });

  await saveProposal(config, report.proposal);

  if (mode === 'json') {
    out.json({
      ok: true,
      proposalId: report.proposal.id,
      contentHash: report.proposal.contentHash,
      conceptAssistLevel: report.conceptAssistLevel,
      source: doc.source,
      changes: report.proposal.changes.map((c) => ({
        id: c.id,
        kind: c.kind,
        path: c.path,
        category: c.category,
        label: c.label,
        dependsOn: c.dependsOn,
      })),
      candidates: report.candidates,
      corrections: report.corrections,
      contradictions: report.proposal.contradictions,
      notes: report.proposal.notes,
      skipped: report.skipped,
    });
    return 0;
  }

  out.line(`proposal ${report.proposal.id} prepared (nothing written yet)`);
  out.line(`source: ${doc.source.uri} [${doc.source.kind}, support=${doc.source.support}]`);
  for (const l of doc.source.limitations) out.line(`  limit: ${l}`);
  out.line();
  out.line('changes:');
  out.table(
    report.proposal.changes.map((c) => [
      c.id,
      c.category,
      c.kind,
      c.path,
      c.dependsOn.length > 0 ? `needs ${c.dependsOn.join(',')}` : '',
    ]),
  );
  if (report.corrections.length > 0) {
    out.line();
    out.line(`corrections / exceptions found in the source: ${report.corrections.length}`);
  }
  if (report.proposal.contradictions.length > 0) {
    out.line();
    out.line('contradictions:');
    for (const c of report.proposal.contradictions) out.line(`  ${c.path}: ${c.note}`);
  }
  for (const s of report.skipped) out.line(`skipped (${s.reason}): ${s.detail}`);
  out.line();
  out.line(`next: okb review ${report.proposal.id} --diff`);
  return 0;
}

async function emitExtract(
  args: ParsedArgs,
  out: Output,
  mode: OutputMode,
  config: Awaited<ReturnType<typeof effective>>['config'],
  doc: Awaited<ReturnType<typeof extractSource>>,
): Promise<number> {
  const runId = flagString(args, 'run') ?? shortId(`${doc.source.id}:${doc.source.sha256}`);
  const existing = await loadCheckpoint(config, runId);
  let cursor = flagNumber(args, 'cursor') ?? 0;

  if (existing && flagBool(args, 'resume')) {
    const usable = checkpointIsUsable(existing, {
      sha256: doc.source.sha256,
      adapter: doc.source.adapter,
      adapterVersion: doc.source.adapterVersion,
    });
    if (!usable.usable) {
      throw new OkbError('E_CONFLICT', `cannot resume run ${runId}: ${usable.reason}`, {
        hint: 'Start a fresh run; block indices from the old run no longer line up.',
      });
    }
    cursor = existing.cursor;
  }

  const limit = flagNumber(args, 'limit') ?? config.sources.limits.chunkBlocks;
  const slice = paginate(doc.blocks, { limit, cursor: String(cursor) });
  const page = [...slice.page];
  const budget = config.context.budgets.ingestOutputTokens;
  const envelopeFor = (blocks: typeof page) => {
    const end = cursor + blocks.length;
    return { ok: true, runId, source: doc.source, blocks,
      truncation: { truncated: end < doc.blocks.length, shown: blocks.length, total: doc.blocks.length, nextCursor: end < doc.blocks.length ? String(end) : null },
      corrections: detectCorrections({ ...doc, blocks }), checkpointMeaning: 'delivered blocks, not proof of semantic reading' };
  };
  while (page.length && estimateTokens(JSON.stringify(envelopeFor(page), null, 2) + '\n') > budget) page.pop();
  if (!page.length && cursor < doc.blocks.length) throw new OkbError('E_CONFIG', 'ingestOutputTokens is too small for one block and its metadata');
  const envelope = envelopeFor(page);
  const { truncation } = envelope;

  await saveCheckpoint(config, {
    runId,
    sourceUri: doc.source.uri,
    sourceSha256: doc.source.sha256,
    adapter: doc.source.adapter,
    adapterVersion: doc.source.adapterVersion,
    totalBlocks: doc.blocks.length,
    cursor: cursor + page.length,
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    carry: existing?.carry ?? {},
  });

  if (mode === 'json') {
    out.json(envelope);
    return 0;
  }
  out.line(`run ${runId} — ${doc.source.kind}, support=${doc.source.support}`);
  for (const block of page) out.line(`[${block.id}] (${block.kind}) ${block.text}`);
  out.truncation(truncation, `okb ingest ${doc.source.uri} --extract-only --run ${runId}`);
  return 0;
}

async function cmdAsk(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const query = args.positionals.join(' ').trim();
  if (!query) throw new OkbError('E_INVALID', 'usage: okb ask "<question>"');

  const result = await ask(config, query, {
    ...(flagNumber(args, 'limit') !== undefined ? { limit: flagNumber(args, 'limit')! } : {}),
    ...(flagString(args, 'cursor') ? { cursor: flagString(args, 'cursor')! } : {}),
  });

  if (mode === 'json') {
    out.json({ ok: true, ...result });
    return 0;
  }
  if (result.hits.length === 0) out.line('no match in the bundle');
  out.table(result.hits.map((h) => [`${h.score}`, h.path, `${h.status}/${h.trust}`, h.title]));
  if (result.evidence.length > 0) {
    out.line();
    out.line('evidence:');
    for (const e of result.evidence) out.line(`  ${e.path}:${e.line} — ${e.quote}`);
  }
  if (result.prerequisites.length > 0) {
    out.line();
    out.line(`prerequisites: ${result.prerequisites.map((p) => p.path).join(', ')}`);
  }
  for (const note of result.notes) out.line(`note: ${note}`);
  out.truncation(result.truncation, `okb ask "${query}"`);
  return 0;
}

async function cmdReview(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);

  if (flagBool(args, 'list') || args.positionals.length === 0) {
    const proposals = await listProposals(config);
    if (mode === 'json') {
      out.json({ ok: true, proposals: proposals.map((p) => ({ id: p.id, createdAt: p.createdAt, status: p.status, changes: p.changes.length })) });
      return 0;
    }
    out.table([['ID', 'CREATED', 'STATUS', 'CHANGES'], ...proposals.map((p) => [p.id, p.createdAt, p.status, String(p.changes.length)])]);
    return 0;
  }

  const proposal = await loadProposal(config, args.positionals[0]!);

  const only = flagList(args, 'only');
  const requested = only.length > 0 ? only : proposal.changes.map(c => c.id);
  const { accepted, dropped } = resolveSelection(proposal, requested);
  const selected = proposal.changes.filter(c => accepted.includes(c.id));
  assertGuard(await guardApply(config, proposal, selected));
  if (flagBool(args, 'approve')) {
    const approval = await grantApproval(config, proposal, accepted, config.profile.humanActor);
    if (mode === 'json') {
      out.json({ ok: true, approved: accepted, dropped, contentHash: proposal.contentHash, approvedAt: approval.approvedAt });
      return 0;
    }
    out.line(`approved ${accepted.length} change(s) of proposal ${proposal.id}`);
    for (const d of dropped) out.line(`  dropped ${d.id}: ${d.reason}`);
    out.line(`next: okb apply ${proposal.id}${only.length > 0 ? ` --only ${accepted.join(',')}` : ''}`);
    return 0;
  }

  const byPath = groupChangesByPath(selected);
  const diffs: { path: string; diff: string; stats: { added: number; removed: number } }[] = [];
  for (const [path, changes] of byPath) {
    const before = await readTextIfExists(bundlePathToAbsolute(config.kb.root, path));
    const after = materializeFile(path, before, changes);
    const { text, stats } = unifiedDiff(before ?? '', after, { path });
    diffs.push({ path, diff: text, stats });
  }

  if (mode === 'json') {
    out.json({
      ok: true,
      proposal: { id: proposal.id, status: proposal.status, contentHash: proposal.contentHash, notes: proposal.notes },
      changes: proposal.changes.map((c) => ({ id: c.id, category: c.category, kind: c.kind, path: c.path, label: c.label, rationale: c.rationale, dependsOn: c.dependsOn })),
      contradictions: proposal.contradictions,
      analysisSummary: proposal.analysis ? { reviewedBlocks: proposal.analysis.reviewedBlockIds.length, claims: proposal.analysis.sections.flatMap(s => s.claims).length, corrections: proposal.analysis.corrections, caveat: 'coverage is an author declaration; quote identity is checked; entailment needs review' } : null,
      claims: proposal.analysis ? paginate(proposal.analysis.sections.flatMap(s => s.claims), { limit: flagNumber(args, 'limit') ?? config.context.pageSize, cursor: flagString(args, 'cursor') }) : null,
      evidence: paginate(proposal.evidence, { limit: flagNumber(args, 'limit') ?? config.context.pageSize, cursor: flagString(args, 'cursor') }).page,
      evidencePagination: paginate(proposal.evidence, { limit: flagNumber(args, 'limit') ?? config.context.pageSize, cursor: flagString(args, 'cursor') }).truncation,
      diffs: flagBool(args, 'diff') ? paginate(diffs, { limit: flagNumber(args, 'limit') ?? config.context.pageSize, cursor: flagString(args, 'cursor') }).page : diffs.map(({path,stats}) => ({path,stats})),
      diffPagination: paginate(diffs, { limit: flagNumber(args, 'limit') ?? config.context.pageSize, cursor: flagString(args, 'cursor') }).truncation,
    });
    return 0;
  }

  out.line(`proposal ${proposal.id} — ${proposal.status} — hash ${proposal.contentHash.slice(0, 12)}`);
  out.line(`sources: ${proposal.sourceUris.join(', ')}`);
  out.line();
  out.table([['ID', 'CATEGORY', 'PATH', 'LABEL'], ...proposal.changes.map((c) => [c.id, c.category, c.path, c.label])]);
  for (const note of proposal.notes) out.line(`note: ${note}`);
  for (const c of proposal.contradictions) {
    out.line(`contradiction @ ${c.path}: existing "${c.existingClaim}" vs incoming "${c.incomingClaim}"`);
  }
  if (flagBool(args, 'diff')) {
    out.line();
    for (const d of diffs) {
      out.line(`# ${d.path}  +${d.stats.added}/-${d.stats.removed}`);
      out.line(d.diff);
      out.line();
    }
  }
  out.line(`approve with: okb review ${proposal.id} --approve [--only ${proposal.changes.map((c) => c.id).slice(0, 2).join(',')}]`);
  return 0;
}

async function cmdApply(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);

  const rollbackId = flagString(args, 'rollback');
  if (rollbackId) {
    const results = await rollback(config, rollbackId);
    if (mode === 'json') {
      out.json({ ok: true, restored: results });
      return 0;
    }
    out.line(`restored ${results.length} file(s) from receipt ${rollbackId}`);
    return 0;
  }

  const id = args.positionals[0];
  if (!id) throw new OkbError('E_INVALID', 'usage: okb apply <proposal-id>');
  const proposal = await loadProposal(config, id);

  const receipt = await applyProposal(config, proposal, {
    ...(flagList(args, 'only').length > 0 ? { only: flagList(args, 'only') } : {}),
    ...(flagBool(args, 'resume') ? { resume: true } : {}),
    ...(flagBool(args, 'dry-run') ? { dryRun: true } : {}),
  });

  if (mode === 'json') {
    out.json({ ok: true, receipt });
    return 0;
  }
  out.line(`receipt ${receipt.id} — ${receipt.results.length} file(s)`);
  out.table(receipt.results.map((r) => [r.action, r.path, r.sha256.slice(0, 12)]));
  for (const d of receipt.dropped) out.line(`dropped ${d.id}: ${d.reason}`);
  if (!flagBool(args, 'dry-run')) out.line(`rollback with: okb apply --rollback ${receipt.id}`);
  return 0;
}

async function cmdMaintain(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const report = await maintain(config);

  if (mode === 'json') {
    out.json({ ok: report.okfConformant, ...report });
    return report.okfConformant ? 0 : 1;
  }

  out.line(`scanned ${report.scanned} document(s) in ${config.kb.root}`);
  out.line(`OKF v0.2 conformance: ${report.okfConformant ? 'ok' : 'FAILED'}`);
  out.line();
  const rows = [
    ...report.okfFindings.map((f) => [f.layer, f.level, f.path, `${f.code} ${f.message}`]),
    ...report.linkIssues.map((i) => ['links', i.level, `${i.file}:${i.line}`, `${i.code} ${i.message}`]),
    ...report.issues.map((i) => ['kb', i.level, i.path, `${i.code} ${i.message}`]),
  ];
  const { page, truncation } = paginate(rows, { limit: config.context.pageSize, cursor: flagString(args, 'cursor') ?? null });
  out.table(page);
  out.truncation(truncation, 'okb maintain');
  return report.okfConformant ? 0 : 1;
}

async function cmdDoctor(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  let report;
  try {
    const { config } = await effective(args);
    report = await doctor(config);
  } catch (error) {
    report = await doctor(null, error as Error);
  }

  if (mode === 'json') {
    out.json({ ...report, ok: report.ok });
    return report.ok ? 0 : 1;
  }
  out.table([['CHECK', 'STATUS', 'DETAIL'], ...report.checks.map((c) => [c.name, c.status, c.detail])]);
  for (const c of report.checks) if (c.hint) out.line(`  ${c.name}: ${c.hint}`);
  if (report.support.length > 0) {
    out.line();
    out.line('declared source support:');
    out.table(report.support.map((s) => [s.kind, s.enabled ? 'enabled' : 'disabled', s.notes]));
  }
  out.line();
  out.line(`always-on context: ${report.context.alwaysOn.bytes} bytes measured, ~${report.context.alwaysOn.tokensEstimated} tokens estimated`);
  return report.ok ? 0 : 1;
}

async function cmdConcepts(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const sub = args.positionals[0] ?? 'list';

  if (sub === 'list') {
    const bundle = await loadBundleFor(config);
    const prefix = `${config.kb.layout.concepts}/`;
    const cards = bundle.entries.filter((e) => !e.reserved && e.path.startsWith(prefix));
    if (mode === 'json') {
      out.json({ ok: true, folder: config.kb.layout.concepts, cards: cards.map((c) => ({ path: c.path, title: c.title, aliases: c.ext.aliases ?? [], status: c.status, needsClarification: c.ext.needs_clarification ?? false })) });
      return 0;
    }
    out.table([['PATH', 'TITLE', 'STATUS', 'ALIASES'], ...cards.map((c) => [c.path, c.title, c.status, (c.ext.aliases ?? []).join('|')])]);
    return 0;
  }

  if (sub === 'detect') {
    const source = args.positionals[1];
    if (!source) throw new OkbError('E_INVALID', 'usage: okb concepts detect <source>');
    const acquired = await acquire(source, config);
    const doc = await extractSource(acquired, config);
    const bundle = await loadBundleFor(config);
    const { detectConcepts } = await import('../concepts/detect.js');
    const detection = detectConcepts(doc, bundle, config, {
      ...(flagString(args, 'concept-assist') ? { level: parseConceptAssist(flagString(args, 'concept-assist')!) } : {}),
      ...(flagString(args, 'domain') ? { domain: flagString(args, 'domain')! } : {}),
    });
    if (mode === 'json') {
      out.json({ ok: true, level: detection.level, candidates: detection.candidates });
      return 0;
    }
    out.line(`concept assist level: ${detection.level}`);
    out.table([['TERM', 'KIND', 'N', 'RESOLUTION', 'WHY'], ...detection.candidates.map((c) => [c.surface, c.kind, String(c.occurrences), c.resolution.status, c.rationale])]);
    return 0;
  }

  throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { hint: 'okb concepts list|detect' });
}

async function cmdLinks(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const sub = args.positionals[0] ?? 'check';
  const bundle = await loadBundleFor(config);

  if (sub === 'check') {
    const renderers = flagList(args, 'renderer');
    const report = checkLinks(bundle.snapshot, {
      renderers: (renderers.length > 0 ? renderers : config.kb.renderers) as never,
      brokenTargetsAre: config.kb.brokenTargetsAre,
      ...(flagBool(args, 'allow-bundle-absolute') ? { allowBundleAbsolute: true } : {}),
    });
    if (mode === 'json') {
      out.json({ ok: !report.issues.some((i) => i.level === 'error'), ...report });
      return report.issues.some((i) => i.level === 'error') ? 1 : 0;
    }
    out.line(`${report.scannedLinks} link(s) in ${report.scannedFiles} file(s); kinds: ${JSON.stringify(report.byKind)}`);
    const { page, truncation } = paginate(report.issues, { limit: config.context.pageSize, cursor: flagString(args, 'cursor') ?? null });
    out.table(page.map((i) => [i.level, `${i.file}:${i.line}`, i.code, i.message]));
    out.truncation(truncation, 'okb links check');
    return report.issues.some((i) => i.level === 'error') ? 1 : 0;
  }

  if (sub === 'move') {
    const [, from, to] = args.positionals;
    if (!from || !to) throw new OkbError('E_INVALID', 'usage: okb links move <from> <to> [--write]');
    const plan = planMove(bundle.snapshot, from, to);
    const edits = [...plan.inbound, ...plan.outbound];

    if (!bundle.snapshot.files.has(plan.from)) throw new OkbError('E_NOT_FOUND', 'move source does not exist');
    if (bundle.snapshot.files.has(plan.to)) throw new OkbError('E_CONFLICT', 'move destination already exists');
    const updated = applyFileEdits(bundle.snapshot, edits);
    const desired = new Map<string, string | null>(updated);
    desired.set(plan.to, updated.get(plan.from) ?? bundle.snapshot.files.get(plan.from)!);
    desired.set(plan.from, null);
    const proposal = proposeFiles(config, bundle, desired, `move ${plan.from} to ${plan.to}`, true);
    await saveProposal(config, proposal);

    if (mode === 'json') {
      out.json({ ok: true, from: plan.from, to: plan.to, inbound: plan.inbound, outbound: plan.outbound, written: false, proposalId: proposal.id });
      return 0;
    }
    out.line(`${plan.inbound.length} inbound and ${plan.outbound.length} outbound link(s) to rewrite`);
    out.table([...plan.inbound, ...plan.outbound].map((e) => [e.file, e.replacement, e.reason]));
    out.line(`prepared ${proposal.id}; review and approve before okb apply. --write no longer bypasses review.`);
    return 0;
  }

  throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { hint: 'okb links check|move' });
}

async function cmdNav(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const files = await buildNavigation(config);
  const write = flagBool(args, 'write');

  const bundle = await loadBundleFor(config);
  const proposal = proposeFiles(config, bundle, new Map(files.filter(f => f.status !== 'current').map(f => [f.path, f.content])), 'navigation refresh');
  await saveProposal(config, proposal);

  if (mode === 'json') {
    out.json({ ok: true, written: false, proposalId: proposal.id, files: files.map((f) => ({ path: f.path, status: f.status })) });
    return 0;
  }
  out.table([['STATUS', 'PATH'], ...files.map((f) => [f.status, f.path])]);
  out.line(`prepared ${proposal.id}; review, approve, then apply to update navigation`);
  return 0;
}

async function cmdMigrate(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);

  const rollbackId = flagString(args, 'rollback');
  if (rollbackId) {
    const restored = await rollbackMigration(config, rollbackId);
    if (mode === 'json') {
      out.json({ ok: true, restored });
      return 0;
    }
    out.line(`restored ${restored.length} file(s) from ${rollbackId}`);
    return 0;
  }

  const kind = (args.positionals[0] ?? 'portable-links') as 'portable-links';
  const plan = await planMigration(config, kind);

  await saveProposal(config, plan.proposal);
  if (mode === 'json') out.json({ ok: true, dryRun: true, proposalId: plan.proposal.id, edits: plan.edits, manual: plan.manual, filesTouched: plan.filesTouched });
  else {
    out.line(`${plan.edits.length} rewrite(s) prepared as ${plan.proposal.id}; nothing written to the KB`);
    out.line(`next: okb review ${plan.proposal.id} --diff`);
    out.table(plan.manual.map(m => [`${m.file}:${m.line}`, m.url, m.why]));
  }
  return 0;
}

function cmdRoute(args: ParsedArgs, out: Output, mode: OutputMode): number {
  const request = args.positionals.join(' ').trim();
  if (!request) throw new OkbError('E_INVALID', 'usage: okb route "<request>"');
  const decision = route(request);

  if (mode === 'json') {
    out.json({ ok: true, request, ...decision });
    return 0;
  }
  out.line(`${decision.skill} (score ${decision.score})`);
  if (decision.skill === 'none') {
    out.line('ambiguous or out of scope — ask the user which workflow they mean');
  }
  if (decision.suppressed.length > 0) {
    out.line(`suppressed by a negative rule: ${decision.suppressed.join(', ')}`);
  }
  return 0;
}

async function cmdContext(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const footprint = await measureContext();
  let budgets: unknown = null;
  try {
    const { config } = await effective(args);
    budgets = config.context.budgets;
  } catch {
    budgets = null;
  }

  if (mode === 'json') {
    out.json({ ok: true, footprint, budgets });
    return 0;
  }
  out.line('# context footprint');
  out.line(`always-on: ${footprint.alwaysOn.bytes} bytes (measured), ~${footprint.alwaysOn.tokensEstimated} tokens (estimated)`);
  out.line();
  out.line('per workflow (loaded on selection):');
  out.table(footprint.perWorkflow.map((m) => [m.label, `${m.bytes} B`, `~${m.tokensEstimated} tok`]));
  out.line();
  out.line('per agent (loaded inside the subagent only):');
  out.table(footprint.perAgent.map((m) => [m.label, `${m.bytes} B`, `~${m.tokensEstimated} tok`]));
  out.line();
  for (const note of footprint.notes) out.line(`- ${note}`);
  return 0;
}

async function packageVersion(): Promise<string> {
  const { fileURLToPath } = await import('node:url');
  const here = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const raw = await readTextIfExists(resolve(here, 'package.json'));
  if (!raw) return 'unknown';
  return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
}

export { main };

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('cli/index.js') || process.argv[1].endsWith('cli/index.ts') || process.argv[1].endsWith('/okb'));

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.exitCode = reportError(error, 'text');
    },
  );
}
