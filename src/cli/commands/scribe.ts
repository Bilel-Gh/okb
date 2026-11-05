import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { t } from '../../i18n/index.js';
import { readLedger, scribeSettings, today } from '../../scribe/ledger.js';
import { resumeSession, scribeSession, skipSession, sweep, type Outcome } from '../../work/scribe.js';
import { findTranscript, listTranscripts, readTranscript } from '../../scribe/transcript.js';
import { writeSetting } from '../../settings/settings.js';
import { invokedBy } from '../../usage/events.js';
import { OkbError } from '../../util/errors.js';
import { flagBool, flagNumber, flagString } from '../args.js';
import { paint } from '../ui/term.js';
import type { Ctx } from './common.js';

/**
 * `okb scribe` — OKB's scribe (D77): it reads the Claude Code conversations
 * once they are over (or by batches while they go on) and keeps the ticket's
 * journal and the notes up to date, without a word during the work.
 *
 *   okb scribe                     where it stands
 *   okb scribe on [--live] | off   the person's switch
 *   okb scribe skip [--session id] never read this conversation (the current one by default)
 *   okb scribe exclude|include <folder>
 *   okb scribe run [--all | --session id | --file f] [--live] [--detach]
 *   okb scribe schedule [--install]  the evening run at 7 pm and the morning catch-up
 */
export async function cmdScribe(ctx: Ctx): Promise<number> {
  const sub = ctx.args.positionals[0] ?? 'status';
  switch (sub) {
    case 'status': return status(ctx);
    case 'on': case 'live': return setMode(ctx, sub === 'live' || flagBool(ctx.args, 'live') ? 'live' : 'after');
    case 'off': return setMode(ctx, 'off');
    case 'skip': return skip(ctx, true);
    case 'unskip': return skip(ctx, false);
    case 'exclude': case 'include': return exclude(ctx, sub === 'exclude');
    case 'run': return run(ctx);
    case 'schedule': return schedule(ctx);
    default:
      throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, command: 'scribe' }, hint: 'okb help scribe' });
  }
}

function person(ctx: Ctx, what: string): void {
  if (invokedBy() === 'claude') throw new OkbError('E_NOT_APPROVED', `${what} is the person's own choice`, { key: 'settingPersonOnly', params: { key: 'scribe.mode' } });
  void ctx;
}

async function status(ctx: Ctx): Promise<number> {
  const settings = await scribeSettings();
  const ledger = await readLedger();
  const sessions = Object.entries(ledger.sessions).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
  const spent = ledger.spent[today()] ?? 0;
  const counts: Record<string, number> = {};
  for (const [, s] of sessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, ...settings, spentToday: spent, counts, sessions: sessions.slice(0, 30).map(([id, s]) => ({ id, status: s.status, reason: s.reason ?? null, kb: s.kb ?? null, ticket: s.ticket ?? null, tokens: s.tokens, notes: s.proposals.length, updatedAt: s.updatedAt })) });
    return 0;
  }
  ctx.out.line(`✍️  ${paint.bold(t('scribe.title'))}  ${paint.dim(t(`settings.opt.scribe.mode.${settings.mode}`))}`);
  ctx.out.line(paint.dim(`   ${t('scribe.budget', { spent: String(spent), budget: String(settings.budget) })}`));
  if (settings.skip.length) ctx.out.line(paint.dim(`   ${t('scribe.excluded', { folders: settings.skip.join(', ') })}`));
  for (const [id, s] of sessions.slice(0, 10)) ctx.out.line(`   ${id.slice(0, 8)}  ${s.status.padEnd(8)} ${paint.dim([s.ticket ?? '', s.reason ?? '', s.proposals.length ? `${s.proposals.length} note(s)` : ''].filter(Boolean).join(' · '))}`);
  if (settings.mode === 'off') ctx.out.next(['okb scribe on', 'okb scribe on --live']);
  return 0;
}

async function setMode(ctx: Ctx, mode: 'off' | 'after' | 'live'): Promise<number> {
  person(ctx, 'turning the scribe on or off');
  await writeSetting('', 'scribe.mode', mode);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, mode }); return 0; }
  ctx.out.ok(t('scribe.mode', { mode: t(`settings.opt.scribe.mode.${mode}`) }));
  if (mode !== 'off') ctx.out.next(['okb scribe schedule --install']);
  return 0;
}

/** The conversation to act on: named, or the latest one of this folder. */
async function sessionOf(ctx: Ctx): Promise<{ id: string; file: string | null }> {
  const named = flagString(ctx.args, 'session');
  if (named) return { id: named, file: await findTranscript(named) };
  const file = flagString(ctx.args, 'file');
  if (file) return { id: basename(file, '.jsonl'), file: resolve(file) };
  const cwd = resolve(flagString(ctx.args, 'cwd') ?? process.cwd());
  const recent = (await listTranscripts(process.env, Date.now() - 2 * 86_400_000)).reverse();
  for (const t of recent) {
    const head = await readTranscript(t.file, Math.max(0, t.size - 200_000)).catch(() => null);
    if (head?.cwd && resolve(head.cwd) === cwd) return { id: t.session, file: t.file };
  }
  throw new OkbError('E_NOT_FOUND', 'no conversation of this folder in the last two days', { key: 'scribeNoSession', hint: 'okb scribe skip --session <id>' });
}

