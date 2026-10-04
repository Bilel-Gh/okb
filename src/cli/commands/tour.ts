import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { applyProposal, rollback } from '../../apply/apply.js';
import { grantApproval } from '../../apply/approval.js';
import { loadConfig } from '../../config/load.js';
import { recordSession } from '../../focus/focus.js';
import { lang, t } from '../../i18n/index.js';
import { capture, listInbox } from '../../inbox/inbox.js';
import { ask } from '../../pipeline/ask.js';
import { prepareProposal } from '../../pipeline/ingest.js';
import { saveProposal } from '../../proposal/store.js';
import { runSetup } from '../../setup/setup.js';
import { acquire, extractSource } from '../../sources/registry.js';
import { ensureState, statePaths } from '../../state/paths.js';
import { summarize } from '../../status/status.js';
import { asBundlePath } from '../../util/paths.js';
import { confirm, intro, note, outro, spin } from '../ui/prompt.js';
import { paint } from '../ui/term.js';
import { canAsk, type Ctx } from './common.js';

const SOURCE: Record<'fr' | 'en', string> = {
  fr: `# Atelier fictif : la capture

La capture consiste à noter une idée au moment où elle arrive, avant de la perdre.

Une inbox est un lieu de passage : chaque capture y attend une décision.

Le tri se fait une fois par jour : garder, classer ou jeter chaque élément.
`,
  en: `# Fictional workshop: capture

Capture means writing an idea down the moment it arrives, before it is lost.

An inbox is a place of transit: every capture waits there for a decision.

Triage happens once a day: keep, file or drop each item.
`,
};

export type TourStep = { readonly n: number; readonly title: string; readonly body: string; readonly detail: string };

/**
 * The whole OKB loop on a throwaway KB in a temporary folder — capture, a source
 * becomes a proposal, approve and apply, search, undo, end of session — then
 * everything is deleted. The person's KBs and settings are never read or touched.
 * `pause` returns false to stop early.
 */
export async function tourScenario(options: { step: (s: TourStep) => void; pause: (question: string) => Promise<boolean> }): Promise<void> {
  const l = lang();
  const dir = await mkdtemp(resolve(tmpdir(), 'okb-tour-'));
  const env: NodeJS.ProcessEnv = { ...process.env, OKB_HOME: resolve(dir, 'home') };
  const kb = resolve(dir, 'kb');
  try {
    options.step({ n: 0, title: t('tour.s0.title'), body: t('tour.s0.body'), detail: '' });
    if (!(await options.pause(t('tour.continue')))) return;
    await mkdir(kb, { recursive: true });
    await runSetup({ profileId: 'demo', kbRoot: kb, conceptAssist: 'targeted', humanActor: 'human:demo', answerLanguage: l, displayName: 'Demo' }, { env });
    const { config } = await loadConfig({ env, profileId: 'demo' });
    await ensureState(statePaths(config));

    const item = await capture(config, { text: t('tour.captureText'), source: 'okb tour' });
    options.step({ n: 1, title: t('tour.s1.title'), body: t('tour.s1.body'), detail: `📥 ${item.title}\nokb capture "…"  ·  okb inbox (${(await listInbox(config)).length})` });
    if (!(await options.pause(t('tour.continue')))) return;

    const source = resolve(dir, 'atelier.md');
    await writeFile(source, SOURCE[l]);
    const doc = await extractSource(await acquire(source, config), config);
    const report = await prepareProposal(config, [doc], { target: { mode: 'create', path: asBundlePath('guides/capture.md'), title: t('tour.noteTitle') } });
    await saveProposal(config, report.proposal);
    const sum = summarize(report.proposal, 1);
    options.step({ n: 2, title: t('tour.s2.title'), body: t('tour.s2.body'), detail: `⏳ #1 ${sum.title} · ${sum.files} ${t('tour.files')}\nokb review 1` });
    if (!(await options.pause(t('tour.s2.q')))) return;

    await grantApproval(config, report.proposal, report.proposal.changes.map((c) => c.id), 'human:demo');
    const receipt = await applyProposal(config, report.proposal);
    options.step({ n: 3, title: t('tour.s3.title'), body: t('tour.s3.body'), detail: `✔ ${receipt.results.length} ${t('tour.files')}` });
    if (!(await options.pause(t('tour.continue')))) return;

    const found = await ask(config, 'inbox', { limit: 3 });
    const quote = found.evidence[0]?.quote.replace(/\s+/g, ' ').slice(0, 120) ?? '';
    options.step({ n: 4, title: t('tour.s4.title'), body: t('tour.s4.body'), detail: `🔎 okb ask "inbox"\n${found.hits[0]?.title ?? '—'}\n│ ${quote}` });
    if (!(await options.pause(t('tour.continue')))) return;

    const restored = await rollback(config, receipt.id);
    options.step({ n: 5, title: t('tour.s5.title'), body: t('tour.s5.body'), detail: `↩ okb undo → ${restored.length} ${t('tour.files')}` });
    if (!(await options.pause(t('tour.continue')))) return;

    await recordSession(config, { summary: t('tour.sessionSummary'), next: t('tour.sessionNext') });
    options.step({ n: 6, title: t('tour.s6.title'), body: t('tour.s6.body'), detail: `📓 ${t('tour.sessionNext')}` });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `okb tour` (alias `okb demo`). */
export async function cmdTour(ctx: Ctx): Promise<number> {
  const { out } = ctx;
  const live = canAsk(ctx);
  let stopped = false;
  if (live) intro(t('tour.intro'));
  const s = live ? spin(t('tour.preparing')) : null;
  s?.done(t('tour.ready'));
  await tourScenario({
    step: (st) => {
      const title = st.n ? `${st.n} · ${st.title}` : st.title;
      const body = st.detail ? `${st.body}\n\n${st.detail}` : st.body;
      if (live) note(body, title);
      else out.line(`\n${paint.bold(title)}\n${body}`);
    },
    pause: async (q) => {
      if (!live) return true;
      const go = await confirm(q, true);
      if (!go) stopped = true;
      return go;
    },
  });
  if (live) outro(stopped ? t('tour.stopped') : t('tour.outro'));
  else out.line(`\n${t('tour.outro')}\n${paint.dim(t('tour.cleaned'))}`);
  return 0;
}
