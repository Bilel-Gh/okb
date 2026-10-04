import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { doctor, measureContext } from '../../doctor/doctor.js';
import type { OkbConfig } from '../../config/schema.js';
import { has, t, tn } from '../../i18n/index.js';
import { readFocus, initFocus } from '../../focus/focus.js';
import { readOwner, writeOwner, foreignNotes } from '../../kb/registry.js';
import { claudeState, installClaudePlugin, installLauncher, launcherState, PRODUCT_ROOT, productVersion, updateProduct } from '../../integrations/system.js';
import { maintain } from '../../maintain/maintain.js';
import { health, gitState } from '../../status/status.js';
import { OkbError } from '../../util/errors.js';
import { paginate } from '../../util/context-meter.js';
import { flagBool, flagString } from '../args.js';
import { confirm, spin } from '../ui/prompt.js';
import { banner, checklist, paint, sym, tilde, type CheckItem } from '../ui/term.js';
import { canAsk, effective, kbFlag, type Ctx } from './common.js';

type Fix = { label: string; run: () => Promise<string> };
type Row = { name: string; status: 'ok' | 'warn' | 'fail' | 'unknown'; detail: string; fix?: Fix; hint?: string };

const SECTION: Record<string, 'okb' | 'kb' | 'claude'> = {
  node: 'okb', 'okb-command': 'okb', sources: 'okb', 'okf-spec-pin': 'okb',
  configuration: 'kb', 'kb.root': 'kb', 'kb-owner': 'kb', state: 'kb', focus: 'kb', 'kb-git': 'kb', 'kb-private': 'kb', repos: 'kb',
  'claude-plugin': 'claude', plugin: 'claude', runtime: 'claude', mcp: 'claude',
};

const ORDER = ['node', 'okb-command', 'sources', 'okf-spec-pin', 'kb.root', 'kb-owner', 'kb-private', 'focus', 'kb-git', 'repos', 'configuration', 'state', 'claude-plugin', 'plugin', 'runtime', 'mcp'];

/** The doctor's rows for people: grouped, in plain words, each warning with what to do. */
function doctorSections(rows: readonly Row[], config: OkbConfig | null, fixing: boolean): { title: string; items: CheckItem[] }[] {
  // The three source readers become one line unless one of them is broken.
  const readers = rows.filter((r) => r.name.startsWith('adapter:'));
  const merged: Row[] = rows.filter((r) => !r.name.startsWith('adapter:'));
  const brokenReaders = readers.filter((r) => r.status !== 'ok');
  merged.splice(1, 0, brokenReaders.length
    ? { name: 'sources', status: 'fail', detail: brokenReaders.map((r) => r.detail).join(' · ') }
    : { name: 'sources', status: 'ok', detail: t('doctor.detail.sources') });
  const fixHint = fixing ? undefined : t('doctor.hint.fix');
  const item = (r: Row): CheckItem => {
    const label = has(`doctor.check.${r.name}`) ? t(`doctor.check.${r.name}`) : r.name;
    const base = { status: r.status, label };
    switch (r.name) {
      case 'kb.root':
        return { ...base, detail: r.status === 'ok' ? tilde(r.detail) : r.detail, tone: 'path' };
      case 'okb-command':
        return { ...base, detail: r.status === 'ok' ? tilde(r.detail) : r.detail, tone: 'path', ...(r.fix ? { hint: fixHint } : { hint: existsSync(resolve(homedir(), '.okb', 'bin', 'okb')) ? t('doctor.hint.launcherManual') : t('doctor.hint.launcherNode', { path: tilde(resolve(PRODUCT_ROOT, 'dist', 'cli', 'index.js')) }) }) };
      case 'state':
        return { ...base, detail: tilde(r.detail.replace(/ is (not )?writable( yet)?$/, '')), tone: 'path' };
      case 'focus':
        return { ...base, detail: r.status === 'ok' ? tilde(r.detail) : r.detail, tone: 'path', ...(r.fix ? { hint: fixHint } : {}) };
      case 'configuration':
        return { ...base, detail: config ? t('doctor.detail.configuration', { id: config.profile.id }) : r.detail, ...(config ? {} : { hint: 'okb init' }) };
      case 'okf-spec-pin':
        return { ...base, detail: r.status === 'ok' ? t('doctor.detail.okf', { rev: r.detail.replace('pinned to ', '').slice(0, 7) }) : r.detail };
      case 'plugin':
        return { ...base, detail: r.status === 'ok' ? t('doctor.detail.pluginFiles') : r.detail };
      case 'runtime':
        return { ...base, detail: r.status === 'ok' ? t('doctor.detail.runtimeIn') : t('doctor.detail.runtimeOut') };
      case 'mcp':
        return { ...base, detail: r.detail.startsWith('no MCP') ? t('doctor.detail.mcpNone') : r.detail.replace('configured: ', '') };
      case 'claude-plugin':
        return { ...base, detail: r.detail, ...(r.status === 'warn' ? { hint: fixing ? undefined : t('doctor.hint.plugin') } : {}) };
      default:
        return { ...base, detail: r.detail, ...(r.hint ? { hint: r.hint } : r.fix ? { hint: fixHint } : {}) };
    }
  };
  const kbName = config ? config.profile.displayName || config.profile.id : '';
  const titles = { okb: t('doctor.section.okb'), kb: config ? t('doctor.section.kb', { name: kbName }) : t('doctor.section.kbNone'), claude: t('doctor.section.claude') };
  const order = (name: string) => { const i = ORDER.indexOf(name); return i < 0 ? ORDER.length : i; };
  return (['okb', 'kb', 'claude'] as const).map((sec) => ({
    title: titles[sec],
    items: merged.filter((r) => (SECTION[r.name] ?? 'okb') === sec).sort((a, b) => order(a.name) - order(b.name)).map(item),
  }));
}

