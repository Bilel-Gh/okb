#!/usr/bin/env node
import { setLanguage, t, type Lang } from '../i18n/index.js';
import { productVersion, openExternal } from '../integrations/system.js';
import { OkbError } from '../util/errors.js';
import { flagBool, flagNumber, flagString, parseArgs } from './args.js';
import { Output, reportError, setVerbosity, type OutputMode } from './output.js';
import { disableInteraction } from './ui/prompt.js';
import { paint, setColor } from './ui/term.js';
import type { Ctx, Handler } from './commands/common.js';
import { effective } from './commands/common.js';
import { cmdApply, cmdReview, cmdUndo } from './commands/review.js';
import { cmdAsk, cmdCapture, cmdDone, cmdFocus, cmdInbox, cmdOpen, cmdProfile, cmdSkillify, cmdWeekly } from './commands/daily.js';
import { cmdContext, cmdDoctor, cmdExplain, cmdGlossary, cmdMaintain, cmdUpdate } from './commands/care.js';
import { cmdComplete, cmdCompletion, cmdHelp, commandHelp, findCommand, suggest } from './commands/help.js';
import { cmdKb } from './commands/kb.js';
import { cmdSettings } from './commands/settings.js';
import { cmdStatus } from './commands/status.js';
import { cmdTour } from './commands/tour.js';
import * as legacy from './commands/legacy.js';

const wrap = (fn: (args: Ctx['args'], out: Output, mode: OutputMode) => Promise<number> | number): Handler => (c) => fn(c.args, c.out, c.mode);

/** Every command by canonical name; aliases resolve through the help catalogue. */
const HANDLERS: Record<string, Handler> = {
  home: (c) => import('./commands/home.js').then((m) => m.cmdHome(c, dispatch)),
  start: (c) => import('./commands/start.js').then((m) => m.cmdStart(c, dispatch)),
  init: (c) => import('./commands/init.js').then((m) => m.cmdInit(c, { first: true })),
  new: (c) => import('./commands/init.js').then((m) => m.cmdInit(c, { first: false })),
  tour: cmdTour,
  status: cmdStatus,
  ask: cmdAsk,
  open: cmdOpen,
  capture: cmdCapture,
  inbox: cmdInbox,
  review: cmdReview,
  apply: cmdApply,
  undo: cmdUndo,
  focus: cmdFocus,
  done: cmdDone,
  weekly: cmdWeekly,
  serve: cmdServe,
  kb: cmdKb,
  // `okb convert` is `okb kb convert`: the word people use first.
  convert: (c) => cmdKb({ ...c, args: { ...c.args, positionals: ['convert', ...c.args.positionals] } }),
  categories: (c) => import('./commands/categories.js').then((m) => m.cmdCategories(c)),
  repo: (c) => import('./commands/repo.js').then((m) => m.cmdRepo(c)),
  workspace: (c) => import('./commands/work.js').then((m) => m.cmdWorkspace(c)),
  scope: (c) => import('./commands/work.js').then((m) => m.cmdScope(c)),
  ticket: (c) => import('./commands/work.js').then((m) => m.cmdTicket(c)),
  brain: (c) => import('./commands/brain.js').then((m) => m.cmdBrain(c)),
  where: (c) => import('./commands/brain.js').then((m) => m.cmdWhere(c)),
  now: (c) => import('./commands/brain.js').then((m) => m.cmdNow(c)),
  product: (c) => import('./commands/brain.js').then((m) => m.cmdProduct(c)),
  history: (c) => import('./commands/brain.js').then((m) => m.cmdHistory(c)),
  trash: (c) => import('./commands/brain.js').then((m) => m.cmdTrash(c)),
  backup: (c) => import('./commands/brain.js').then((m) => m.cmdBackup(c)),
  find: (c) => import('./commands/find.js').then((m) => m.cmdFind(c)),
  dev: (c) => import('./commands/dev.js').then((m) => m.cmdDev(c)),
  learn: (c) => import('./commands/learn.js').then((m) => m.cmdLearn(c)),
  career: (c) => import('./commands/learn.js').then((m) => m.cmdCareer(c)),
  journal: (c) => import('./commands/learn.js').then((m) => m.cmdJournal(c)),
  secret: (c) => import('./commands/learn.js').then((m) => m.cmdSecret(c)),
  metrics: (c) => import('./commands/metrics.js').then((m) => m.cmdMetrics(c)),
  whoami: async (c) => { const { person } = await import('../identity/person.js'); const me = await person(); if (c.mode === 'json') c.out.json({ ok: true, ...me }); else { c.out.line(`${me.id}${me.role ? ` · ${me.role}` : ''}`); } return 0; },
  translate: (c) => import('./commands/translate.js').then((m) => m.cmdTranslate(c)),
  modules: (c) => import('./commands/modules.js').then((m) => m.cmdModules(c)),
  suggest: (c) => import('./commands/suggest.js').then((m) => m.cmdSuggest(c)),
  scores: (c) => import('./commands/suggest.js').then((m) => m.cmdScores(c)),
  rate: (c) => import('./commands/suggest.js').then((m) => m.cmdRate(c)),
  usage: (c) => import('./commands/usage.js').then((m) => m.cmdUsage(c)),
  report: (c) => import('./commands/usage.js').then((m) => m.cmdReport(c)),
  feedback: (c) => import('./commands/usage.js').then((m) => m.cmdFeedback(c)),
  settings: (c) => (c.args.positionals[0] === 'raw' || flagBool(c.args, 'defaults') ? legacy.cmdConfig(c.args, c.out, c.mode) : cmdSettings(c)),
  doctor: cmdDoctor,
  maintain: cmdMaintain,
  skillify: cmdSkillify,
  update: cmdUpdate,
  explain: cmdExplain,
  glossary: cmdGlossary,
  profile: cmdProfile,
  context: cmdContext,
  completion: cmdCompletion,
  __complete: cmdComplete,
  help: cmdHelp,
  version: async (c) => { const v = await productVersion(); if (c.mode === 'json') c.out.json({ ok: true, version: v }); else c.out.line(v); return 0; },
  setup: wrap(legacy.cmdSetup),
  config: wrap(legacy.cmdConfig),
  style: wrap(legacy.cmdStyle),
  ingest: wrap(legacy.cmdIngest),
  revise: wrap(legacy.cmdRevise),
  combine: wrap(legacy.cmdCombine),
  template: wrap(legacy.cmdTemplate),
  concepts: wrap(legacy.cmdConcepts),
  links: wrap(legacy.cmdLinks),
  nav: wrap(legacy.cmdNav),
  migrate: wrap(legacy.cmdMigrate),
  route: wrap(legacy.cmdRoute),
};

