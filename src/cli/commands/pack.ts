import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { t } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { comparePack, exportPack, mergePack, type Pack } from '../../packs/pack.js';
import { OkbError } from '../../util/errors.js';
import { flagString } from '../args.js';
import { paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

/**
 * `okb pack export <folder> [--out file]` · `okb pack compare <file> --into <folder>` ·
 * `okb pack merge <file> --into <folder>` — share a subject's knowledge without a
 * server: a file to hand over, compared with the brain, merged through a proposal.
 */
export async function cmdPack(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  const [sub, arg] = ctx.args.positionals;
  const usage = 'okb pack export <folder> [--out file] | compare <file> --into <folder> | merge <file> --into <folder>';
  if (!sub || !arg) throw new OkbError('E_INVALID', usage, { key: 'usage', params: { usage } });
  if (sub === 'export') {
    const pack = await exportPack(config, await loadBundleFor(config), arg);
    const file = resolve(flagString(ctx.args, 'out') ?? `${arg.split('/').pop()}.okbpack.json`);
    await writeFile(file, `${JSON.stringify(pack, null, 1)}\n`);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, file, notes: pack.notes.length, skipped: pack.skipped }); return 0; }
    ctx.out.ok(t('pack.exported', { n: pack.notes.length, file }));
    if (pack.skipped.length) ctx.out.line(paint.dim(t('pack.skipped', { n: pack.skipped.length })));
    return 0;
  }
  const pack = JSON.parse(await readFile(resolve(arg), 'utf8').catch(() => { throw new OkbError('E_NOT_FOUND', `no file ${arg}`, { key: 'packInvalid' }); })) as Pack;
  const into = flagString(ctx.args, 'into') ?? (pack as { subject?: string }).subject ?? '';
  if (sub === 'compare') {
    const diff = comparePack(await loadBundleFor(config), pack, into);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, into, added: diff.added.map((n) => n.path), changed: diff.changed.map((n) => n.path), same: diff.same }); return 0; }
    ctx.out.line(t('pack.compare', { added: diff.added.length, changed: diff.changed.length, same: diff.same, from: pack.from?.brain ?? '?' }));
    for (const n of diff.added) ctx.out.line(`  + ${n.path}`);
    for (const n of diff.changed) ctx.out.line(paint.dim(`  ~ ${n.path}`));
    if (diff.added.length) ctx.out.tip(t('pack.mergeTip', { file: arg, into }));
    return 0;
  }
  if (sub === 'merge') {
    const proposal = await mergePack(config, pack, into);
    if (ctx.mode === 'json') { ctx.out.json({ ok: true, proposalId: proposal.id, notes: proposal.changes.length }); return 0; }
    ctx.out.ok(t('pack.merged', { id: proposal.id, n: proposal.changes.length }));
    ctx.out.next([`okb review ${proposal.id}`]);
    return 0;
  }
  throw new OkbError('E_INVALID', usage, { key: 'usage', params: { usage } });
}