async function skip(ctx: Ctx, off: boolean): Promise<number> {
  const { id } = await sessionOf(ctx);
  if (off) await skipSession(id); else await resumeSession(id);
  if (ctx.mode === 'json') ctx.out.json({ ok: true, session: id, skipped: off });
  else ctx.out.ok(t(off ? 'scribe.skipped' : 'scribe.unskipped', { session: id.slice(0, 8) }));
  return 0;
}

async function exclude(ctx: Ctx, add: boolean): Promise<number> {
  person(ctx, 'choosing the folders the scribe reads');
  const folder = resolve(ctx.args.positionals[1] ?? process.cwd());
  const { skip } = await scribeSettings();
  const next = add ? [...new Set([...skip, folder])] : skip.filter((f) => resolve(f) !== folder);
  await writeSetting('', 'scribe.skip', next);
  if (ctx.mode === 'json') ctx.out.json({ ok: true, skip: next });
  else ctx.out.ok(t(add ? 'scribe.excludedOne' : 'scribe.includedOne', { folder }));
  return 0;
}

async function run(ctx: Ctx): Promise<number> {
  // From a hook: answer at once, the work goes on in its own process.
  if (flagBool(ctx.args, 'detach')) {
    const args = process.argv.slice(2).filter((a) => a !== '--detach');
    const child = spawn(process.execPath, [process.argv[1]!, ...args], { detached: true, stdio: 'ignore', env: { ...process.env, OKB_HEADLESS: '1' } });
    child.unref();
    if (ctx.mode === 'json') ctx.out.json({ ok: true, detached: true });
    return 0;
  }
  let outcomes: Outcome[];
  if (flagBool(ctx.args, 'all')) {
    const share = flagNumber(ctx.args, 'share') ?? (new Date().getHours() < 12 ? 0.5 : 1);
    outcomes = await sweep({ share, ...(flagNumber(ctx.args, 'quiet-minutes') !== undefined ? { quietMinutes: flagNumber(ctx.args, 'quiet-minutes')! } : {}) });
  } else {
    const { id, file } = await sessionOf(ctx);
    if (!file) throw new OkbError('E_NOT_FOUND', `no transcript for ${id}`, { key: 'scribeNoSession', hint: 'okb scribe' });
    outcomes = [await scribeSession(file, { pass: flagBool(ctx.args, 'live') ? 'live' : 'after' })];
  }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, outcomes }); return 0; }
  if (!outcomes.length) ctx.out.info(t('scribe.nothing'));
  for (const o of outcomes) {
    ctx.out.line(`${o.session.slice(0, 8)}  ${o.status}  ${paint.dim([o.ticket ?? '', o.reason, o.journal ? `${o.journal} ligne(s) au journal` : '', ...o.notes.map((n) => `${n.result}: ${n.title}`)].filter(Boolean).join(' · '))}`);
  }
  return 0;
}

const LABEL = 'com.okb.scribe';

/** The evening run at 7 pm, and at login a catch-up that keeps half the day's budget. */
async function schedule(ctx: Ctx): Promise<number> {
  const okb = process.argv[1]!;
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `  <key>Label</key><string>${LABEL}</string>`,
    `  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${okb}</string><string>scribe</string><string>run</string><string>--all</string></array>`,
    '  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>19</integer><key>Minute</key><integer>0</integer></dict>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>EnvironmentVariables</key><dict><key>OKB_HEADLESS</key><string>1</string></dict>',
    '</dict></plist>',
    '',
  ].join('\n');
  const cron = `0 19 * * * ${process.execPath} ${okb} scribe run --all\n@reboot ${process.execPath} ${okb} scribe run --all`;
  const mac = process.platform === 'darwin';
  const path = resolve(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (!flagBool(ctx.args, 'install')) {
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, installed: false, platform: process.platform, ...(mac ? { path, plist } : { cron }) }); return 0; }
    ctx.out.line(t('scribe.schedulePlan'));
    ctx.out.line(paint.dim(mac ? path : 'crontab -e'));
    ctx.out.line(mac ? plist : cron);
    if (mac) ctx.out.next(['okb scribe schedule --install']);
    return 0;
  }
  person(ctx, 'scheduling the scribe');
  if (!mac) throw new OkbError('E_UNSUPPORTED', 'only macOS is installed automatically; add the printed lines with crontab -e', { key: 'scribeScheduleManual' });
  await mkdir(resolve(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(path, plist, { mode: 0o644 });
  await new Promise<void>((done) => { const p = spawn('launchctl', ['load', '-w', path], { stdio: 'ignore' }); p.on('close', () => done()); p.on('error', () => done()); });
  if (ctx.mode === 'json') ctx.out.json({ ok: true, installed: true, path });
  else ctx.out.ok(t('scribe.scheduled', { path }));
  return 0;
}