export function dispatch(name: string): Handler | undefined {
  if (HANDLERS[name]) return HANDLERS[name];
  const info = findCommand(name);
  return info ? HANDLERS[info.name] : undefined;
}

/** What answers on a port: an OKB web app (and whether it runs this build), or nothing of ours. */
async function okbOn(port: number): Promise<{ build: string | null; token: string; canStop: boolean } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/session`, { signal: AbortSignal.timeout(1500) });
    const body = (await r.json()) as { token?: unknown; version?: unknown; build?: unknown; canStop?: unknown };
    if (!r.ok || typeof body.token !== 'string' || typeof body.version !== 'string') return null;
    return { build: typeof body.build === 'string' ? body.build : null, token: body.token, canStop: body.canStop === true };
  } catch {
    return null;
  }
}

/** Ask an older OKB web app to stop, then wait until its port is free. */
async function stopOld(port: number, token: string): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OKB-Token': token }, body: '{}', signal: AbortSignal.timeout(2000) });
  } catch { /* it may close before answering */ }
  for (let i = 0; i < 20; i++) {
    if (!(await okbOn(port))) return true;
    await new Promise((done) => setTimeout(done, 150));
  }
  return false;
}

/** `okb serve` — the local web app, opened in the browser. */
async function cmdServe(ctx: Ctx): Promise<number> {
  // Before the first KB exists, the web app opens on its setup wizard.
  const config = await effective(ctx.args).then((r) => r.config, (e: unknown) => {
    if (e instanceof OkbError && e.key === 'noKbYet') return null;
    throw e;
  });
  const { serve } = await import('../web/serve.js');
  const { buildStamp } = await import('../web/server.js');
  const asked = flagNumber(ctx.args, 'port');
  const open = flagBool(ctx.args, 'open', ctx.mode === 'text') && !process.env.CI;
  const mine = buildStamp();
  let started: Awaited<ReturnType<typeof serve>> | null = null;
  let skipped: number | null = null;
  let replaced: number | null = null;
  let stale: number | null = null;
  // The default port: if this OKB already runs there, open it; an older OKB is
  // replaced (or left aside when it cannot be stopped); another program is skipped.
  for (let port = asked ?? 4317; !started; port++) {
    try {
      started = await serve(config, { port });
    } catch (e) {
      if (!(e instanceof OkbError && e.key === 'portInUse') || asked !== undefined || port >= 4326) throw e;
      const running = await okbOn(port);
      if (running && running.build === mine) {
        const url = `http://127.0.0.1:${port}`;
        if (ctx.mode === 'json') ctx.out.json({ ok: true, url, alreadyRunning: true });
        else ctx.out.ok(t('serve.already', { url: paint.bold(url) }));
        if (open) await openExternal(url);
        return 0;
      }
      if (running && running.canStop && (await stopOld(port, running.token))) {
        replaced = port;
        port--; // take its port
        continue;
      }
      if (running) stale ??= port;
      else skipped ??= port;
    }
  }
  const { server, url } = started;
  if (ctx.mode === 'text') {
    if (replaced !== null) ctx.out.info(t('serve.replaced', { port: replaced }));
    if (stale !== null) ctx.out.warn(t('serve.staleOther', { port: stale, next: new URL(url).port }));
    if (skipped !== null) ctx.out.info(t('serve.otherPort', { port: skipped, next: new URL(url).port }));
  }
  if (ctx.mode === 'json') ctx.out.json({ ok: true, url, profile: config?.profile.id ?? null, ...(replaced !== null ? { replaced } : {}), ...(stale !== null ? { staleOn: stale } : {}) });
  else {
    ctx.out.ok(t('serve.ready', { url: paint.bold(url) }));
    ctx.out.line(paint.dim(`  ${t('serve.stop')}`));
  }
  if (open) await openExternal(url);
  await new Promise<void>((done) => {
    const stop = () => { server.closeAllConnections(); server.close(() => done()); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    server.once('close', () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); done(); });
  });
  return 0;
}

