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

/** `okb serve` — the local web app, opened in the browser. */
async function cmdServe(ctx: Ctx): Promise<number> {
  // Before the first KB exists, the web app opens on its setup wizard.
  const config = await effective(ctx.args).then((r) => r.config, (e: unknown) => {
    if (e instanceof OkbError && e.key === 'noKbYet') return null;
    throw e;
  });
  const { serve } = await import('../web/serve.js');
  const { server, url } = await serve(config, { port: flagNumber(ctx.args, 'port') });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, url, profile: config?.profile.id ?? null });
  else {
    ctx.out.ok(t('serve.ready', { url: paint.bold(url) }));
    ctx.out.line(paint.dim(`  ${t('serve.stop')}`));
  }
  if (flagBool(ctx.args, 'open', ctx.mode === 'text') && !process.env.CI) await openExternal(url);
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
    return code;
  } catch (error) {
    out.flush();
    return reportError(error, mode);
  }
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