/** `okb doctor [--fix]` — a checklist, and a repair offered for each problem it can solve. */
export async function cmdDoctor(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  let report;
  let config = null;
  try {
    config = (await effective(args)).config;
    report = await doctor(config);
  } catch (error) {
    report = await doctor(null, error as Error);
  }
  const rows: Row[] = report.checks.map((c) => ({ name: c.name, status: c.status, detail: c.hint ? `${c.detail} — ${c.hint}` : c.detail }));

  const version = await productVersion();
  const claude = await claudeState();
  rows.push(claude.cli
    ? claude.installed
      ? { name: 'claude-plugin', status: claude.version && claude.version !== version ? 'warn' : 'ok', detail: claude.version && claude.version !== version ? t('doctor.pluginOld', { plugin: claude.version, engine: version }) : t('doctor.pluginOk', { version: claude.version ?? '?' }), fix: { label: t('doctor.fix.plugin'), run: async () => ((await installClaudePlugin()).ok ? t('doctor.fixed.plugin') : t('doctor.fixFailed')) } }
      : { name: 'claude-plugin', status: 'warn', detail: t('doctor.pluginMissing'), fix: { label: t('doctor.fix.plugin'), run: async () => ((await installClaudePlugin()).ok ? t('doctor.fixed.plugin') : t('doctor.fixFailed')) } }
    : { name: 'claude-plugin', status: 'unknown', detail: t('doctor.noClaude') });
  const launcher = await launcherState();
  rows.push(launcher.onPath
    ? { name: 'okb-command', status: 'ok', detail: launcher.onPath }
    : { name: 'okb-command', status: 'warn', detail: t('doctor.noLauncher'), ...(launcher.candidates[0] ? { fix: { label: t('doctor.fix.launcher', { dir: paint.path(launcher.candidates[0]) }), run: async () => t('doctor.fixed.launcher', { path: paint.path(await installLauncher(launcher.candidates[0]!)) }) } } : {}) });
  if (config) {
    const cfg = config;
    const owner = await readOwner(cfg.kb.root);
    if (owner === cfg.profile.id) rows.push({ name: 'kb-owner', status: 'ok', detail: t('doctor.ownerOk') });
    else if (owner) rows.push({ name: 'kb-owner', status: 'fail', detail: t('err.kbOtherOwner.why', { owner, root: cfg.kb.root }) });
    else {
      const foreign = await foreignNotes(cfg.kb.root, 1);
      rows.push({ name: 'kb-owner', status: 'warn', detail: foreign.length ? t('doctor.ownerForeign') : t('doctor.ownerMissing'), ...(foreign.length ? {} : { fix: { label: t('doctor.fix.owner', { root: paint.path(cfg.kb.root), kb: paint.name(cfg.profile.displayName || cfg.profile.id) }), run: async () => { await writeOwner(cfg.kb.root, cfg.profile.id); return t('doctor.fixed.owner', { root: paint.path(cfg.kb.root), kb: paint.name(cfg.profile.displayName || cfg.profile.id) }); } } }) });
    }
    const focus = await readFocus(cfg);
    rows.push(focus.exists
      ? { name: 'focus', status: focus.stale ? 'warn' : 'ok', detail: focus.stale ? t('focus.stale', { days: focus.ageDays ?? 0 }) : focus.path }
      : { name: 'focus', status: 'warn', detail: t('focus.none'), fix: { label: t('doctor.fix.focus'), run: async () => t('focus.created', { path: await initFocus(cfg) }) } });
    const git = await gitState(cfg.kb.root);
    rows.push(git.repo
      ? { name: 'kb-git', status: git.dirty || (git.ahead ?? 0) > 0 ? 'warn' : 'ok', detail: git.dirty ? tn('status.gitDirty', git.dirty) : (git.ahead ?? 0) > 0 ? tn('status.gitAhead', git.ahead!) : t('status.gitClean'),
        ...(git.dirty ? { hint: t('doctor.hint.commit', { root: tilde(cfg.kb.root) }) } : (git.ahead ?? 0) > 0 ? { hint: `git -C ${tilde(cfg.kb.root)} push` } : {}) }
      : { name: 'kb-git', status: 'unknown', detail: t('doctor.noGit') });
    const { listRepos } = await import('../../repo/registry.js');
    const repos = (await listRepos()).filter((r) => r.kb === cfg.profile.id);
    if (repos.length) {
      const missing = repos.filter((r) => !existsSync(r.path));
      rows.push(missing.length
        ? { name: 'repos', status: 'warn', detail: t('doctor.repos.missing', { names: missing.map((r) => r.name).join(', ') }), hint: t('doctor.hint.repos') }
        : { name: 'repos', status: 'ok', detail: tn('doctor.repos.ok', repos.length, { names: repos.slice(0, 4).map((r) => r.name).join(', ') }) });
    }
    if (cfg.kb.confidential) {
      const { cloudSyncedFolder, kbRemotes } = await import('../../repo/confidential.js');
      const synced = cloudSyncedFolder(cfg.kb.root);
      const remotes = git.repo ? await kbRemotes(cfg.kb.root) : [];
      rows.push(synced || remotes.length
        ? { name: 'kb-private', status: 'warn', detail: synced ? t('doctor.private.synced', { where: synced }) : t('doctor.private.remote', { remote: remotes[0]! }), hint: t('doctor.hint.private') }
        : { name: 'kb-private', status: 'ok', detail: t('doctor.private.ok') });
    }
  }
  const failing = rows.filter((r) => r.status === 'fail').length;

  if (ctx.mode === 'json') {
    out.json({ ...report, checks: rows.map(({ fix, ...r }) => ({ ...r, fixable: Boolean(fix) })), ok: report.ok && failing === 0 });
    return report.ok && failing === 0 ? 0 : 1;
  }
  const fixing = flagBool(args, 'fix') && canAsk(ctx);
  out.line(banner(version, t('doctor.banner')).replace(/\n$/, ''));
  out.line(checklist(doctorSections(rows, config, fixing)));
  out.line();
  const fixable = rows.filter((r) => r.fix && r.status !== 'ok');
  const attention = rows.filter((r) => r.status === 'warn' || r.status === 'fail').length;
  if (fixable.length && fixing) {
    let done = 0;
    for (const r of fixable) {
      if (!(await confirm(r.fix!.label, true))) continue;
      const s = spin(r.fix!.label);
      try { const msg = await r.fix!.run(); s.done(paint.ok(msg)); done++; } catch (e) { s.fail(`${t('doctor.fixFailed')}: ${(e as Error).message}`); }
    }
    if (done) out.ok(tn('doctor.fixedCount', done));
  } else if (attention) {
    out.warn(tn('doctor.attention', attention));
    if (fixable.length) out.next([`okb doctor --fix${kbFlag(args)}`]);
  } else if (report.ok) out.ok(paint.bold(t('doctor.allGood')));
  if (flagBool(args, 'verbose')) {
    out.heading(t('doctor.support'));
    out.grid(report.support.map((s) => [s.kind, s.enabled ? sym.ok() : sym.err(), s.notes]));
    out.line(paint.dim(t('doctor.context', { bytes: report.context.alwaysOn.bytes, tokens: report.context.alwaysOn.tokensEstimated })));
  }
  return report.ok && failing === 0 ? 0 : 1;
}

