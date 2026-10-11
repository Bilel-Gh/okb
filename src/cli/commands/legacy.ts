/**
 * Commands for scripts, Claude and advanced use: setup by flags, raw
 * configuration, writing brief, ingestion, combination, templates, concepts,
 * links, navigation, migration, routing. People reach the same things through
 * `okb init`, `okb settings` and the plugin.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { guardApply, assertGuard } from '../../apply/guard.js';
import { okbHome, type EffectiveConfig } from '../../config/load.js';
import { configSchema, WRITING_PRESETS } from '../../config/schema.js';
import { anonymizeHome, redact } from '../../config/redact.js';
import { loadBundleFor, withPendingFiles } from '../../kb/bundle.js';
import { applyFileEdits, checkLinks, planMove } from '../../links/check.js';
import { planMigration, rollbackMigration } from '../../migrate/migrate.js';
import { buildNavigation } from '../../nav/nav.js';
import { route } from '../../routing/table.js';
import { checkpointIsUsable, loadCheckpoint, saveCheckpoint, loadNormalized, saveNormalized } from '../../pipeline/checkpoint.js';
import { proposeFiles } from '../../proposal/files.js';
import { analysisTemplate } from '../../pipeline/analysis.js';
import { detectCorrections } from '../../pipeline/corrections.js';
import { prepareProposal } from '../../pipeline/ingest.js';
import { materializeFile } from '../../proposal/materialize.js';
import { listProposals, loadProposal, saveProposal, updateProposalStatus } from '../../proposal/store.js';
import { combineProposals } from '../../proposal/combine.js';
import { retainAcquired } from '../../sources/retention.js';
import { acquire, extractSource } from '../../sources/registry.js';
import { parseConceptAssist, runSetup, switchProfile, CONCEPT_ASSIST_HELP } from '../../setup/setup.js';
import { renderBrief } from '../../style/brief.js';
import { PRESETS } from '../../style/presets.js';
import { resolveStyle } from '../../style/resolve.js';
import { lengthOf, styleOf, typeDefaults } from '../../style/simple.js';
import { proposeRevision } from '../../revise/revise.js';
import { getTemplate, loadTemplates, pick, renderSkeleton, renderTemplateGuide } from '../../templates/registry.js';
import { statePaths } from '../../state/paths.js';
import { estimateTokens, paginate } from '../../util/context-meter.js';
import { reviewOf } from '../../repo/notes.js';
import { OkbError } from '../../util/errors.js';
import { ensureDir, readTextIfExists, writeJsonAtomic } from '../../util/fsx.js';
import { shortId } from '../../util/hash.js';
import { asBundlePath, type BundlePath } from '../../util/paths.js';
import { flagBool, flagList, flagNumber, flagString, flagValues, type ParsedArgs } from '../args.js';
import type { Output, OutputMode } from '../output.js';
import { effective } from './common.js';
import { t as say } from '../../i18n/index.js';

export async function cmdSetup(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
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
    ...(flagString(args, 'writing-preset') ? { writingPreset: flagString(args, 'writing-preset')! } : {}),
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

export async function cmdConfig(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
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

/**
 * The writing brief for one piece of work. Read-only: one-off adjustments are
 * reported back for the dossier and never written to the profile.
 */
function styleRequest(args: ParsedArgs) {
  // « --style simplifié --length courte » are the simple words for a preset and the detail knob.
  const style = flagString(args, 'style');
  const length = flagString(args, 'length');
  const preset = flagString(args, 'preset') ?? (style ? styleOf(style) : undefined);
  return {
    ...(preset ? { preset } : {}),
    set: [...flagList(args, 'set'), ...(length ? [`detail=${lengthOf(length)}`] : [])],
    ...(flagString(args, 'type') ? { type: flagString(args, 'type')! } : {}),
    notes: flagValues(args, 'note'),
    ...(flagString(args, 'domain') ? { domain: flagString(args, 'domain')! } : {}),
    ...(flagString(args, 'reader') ? { reader: flagString(args, 'reader')! } : {}),
  };
}

