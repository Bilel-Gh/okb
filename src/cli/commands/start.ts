import { resolve } from 'node:path';
import { t } from '../../i18n/index.js';
import { kbNames, listKbs } from '../../kb/registry.js';
import { discover, fillStep, type Discovery } from '../../setup/discover.js';
import { KIND_ICON } from '../../work/kinds.js';
import { flagString, parseArgs } from '../args.js';
import { choose, input } from '../ui/prompt.js';
import { paint, sym, tilde } from '../ui/term.js';
import { canAsk, type Ctx, type Handler } from './common.js';

/**
 * `okb start` — where you stand, what OKB recommends and the exact plan; in a
 * terminal it runs the plan after one confirmation. `--json` is what the setup
 * skill reads before asking the person. Nothing is written before the yes.
 */
export async function cmdStart(ctx: Ctx, dispatch: (name: string) => Handler | undefined): Promise<number> {
  const { out } = ctx;
  const d = await discover(resolve(flagString(ctx.args, 'cwd') ?? process.cwd()));
  if (ctx.mode === 'json') { out.json({ ok: true, ...d }); return 0; }
  printOverview(ctx, d);
  const runnable = d.plan.filter((s) => s.argv);
  if (!runnable.length || !canAsk(ctx)) {
    if (runnable.length) out.next(runnable.map((s) => shown(s.argv!)));
    else if (d.next.length) out.next([...d.next]);
    return 0;
  }
  // The KB is named by the person; the hint only shows in the empty field.
  let name: string | null = null;
  const needsName = runnable.find((s) => s.asksName);
  if (needsName) {
    const taken = new Set((await listKbs()).map((k) => k.id));
    name = await input(t('start.nameQ'), {
      placeholder: needsName.nameHint ?? t('wiz.name.placeholder'),
      validate: (v) => (!v.trim() ? t('wiz.required') : taken.has(kbNames(v).id) ? t('wiz.name.taken', { id: kbNames(v).id }) : undefined),
    });
  }
  const go = await choose(t('start.goQ'), [
    { value: 'go', label: t('start.go'), recommended: true },
    { value: 'no', label: t('start.cancel') },
  ]);
  if (go !== 'go') return 0;
  for (const s of runnable) {
    const argv = fillStep(s.argv!, name);
    out.line();
    out.line(`${paint.bold(`▶ ${s.title}`)}  ${paint.dim(`okb ${argv.join(' ')}`)}`);
    const args = parseArgs(argv);
    const handler = dispatch(args.command);
    if (!handler) continue;
    // Everything was asked above: the steps run without questions (the tools installer asks its own).
    const code = await handler({ args: s.interactive ? args : { ...args, flags: { ...args.flags, yes: true } }, out, mode: 'text' });
    if (code !== 0) { out.warn(t('start.stepFailed', { step: s.title })); return code; }
  }
  out.line();
  out.ok(t('start.done'));
  const later = d.plan.filter((s) => s.inClaude);
  for (const s of later) out.line(`  ${sym.tip()} ${t('start.later', { command: paint.code(s.inClaude!), what: s.title })}`);
  if (d.next.length) out.next([...d.next]);
  return 0;
}

/** A plan command as the person reads it: the name and id they will choose as placeholders, paths with `~`. */
function shown(argv: readonly string[]): string {
  return `okb ${argv.map((a) => (a === '{name}' ? `"<${t('start.nameWord')}>"` : a === '{id}' ? '<id>' : /[\s"]/.test(a) ? JSON.stringify(tilde(a)) : tilde(a))).join(' ')}`;
}

function printOverview(ctx: Ctx, d: Discovery): void {
  const { out } = ctx;
  out.line(paint.bold(`🧭 ${t('start.title')}`));
  out.line(paint.dim(`  OKB ${d.version} · ${tilde(d.cwd)}`));
  out.line();
  if (d.kbs.length) for (const k of d.kbs) out.line(`  ${KIND_ICON[k.kind]} ${paint.name(k.name)} ${paint.dim(`${t(`kb.kind.${k.kind}`)} · ${tilde(k.root)}${k.active ? ` · ${t('profile.active')}` : ''}`)}`);
  else out.line(`  ${paint.dim(t('kb.noneConnected'))}`);
  if (d.reposFolder) out.line(`  📁 ${t('start.reposFolder', { folder: tilde(d.reposFolder.path), n: d.reposFolder.repos.length })} ${paint.dim(d.reposFolder.repos.slice(0, 6).map((r) => r.name).join(', ') + (d.reposFolder.repos.length > 6 ? ', …' : ''))}`);
  for (const n of d.notesFolders.filter((x) => !d.tree.some((e) => e.path === x.path))) out.line(`  📝 ${n.kb ? t('start.notesKb', { folder: tilde(n.path), kb: n.kb }) : t('start.notesOld', { folder: tilde(n.path), n: n.notes })}`);
  if (d.tree.length) {
    // The folder of repositories as OKB sees it: one line per subfolder.
    const icon = { repo: '📦', 'repo-in': '📦', kb: '📚', 'old-kb': '📝', group: '📁', other: '·' } as const;
    const w = Math.min(28, Math.max(...d.tree.map((e) => e.name.length)) + 1);
    for (const e of d.tree.slice(0, 40)) {
      const what = e.kind === 'repo' ? t('start.tree.repo') : e.kind === 'repo-in' ? t('start.tree.repoIn', { kb: e.kb ?? '' }) : e.kind === 'kb' ? t('start.tree.kb', { kb: e.kb ?? '' })
        : e.kind === 'old-kb' ? t('start.tree.oldKb', { n: e.notes }) : e.kind === 'group' ? t('start.tree.group', { n: e.repos.length, names: e.repos.slice(0, 5).join(', ') }) : t('start.tree.other');
      out.line(`     ${icon[e.kind]} ${(e.kind === 'group' ? `${e.name}/` : e.name).padEnd(w)} ${paint.dim(what)}`);
    }
    if (d.tree.length > 40) out.line(paint.dim(`     … ${d.tree.length - 40}`));
  }
  out.line(`  🔌 ${t(`start.plugin.${d.tools.plugin}`)} · ${d.tools.launcher ? t('start.launcherOk') : t('start.launcherMissing')}`);
  if (d.advice.length) {
    out.line();
    out.line(paint.bold(`💡 ${t('start.adviceTitle')}`));
    for (const a of d.advice) out.line(`  ${a.level === 'warn' ? sym.warn() : a.level === 'do' ? sym.ok() : sym.info()} ${a.text}`);
  }
  if (d.plan.length) {
    out.line();
    out.line(paint.bold(`📋 ${t('start.planTitle')}`));
    d.plan.forEach((s, i) => {
      out.line(`  ${i + 1}. ${paint.bold(s.title)}${s.optional ? paint.dim(` (${t('start.optional')})`) : ''}`);
      out.line(paint.dim(`     ${s.why}`));
      out.line(`     ${paint.code(s.argv ? shown(s.argv) : `${t('start.inClaude')} ${s.inClaude}`)}`);
    });
    out.line(paint.dim(`  ${t('start.promise')}`));
  }
}