/** `okb maintain` — problems grouped by gravity and file, each explained with its fix. */
export async function cmdMaintain(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const report = await maintain(config, { checkSources: flagBool(args, 'check-sources') });
  if (ctx.mode === 'json') { out.json({ ok: report.okfConformant, ...report, health: health(report) }); return report.okfConformant ? 0 : 1; }
  const h = health(report);
  const tone = h.errors ? paint.err : h.warnings ? paint.warn : paint.ok;
  out.box([
    `${t('maintain.score')} ${tone(paint.bold(`${h.score}/100`))}`,
    `${tn('maintain.scanned', report.scanned)} · OKF ${report.okfConformant ? paint.ok(t('maintain.conform')) : paint.err(t('maintain.notConform'))}`,
    `${tn('status.errors', h.errors)} · ${tn('status.warnings', h.warnings)} · ${tn('maintain.infos', h.infos)}`,
  ], `🩺 ${t('maintain.title')}`, h.errors ? 'err' : h.warnings ? 'warn' : 'ok');
  const all = [
    ...report.okfFindings.map((f) => ({ level: f.level, code: f.code, where: f.path, message: f.message })),
    ...report.linkIssues.map((i) => ({ level: i.level, code: i.code, where: `${i.file}:${i.line}`, message: i.message })),
    ...report.issues.map((i) => ({ level: i.level, code: i.code, where: i.path, message: i.message })),
  ];
  if (!all.length) { out.ok(t('maintain.clean')); return 0; }
  const order = { error: 0, warning: 1, info: 2 } as Record<string, number>;
  const codes = [...new Set(all.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3)).map((x) => x.code))];
  const { page, truncation } = paginate(codes, { limit: flagBool(args, 'all') ? 500 : 8, cursor: flagString(args, 'cursor') ?? null });
  for (const code of page) {
    const items = all.filter((x) => x.code === code);
    const lvl = items[0]!.level;
    const head = lvl === 'error' ? sym.err() : lvl === 'warning' ? sym.warn() : sym.info();
    out.line(`\n${head} ${paint.bold(has(`issue.${code}.title`) ? t(`issue.${code}.title`) : code)} ${paint.dim(`· ${items.length} · ${code}`)}`);
    if (has(`issue.${code}.why`)) out.line(`  ${t(`issue.${code}.why`)}`);
    if (has(`issue.${code}.fix`)) out.line(`  ${sym.arrow()} ${t(`issue.${code}.fix`)}`);
    for (const x of items.slice(0, flagBool(args, 'verbose') ? 50 : 4)) out.line(paint.dim(`    ${x.where} — ${x.message}`));
    if (items.length > 4 && !flagBool(args, 'verbose')) out.line(paint.dim(`    ${t('maintain.more', { n: items.length - 4 })}`));
  }
  out.truncation(truncation, 'okb maintain');
  out.next([`okb nav${kbFlag(args)}`]);
  return report.okfConformant ? 0 : 1;
}