const SHORT: Record<string, string> = { '-v': '--verbose', '-q': '--quiet', '-y': '--yes', '-h': '--help', '-V': '--version', '-k': '--kb' };

/** Short flags, and `okb --json` meaning the home screen. */
export function normalizeArgv(argv: readonly string[]): string[] {
  const out = argv.map((a) => SHORT[a] ?? a);
  if (!out.length) return ['home'];
  if (out[0] === '--help') return ['help', ...out.slice(1)];
  if (out[0] === '--version') return ['version'];
  if (out[0]!.startsWith('-')) return ['home', ...out];
  return out;
}

/** Warn once when the Claude plugin and this engine are not the same version. */
async function versionCheck(out: Output): Promise<void> {
  const plugin = process.env.OKB_PLUGIN_VERSION;
  if (!plugin || !out.isText) return;
  const engine = await productVersion();
  if (engine !== 'unknown' && plugin !== engine) out.later(t('version.mismatch', { plugin, engine }));
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(normalizeArgv(argv));
  const langFlag = flagString(args, 'lang');
  if (langFlag === 'fr' || langFlag === 'en') setLanguage(langFlag as Lang);
  const mode: OutputMode = flagBool(args, 'json') ? 'json' : 'text';
  if (mode === 'json' || flagBool(args, 'yes')) disableInteraction();
  if (mode === 'json') setColor(false);
  setVerbosity(flagBool(args, 'quiet') ? 'quiet' : flagBool(args, 'verbose') ? 'verbose' : 'normal');
  const out = new Output(mode);
  const ctx: Ctx = { args, out, mode };
  const started = Date.now();
  const log = (ok: boolean, code?: string) => logEvent(args, ok, code, Date.now() - started);
  try {
    await versionCheck(out);
    if (flagBool(args, 'help') && args.command !== 'help' && args.command !== 'home') return commandHelp(ctx, args.command);
    const handler = dispatch(args.command);
    if (!handler) {
      const near = suggest(args.command);
      throw new OkbError('E_INVALID', `unknown command "${args.command}"`, {
        key: near.length ? 'unknownCommandNear' : 'unknownCommand',
        params: { name: args.command, names: near.map((n) => `okb ${n}`).join(', ') },
        hint: 'okb help',
      });
    }
    const code = await handler(ctx);
    out.flush();
    await log(code === 0);
    return code;
  } catch (error) {
    out.flush();
    await log(false, error instanceof OkbError ? error.code : 'E_INTERNAL');
    return reportError(error, mode);
  }
}

/** One line per command in the usage log: never its arguments, which can be private. */
async function logEvent(args: ReturnType<typeof parseArgs>, ok: boolean, code: string | undefined, ms: number): Promise<void> {
  // A web server runs until stopped: its duration says nothing.
  if (args.command === '__complete' || args.command === 'completion' || findCommand(args.command)?.name === 'serve') return;
  const info = findCommand(args.command);
  const first = args.positionals[0];
  const sub = info?.subcommands?.includes(first ?? '') ? first : undefined;
  const kb = flagString(args, 'kb') ?? flagString(args, 'profile');
  const { recordEvent, invokedBy } = await import('../usage/events.js');
  await recordEvent({ at: new Date().toISOString(), command: info?.name ?? args.command, ...(sub ? { sub } : {}), ok, ...(code ? { code } : {}), ms, ...(kb ? { kb } : {}), by: invokedBy() });
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
