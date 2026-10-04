import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

/**
 * `okb tour` (alias `okb demo`): the whole loop on a throwaway KB in a temporary
 * folder — capture, a source becomes a proposal, approve and apply, search,
 * undo, end of session — then everything is deleted. The person's KBs and
 * settings are never read or touched.
 */
export async function cmdTour(ctx: Ctx): Promise<number> {
  const { out } = ctx;
  const live = canAsk(ctx);
  const l = lang();
  const dir = await mkdtemp(resolve(tmpdir(), 'okb-tour-'));
  const env: NodeJS.ProcessEnv = { ...process.env, OKB_HOME: resolve(dir, 'home') };
  const kb = resolve(dir, 'kb');
  const pause = async (q: string) => { if (live && !(await confirm(q, true))) throw new Error('stop'); };
  const say = (title: string, body: string) => (live ? note(body, title) : out.line(`\n${paint.bold(title)}\n${body}`));
  try {
    if (live) intro(t('tour.intro'));
    say(t('tour.s0.title'), t('tour.s0.body'));
    await pause(t('tour.continue'));

    const s = spin(t('tour.preparing'));
    await import('node:fs/promises').then((fs) => fs.mkdir(kb, { recursive: true }));
    await runSetup({ profileId: 'demo', kbRoot: kb, conceptAssist: 'targeted', humanActor: 'human:demo', answerLanguage: l, displayName: 'Demo' }, { env });
    const { config } = await loadConfig({ env, profileId: 'demo' });
    await ensureState(statePaths(config));
    s.done(t('tour.ready'));

    // 1. Capture
    const item = await capture(config, { text: t('tour.captureText'), source: 'okb tour' });
    say(`1 · ${t('tour.s1.title')}`, `${t('tour.s1.body')}\n\n  📥 ${item.title}\n\n${paint.dim(`okb capture "…"  ·  okb inbox (${(await listInbox(config)).length})`)}`);
    await pause(t('tour.continue'));

    // 2. A source becomes a proposal
    const source = resolve(dir, 'atelier.md');
    await writeFile(source, SOURCE[l]);
    const doc = await extractSource(await acquire(source, config), config);
    const report = await prepareProposal(config, [doc], { target: { mode: 'create', path: asBundlePath('guides/capture.md'), title: t('tour.noteTitle') } });
    await saveProposal(config, report.proposal);
    const sum = summarize(report.proposal, 1);
    say(`2 · ${t('tour.s2.title')}`, `${t('tour.s2.body')}\n\n  ⏳ #1 ${sum.title} · ${sum.files} ${t('tour.files')}\n\n${paint.dim('okb review 1')}`);
    await pause(t('tour.s2.q'));

    // 3. Approve and apply
    await grantApproval(config, report.proposal, report.proposal.changes.map((c) => c.id), 'human:demo');
    const receipt = await applyProposal(config, report.proposal);
    say(`3 · ${t('tour.s3.title')}`, `${t('tour.s3.body')}\n\n  ✔ ${receipt.results.length} ${t('tour.files')} → ${paint.dim(kb)}`);
    await pause(t('tour.continue'));

    // 4. Search
    const found = await ask(config, l === 'fr' ? 'inbox' : 'inbox', { limit: 3 });
    const quote = found.evidence[0]?.quote.replace(/\s+/g, ' ').slice(0, 120) ?? '';
    say(`4 · ${t('tour.s4.title')}`, `${t('tour.s4.body')}\n\n  🔎 okb ask "inbox"\n  ${found.hits[0]?.title ?? '—'}\n  │ ${quote}`);
    await pause(t('tour.continue'));

    // 5. Undo
    const restored = await rollback(config, receipt.id);
    say(`5 · ${t('tour.s5.title')}`, `${t('tour.s5.body')}\n\n  ↩ okb undo → ${restored.length} ${t('tour.files')}`);
    await pause(t('tour.continue'));

    // 6. End of session
    await recordSession(config, { summary: t('tour.sessionSummary'), next: t('tour.sessionNext') });
    say(`6 · ${t('tour.s6.title')}`, `${t('tour.s6.body')}\n\n  📓 ${t('tour.sessionNext')}`);

    if (live) outro(t('tour.outro'));
    else out.line(`\n${t('tour.outro')}`);
    return 0;
  } catch (e) {
    if ((e as Error).message === 'stop') { if (live) outro(t('tour.stopped')); return 0; }
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (!live && ctx.mode === 'text') out.line(paint.dim(t('tour.cleaned')));
  }
}