/** `okb explain <code>` — what an error or a maintenance finding means and what to do. */
export function cmdExplain(ctx: Ctx): number {
  const code = (ctx.args.positionals[0] ?? '').toUpperCase();
  if (!code) throw new OkbError('E_INVALID', 'usage: okb explain <code>', { key: 'usage', params: { usage: 'okb explain E_CONFLICT' } });
  const base = code.startsWith('E_') ? `code.${code}` : `issue.${code}`;
  if (!has(`${base}.title`)) throw new OkbError('E_NOT_FOUND', `no explanation for "${code}"`, { key: 'explainUnknown', params: { code } });
  const text = { title: t(`${base}.title`), explain: has(`${base}.explain`) ? t(`${base}.explain`) : has(`${base}.why`) ? t(`${base}.why`) : '', fix: has(`${base}.fix`) ? t(`${base}.fix`) : '' };
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, code, ...text }); return 0; }
  ctx.out.box([paint.bold(text.title), '', ...wrap(text.explain, 72), ...(text.fix ? ['', `${sym.arrow()} ${text.fix}`] : [])], code, 'info');
  return 0;
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > width) { out.push(line.trim()); line = word; } else line += ` ${word}`;
    }
    out.push(line.trim());
  }
  return out;
}

const TERMS = ['kb', 'proposal', 'approval', 'receipt', 'profile', 'concept', 'inbox', 'focus', 'journal', 'template', 'style', 'evidence', 'okf', 'plugin', 'skill', 'hook'] as const;