export async function cmdStyle(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  if (args.positionals[0] === 'presets') {
    const presets = WRITING_PRESETS.map((id) => ({ id, summary: PRESETS[id].summary, values: PRESETS[id].values }));
    if (mode === 'json') {
      out.json({ ok: true, presets });
      return 0;
    }
    for (const p of presets) {
      out.line(`${p.id} — ${p.summary}`);
      out.line(`  ${Object.entries(p.values).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    return 0;
  }
  if (args.positionals[0] === 'types') {
    const types = typeDefaults((await effective(args)).config);
    if (mode === 'json') {
      out.json({ ok: true, types });
      return 0;
    }
    out.grid(types.map((k) => [k.type, k.preset, k.detail, k.changed ? '*' : '']));
    return 0;
  }
  if (args.positionals.length > 0) throw new OkbError('E_INVALID', `unknown subcommand "${args.positionals[0]}"`, { hint: 'okb style [presets | types] [--type <kind>] [--style technique|normal|simplifié] [--length courte|normale|détaillée] [--set knob=value] [--note text] [--domain d]' });
  const { config } = await effective(args);
  const resolved = resolveStyle(config, styleRequest(args));
  const brief = renderBrief(resolved);
  // Drafts (dossiers, revised notes) live in private state, never in the KB.
  const draftDir = resolve(config.stateHome, 'drafts');
  await ensureDir(draftDir);
  if (mode === 'json') {
    out.json({ ok: true, style: resolved.style, type: resolved.type, reader: resolved.reader, conceptAssist: resolved.conceptAssist, adjustments: resolved.adjustments, persisted: false, draftDir, brief });
    return 0;
  }
  out.line(brief.trimEnd());
  return 0;
}

/**
 * Notes that other prepared proposals will create. A new proposal may link to
 * them; applying it alone, before them, is refused by the broken-link check.
 */
export async function pendingCreationsFor(config: EffectiveConfig['config'], after: readonly string[]) {
  return pendingCreations(config, after);
}

async function pendingCreations(config: EffectiveConfig['config'], after: readonly string[]) {
  if (after.length === 0) return null;
  const proposals = after.length === 1 && after[0] === 'prepared'
    ? (await listProposals(config)).filter((p) => p.status === 'prepared')
    : await Promise.all(after.map((id) => loadProposal(config, id)));
  const files = new Map<BundlePath, string>();
  for (const p of proposals) {
    if (p.status !== 'prepared') throw new OkbError('E_CONFLICT', `proposal ${p.id} is ${p.status}, not pending`);
    for (const c of p.changes) {
      if (c.kind !== 'create-document') continue;
      if (files.has(c.path)) throw new OkbError('E_CONFLICT', `two pending proposals create ${c.path}`);
      files.set(c.path, materializeFile(c.path, null, p.changes.filter((x) => x.path === c.path)));
    }
  }
  return { files, proposalIds: proposals.map((p) => p.id) };
}

export async function cmdCombine(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  if (args.positionals.length < 2) throw new OkbError('E_INVALID', 'usage: okb combine <proposal-id> <proposal-id>...');
  const parts = await Promise.all(args.positionals.map((id) => loadProposal(config, id)));
  const combined = combineProposals(config, parts);
  assertGuard(await guardApply(config, combined, combined.changes));
  await saveProposal(config, combined);
  // The parts stay on disk with their dossiers; marking them superseded keeps
  // them out of `okb ingest --after prepared` and makes the history readable.
  for (const p of parts) await updateProposalStatus(config, p.id, 'superseded');
  if (mode === 'json') {
    out.json({ ok: true, proposalId: combined.id, combined: parts.map((p, i) => ({ tag: `p${i + 1}`, id: p.id })), changes: combined.changes.length, notes: combined.notes });
    return 0;
  }
  out.line(`proposal ${combined.id} combines ${parts.length} proposals (${combined.changes.length} changes); nothing written yet`);
  out.line(`next: okb review ${combined.id} --diff`);
  return 0;
}

/** Note templates: what sections each kind of note has, and what goes in them. */
export async function cmdTemplate(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const sub = args.positionals[0] ?? 'list';
  // The built-in catalogue can be read before any KB exists (to discover OKB, or to write a draft).
  const loaded = await effective(args).catch((e: unknown) => {
    if (sub === 'show' && e instanceof OkbError && e.code === 'E_CONFIG') return null;
    throw e;
  });
  if (!loaded) return showBuiltinTemplate(args, out, mode);
  const { config } = loaded;
  const language = config.writing.language ?? config.profile.answer.language;
  if (sub === 'list') {
    const all = await loadTemplates(config);
    const { loadCategories, templateCategories } = await import('../../categories/categories.js');
    const categories = await loadCategories(config);
    const byTemplate = templateCategories(all);
    const categoryOf = (id: string) => byTemplate.get(id) ?? categories.find((c) => c.templates.includes(id))?.id ?? 'other';
    if (mode === 'json') {
      out.json({ ok: true, required: config.kb.requireTemplate, templates: all.map((t) => ({ id: t.id, category: categoryOf(t.id), okfType: t.okfType, folder: t.folder, label: pick(t.label, language), when: pick(t.when, language), roles: t.sections.map((s) => ({ role: s.role, required: s.required })) })) });
      return 0;
    }
    // Grouped by the kind of note each template produces, in the category colours.
    const { paint } = await import('../ui/term.js');
    for (const c of categories) {
      const items = all.filter((t) => categoryOf(t.id) === c.id);
      if (!items.length) continue;
      out.line(`${paint.ansi(c.ansi, '●')} ${c.emoji} ${paint.bold(pick(c.label, language))}`);
      for (const t of items) out.line(`   ${paint.code(t.id.padEnd(18))} ${pick(t.label, language)}`);
      out.line();
    }
    return 0;
  }
  if (sub === 'show') {
    const id = args.positionals[1];
    if (!id) throw new OkbError('E_INVALID', 'usage: okb template show <id> [--skeleton]');
    const t = await getTemplate(config, id);
    const emojis = resolveStyle(config).style.emojis === 'landmarks';
    let text = flagBool(args, 'skeleton') ? renderSkeleton(t, language, emojis) : renderTemplateGuide(t, language);
    const { templateExample } = await import('../../templates/registry.js');
    const example = await templateExample(t.id, language);
    if (flagBool(args, 'example')) {
      text = example ? example.text : `${language.startsWith('fr') ? 'Pas encore d’exemple pour ce modèle.' : 'No example for this template yet.'}\n`;
    }
    if (mode === 'json') out.json({ ok: true, template: t, text, example: example?.text ?? null });
    else out.line(text.trimEnd());
    return 0;
  }
  throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { hint: 'okb template list | show <id> [--skeleton]' });
}

/** `okb template show <id>` without a KB: the built-in template, in `--lang` or the system's language. */
async function showBuiltinTemplate(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { BUILTIN_TEMPLATES } = await import('../../templates/builtin.js');
  const { templateExample } = await import('../../templates/registry.js');
  const id = args.positionals[1];
  if (!id) throw new OkbError('E_INVALID', 'usage: okb template show <id> [--skeleton] [--example]');
  const t = BUILTIN_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new OkbError('E_INVALID', `unknown note template "${id}"`, { hint: `Templates: ${BUILTIN_TEMPLATES.map((x) => x.id).join(', ')}` });
  const language = flagString(args, 'lang') ?? (/^fr/i.test(process.env.LC_ALL || process.env.LANG || '') ? 'fr' : 'en');
  const example = await templateExample(t.id, language);
  const text = flagBool(args, 'example')
    ? example?.text ?? (language.startsWith('fr') ? 'Pas encore d’exemple pour ce modèle.\n' : 'No example for this template yet.\n')
    : flagBool(args, 'skeleton') ? renderSkeleton(t, language, true) : renderTemplateGuide(t, language);
  if (mode === 'json') out.json({ ok: true, template: t, text, example: example?.text ?? null });
  else out.line(text.trimEnd());
  return 0;
}

/** One note rewritten in another style, as a reviewable proposal. */
export async function cmdRevise(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const target = args.positionals[0];
  const file = flagString(args, 'file');
  if (!target || !file) throw new OkbError('E_INVALID', 'usage: okb revise <note.md> --file <revised.md> [--reason <text>]');
  const bundle = await loadBundleFor(config);
  const style = resolveStyle(config, styleRequest(args)).style;
  const { requireAccepted, linkProposal } = await import('../../suggest/guard.js');
  const accepted = await requireAccepted(config, target, flagString(args, 'suggestion'));
  const { proposal, check } = proposeRevision(config, bundle, {
    path: asBundlePath(target),
    revised: await readFile(resolve(file), 'utf8'),
    reason: flagString(args, 'reason') ?? `rewrite in the ${style.preset} style`,
    style,
  });
  assertGuard(await guardApply(config, proposal, proposal.changes));
  await saveProposal(config, proposal);
  await linkProposal(config, accepted, proposal.id);
  if (mode === 'json') {
    out.json({ ok: true, proposalId: proposal.id, path: target, kept: check.kept, frontmatterChanges: check.frontmatterChanges, notes: proposal.notes });
    return 0;
  }
  out.line(`proposal ${proposal.id} prepared (nothing written yet)`);
  for (const note of proposal.notes) out.line(`note: ${note}`);
  out.line(`next: okb review ${proposal.id} --diff`);
  return 0;
}

export async function cmdIngest(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
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
  // Secondary sources of a synthesis. Each one is extracted (and paged) through
  // its own run first; here they are re-read from disk, so their bytes must match.
  const extraDocs = [];
  for (const extra of flagList(args, 'with')) {
    const acquiredExtra = await acquire(extra, config);
    const extraDoc = await extractSource(acquiredExtra, config);
    await retainAcquired(config, acquiredExtra, extraDoc);
    extraDocs.push(extraDoc);
  }
  const docs = [doc, ...extraDocs];
  if (flagBool(args, 'template')) {
    const style = resolveStyle(config, styleRequest(args)).style;
    const noteTemplateId = flagString(args, 'note-template');
    const noteTemplate = noteTemplateId ? await getTemplate(config, noteTemplateId) : undefined;
    const path = resolve(statePaths(config).runs, runId, 'analysis-template.json');
    await writeJsonAtomic(path, analysisTemplate(docs, style, noteTemplate));
    if (mode === 'json') out.json({ ok: true, runId, path, sources: docs.map((d) => ({ uri: d.source.uri, sha256: d.source.sha256, title: d.source.title, totalBlocks: d.blocks.length })), style });
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
  const pending = await pendingCreations(config, flagList(args, 'after'));
  // In a brain, a note Claude writes needs the person's accepted suggestion.
  const { requireAccepted, linkProposal } = await import('../../suggest/guard.js');
  const accepted = await requireAccepted(config, appendPath ?? createPath!, flagString(args, 'suggestion'));
  const report = await prepareProposal(config, docs, {
    ...(pending ? { pending } : {}),
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
          ...(flagString(args, 'description') ? { description: flagString(args, 'description')! } : {}),
          ...(flagString(args, 'type') ? { type: flagString(args, 'type')! } : {}),
          // The quality reviewer's justness grade (out of 20), kept with the note for its score.
          ...(flagNumber(args, 'quality') !== undefined ? { xOkb: { review: reviewOf(flagNumber(args, 'quality')!) } } : {}),
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
  await linkProposal(config, accepted, report.proposal.id);

  if (mode === 'json') {
    out.json({
      ok: true,
      proposalId: report.proposal.id,
      contentHash: report.proposal.contentHash,
      conceptAssistLevel: report.conceptAssistLevel,
      source: doc.source,
      ...(extraDocs.length ? { alsoSources: extraDocs.map((d) => d.source) } : {}),
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

export async function cmdConcepts(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const sub = args.positionals[0] ?? 'list';

  // `okb concepts check [--suggest]`: cards without a valid « En une phrase », the text shown on hover.
  if (sub === 'check') {
    const { t } = await import('../../i18n/index.js');
    const { paint } = await import('../ui/term.js');
    const bundle = await loadBundleFor(config);
    const { conceptsWithoutOneLiner } = await import('../../concepts/one-liner.js');
    const missing = conceptsWithoutOneLiner(config, bundle);
    const suggestions = [];
    if (flagBool(args, 'suggest') && missing.length) {
      const { addSuggestion, contextFor } = await import('../../suggest/suggest.js');
      const ctx = await contextFor(config, bundle);
      for (const m of missing.slice(0, 20)) {
        const { suggestion } = await addSuggestion(config, { type: 'concept', title: m.title, why: t(`concepts.why.${m.reason}`), signal: 'concept', source: 'okb concepts check' }, ctx);
        suggestions.push(suggestion);
      }
    }
    if (mode === 'json') { out.json({ ok: true, missing, suggestions }); return 0; }
    if (!missing.length) { out.ok(t('concepts.allGood')); return 0; }
    out.line(t('concepts.missingTitle', { n: missing.length }));
    for (const m of missing) out.line(`  • ${m.title}  ${paint.dim(`${t(`concepts.reason.${m.reason}`)} · ${m.path}`)}`);
    if (suggestions.length) out.ok(t('concepts.suggested', { n: suggestions.length }));
    else out.tip(t('concepts.checkTip'));
    return 0;
  }

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
    const { detectConcepts } = await import('../../concepts/detect.js');
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

export async function cmdLinks(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
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

export async function cmdNav(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);
  const pending = await pendingCreations(config, flagList(args, 'after'));
  const bundle = pending ? withPendingFiles(await loadBundleFor(config), pending.files) : await loadBundleFor(config);
  const files = await buildNavigation(config, { bundle });
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

export async function cmdMigrate(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { config } = await effective(args);

  // The move of a 1.5 brain to the 2.0: a dry run unless --apply; --rollback is the way back.
  if (args.positionals[0] === '2.0' || args.positionals[0] === 'v2') {
    const { applyV2, planV2, rollbackV2 } = await import('../../migrate/v2.js');
    if (flagBool(args, 'rollback')) {
      const back = await rollbackV2(config);
      if (mode === 'json') out.json({ ok: true, ...back });
      else { out.line(say('migrate.v2.rolledBack', { cards: back.reviews.cards, answers: back.reviews.answers })); out.line(say('migrate.v2.notesUntouched')); }
      return 0;
    }
    if (flagBool(args, 'apply')) {
      const done = await applyV2(config);
      if (mode === 'json') out.json({ ok: true, dryRun: false, ...done });
      else { out.line(say('migrate.v2.applied', { snapshot: done.snapshot, cards: done.reviews.cards, answers: done.reviews.answers })); out.line(say('migrate.v2.notesUntouched')); out.line(say('migrate.v2.next')); }
      return 0;
    }
    const plan = await planV2(config);
    if (mode === 'json') { out.json({ ok: true, dryRun: true, ...plan }); return 0; }
    out.line(say(plan.done ? 'migrate.v2.alreadyDone' : 'migrate.v2.dryRun', { kb: config.profile.displayName || config.profile.id }));
    for (const s of plan.steps) out.line(`  ${s.state === 'done' ? '✓' : s.state === 'todo' ? '•' : '?'} ${say(`migrate.v2.${s.id}.${s.state}`, Object.fromEntries(Object.entries(s.detail).map(([k, v]): [string, string | number] => [k, k === 'space' ? say(`app.space.${v}`) : v])))}`);
    if (!plan.done) out.line(say('migrate.v2.howToApply'));
    return 0;
  }

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

export async function cmdRoute(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  if (flagBool(args, 'suggest')) return routeSuggest(args, out, mode);
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

export async function packageVersion(): Promise<string> {
  const { fileURLToPath } = await import('node:url');
  const here = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const raw = await readTextIfExists(resolve(here, 'package.json'));
  if (!raw) return 'unknown';
  return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
}

/**
 * `okb route --suggest [--stdin] [--cwd dir] "<message>"`: the offer the plugin's
 * prompt hook gives Claude — which OKB command fits a message in natural language,
 * and whether other knowledge tools mean Claude should ask first. Read-only.
 */
async function routeSuggest(args: ParsedArgs, out: Output, mode: OutputMode): Promise<number> {
  const { detectOtherKnowledgeTools, renderOffer, suggestIntent } = await import('../../routing/intent.js');
  const { listKbs } = await import('../../kb/registry.js');
  const { lang } = await import('../../i18n/index.js');
  let message = args.positionals.join(' ');
  if (flagBool(args, 'stdin')) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    message = Buffer.concat(chunks).toString('utf8');
  }
  let enabled = true;
  let configured: string[] = [];
  try {
    const { config } = await effective(args);
    enabled = config.routing.suggest;
    configured = config.routing.otherKnowledgeTools;
  } catch {
    enabled = false; // no KB yet: nothing to offer
  }
  const kbs = (await listKbs()).map((k) => ({ id: k.id, name: k.name }));
  const otherTools = [...new Set([...configured, ...(await detectOtherKnowledgeTools(flagString(args, 'cwd')))])];
  const suggestion = enabled ? suggestIntent(message, { kbs, otherTools }) : null;
  const scope = flagString(args, 'cwd') ? await scopeFromPrompt(message, flagString(args, 'cwd')!) : null;
  const context = [scope?.text ?? '', suggestion ? renderOffer(suggestion, lang()) : ''].filter(Boolean).join('\n\n');
  if (mode === 'json') out.json({ ok: true, enabled, suggestion, scope: scope ? { repo: scope.repo, ticket: scope.ticket, changed: scope.changed } : null, context });
  else if (context) out.line(context);
  return 0;
}

/**
 * At the top of a workspace, a message naming one repository or a ticket
 * narrows OKB to it: Claude gets that repository's brief at once. A ticket
 * OKB does not follow yet comes with how to start following it.
 */
async function scopeFromPrompt(message: string, cwd: string): Promise<{ text: string; repo: string; ticket: string | null; changed: boolean } | null> {
  try {
    const { resolveScope, scopeFromMessage } = await import('../../work/scope.js');
    const scope = await resolveScope(resolve(cwd));
    const hit = await scopeFromMessage(message, scope);
    if (!hit) return null;
    const lines: string[] = [];
    const { buildBrief, renderBrief, startLine } = await import('../../work/brief.js');
    const newRef = hit.ref && !hit.ticket ? hit.ref : null;
    if (hit.changed) {
      const { scopeFor } = await import('../../work/scope.js');
      const brief = await buildBrief(await scopeFor(scope.workspace, hit.repo, hit.ticket, 'chosen'), { sync: true });
      lines.push(`OKB narrowed its scope to "${hit.repo.name}"${hit.ticket ? ` and ticket ${hit.ticket.ref}` : ''} because the user named it: say so in one short line (🎯 ${hit.repo.name}${hit.ticket ? ` · 🎫 ${hit.ticket.ref}` : ''}) and work from this brief.`);
      if (brief) lines.push(renderBrief(brief, { mentionedRef: newRef }));
    } else if (newRef) {
      lines.push(startLine(newRef, hit.repo.id));
    }
    return lines.length ? { text: lines.join('\n'), repo: hit.repo.id, ticket: hit.ticket?.ref ?? hit.ref, changed: hit.changed } : null;
  } catch {
    return null;
  }
}
