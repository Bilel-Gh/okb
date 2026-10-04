import { t, tn } from '../../i18n/index.js';
import { listKbs } from '../../kb/registry.js';
import { productVersion } from '../../integrations/system.js';
import { computeStatus } from '../../status/status.js';
import { parseArgs } from '../args.js';
import { choose } from '../ui/prompt.js';
import { banner, paint } from '../ui/term.js';
import { canAsk, effective, type Ctx, type Handler } from './common.js';
import { printStatus } from './status.js';
import { repoForDir } from '../../repo/registry.js';

/**
 * `okb` with nothing after it: the front door. First time, the setup wizard;
 * afterwards, where things stand and a menu of what makes sense now.
 */
export async function cmdHome(ctx: Ctx, dispatch: (name: string) => Handler | undefined): Promise<number> {
  const { out } = ctx;
  const kbs = await listKbs();
  if (!kbs.length) {
    if (canAsk(ctx)) {
      const { cmdInit } = await import('./init.js');
      return cmdInit(ctx, { first: true });
    }
    if (ctx.mode === 'json') { out.json({ ok: true, kbs: [], next: 'okb init' }); return 0; }
    out.line(banner(await productVersion(), t('home.subtitle')));
    out.line(t('home.welcome'));
    out.next(['okb init', 'okb tour']);
    return 0;
  }
  const { config } = await effective(ctx.args);
  const status = await computeStatus(config, { light: !canAsk(ctx) });
  if (ctx.mode === 'json') { out.json({ ok: true, status }); return 0; }
  out.line(banner(await productVersion(), t('home.subtitle')));
  printStatus({ ...ctx, out }, status);
  if (!canAsk(ctx)) { out.line(paint.dim(t('help.more'))); return 0; }

  const here = await repoForDir(process.cwd()).catch(() => null);
  for (;;) {
    const options: { value: string; label: string; hint?: string; recommended?: boolean }[] = [];
    if (status.pending.length) options.push({ value: 'review', label: t('home.menu.review'), hint: tn('status.pendingCount', status.pending.length), recommended: true });
    options.push({ value: 'ask', label: t('home.menu.ask'), recommended: !status.pending.length });
    options.push({ value: 'capture', label: t('home.menu.capture') });
    if (here) options.push({ value: 'repo', label: t('home.menu.repo', { name: here.repo.name }) });
    if (status.inbox.open) options.push({ value: 'inbox', label: t('home.menu.inbox'), hint: String(status.inbox.open) });
    options.push({ value: 'focus', label: status.focus.exists ? t('home.menu.focus') : t('home.menu.focusCreate'), ...(status.focus.stale ? { hint: t('home.menu.focusStale') } : {}) });
    options.push({ value: 'done', label: t('home.menu.done') });
    options.push({ value: 'weekly', label: t('home.menu.weekly') });
    options.push({ value: 'serve', label: t('home.menu.serve') });
    options.push({ value: 'open', label: t('home.menu.open') });
    options.push({ value: 'kb', label: kbs.length > 1 ? t('home.menu.kbs', { n: kbs.length }) : t('home.menu.kb') });
    options.push({ value: 'settings', label: t('home.menu.settings') });
    options.push({ value: 'doctor', label: t('home.menu.doctor') });
    options.push({ value: 'help', label: t('home.menu.help') });
    options.push({ value: 'quit', label: t('ui.quit') });
    const choice = await choose(t('home.menu.q'), options);
    if (choice === 'quit') return 0;
    const sub = choice === 'focus' && !status.focus.exists ? ['focus', 'init'] : [choice];
    const handler = dispatch(sub[0]!);
    if (!handler) return 0;
    const next: Ctx = { ...ctx, args: parseArgs([...sub, ...passthrough(ctx)]) };
    const code = await handler(next);
    if (['serve', 'review', 'kb', 'settings', 'repo'].includes(choice)) return code;
    out.line();
  }
}

function passthrough(ctx: Ctx): string[] {
  const kb = ctx.args.flags.kb ?? ctx.args.flags.profile;
  return typeof kb === 'string' ? ['--kb', kb] : [];
}