/** `okb glossary [term]` — every word OKB uses, in one line each. */
export function cmdGlossary(ctx: Ctx): number {
  const wanted = (ctx.args.positionals[0] ?? '').toLowerCase();
  const terms = TERMS.filter((k) => !wanted || k.includes(wanted) || t(`glossary.${k}.term`).toLowerCase().includes(wanted));
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, terms: terms.map((k) => ({ id: k, term: t(`glossary.${k}.term`), definition: t(`glossary.${k}.def`) })) }); return 0; }
  if (!terms.length) { ctx.out.info(t('glossary.none', { term: wanted })); return 0; }
  for (const k of terms) ctx.out.line(`${paint.bold(t(`glossary.${k}.term`))}\n  ${t(`glossary.${k}.def`)}`);
  return 0;
}

/** `okb update` — new version, rebuilt, plugin reinstalled. */
export async function cmdUpdate(ctx: Ctx): Promise<number> {
  const { out } = ctx;
  if (canAsk(ctx) && !(await confirm(t('update.q'), true))) return 130;
  if (!canAsk(ctx) && !flagBool(ctx.args, 'yes') && ctx.mode !== 'json') throw new OkbError('E_INVALID', 'update needs --yes when it cannot ask', { key: 'updateNeedsYes' });
  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  const s = spin(t('update.running'));
  const ok = await updateProduct((step, okStep, detail) => { steps.push({ step, ok: okStep, ...(detail ? { detail } : {}) }); });
  ok ? s.done(t('update.done', { version: await productVersion() })) : s.fail(t('update.failed'));
  if (ctx.mode === 'json') { out.json({ ok, steps }); return ok ? 0 : 1; }
  for (const st of steps) (st.ok ? out.ok(`${t(`update.step.${st.step}`)}${st.detail ? paint.dim(`  ${st.detail}`) : ''}`) : out.fail(`${t(`update.step.${st.step}`)} — ${st.detail ?? ''}`));
  if (ok) out.tip(t('update.newSession'));
  return ok ? 0 : 1;
}

/** `okb context` — what OKB costs in Claude's context. */
export async function cmdContext(ctx: Ctx): Promise<number> {
  const footprint = await measureContext();
  let budgets: unknown = null;
  try { budgets = (await effective(ctx.args)).config.context.budgets; } catch { budgets = null; }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, footprint, budgets }); return 0; }
  ctx.out.line(t('context.always', { bytes: footprint.alwaysOn.bytes, tokens: footprint.alwaysOn.tokensEstimated }));
  ctx.out.heading(t('context.workflows'));
  ctx.out.grid(footprint.perWorkflow.map((m) => [m.label, `${m.bytes} B`, `~${m.tokensEstimated} tok`]));
  ctx.out.heading(t('context.agents'));
  ctx.out.grid(footprint.perAgent.map((m) => [m.label, `${m.bytes} B`, `~${m.tokensEstimated} tok`]));
  for (const note of footprint.notes) ctx.out.line(paint.dim(`- ${note}`));
  return 0;
}

export const pathOf = (p: string) => resolve(p);
