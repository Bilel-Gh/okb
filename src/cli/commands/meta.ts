import { resolve } from 'node:path';
import { t } from '../../i18n/index.js';
import { OkbError } from '../../util/errors.js';
import { readMetaWorkspace, type MetaWorkspace } from '../../work/meta-repos.js';
import { flagString } from '../args.js';
import { paint } from '../ui/term.js';
import type { Ctx } from './common.js';

/**
 * `okb meta [<folder>] [--meta <name>]` (chantier 3): the team's map, read from
 * its meta-repositories. Read only: nothing is written in the workspace.
 */
export async function cmdMeta(ctx: Ctx): Promise<number> {
  const path = resolve(ctx.args.positionals[0] ?? process.cwd());
  const meta = flagString(ctx.args, 'meta');
  // No KB needed to read the map: the workspace's own folders are enough.
  const found = await readMetaWorkspace(path);
  if (!found.metaRepos.length) throw new OkbError('E_NOT_FOUND', `no meta-repository in ${path}`, { key: 'metaNone', params: { path } });
  const map: MetaWorkspace = meta ? { ...found, metaRepos: found.metaRepos.filter((m) => m.name === meta) } : found;
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, ...map }); return 0; }
  ctx.out.line(`🗂️  ${paint.bold(t('meta.title'))}  ${paint.dim(map.root)}`);
  if (map.knowledge.length) ctx.out.line(paint.dim(`   ${t('meta.knowledge', { n: String(map.knowledge.length) })}`));
  for (const m of map.metaRepos) {
    ctx.out.line('');
    ctx.out.line(`${paint.bold(m.name)}  ${paint.dim(t('meta.counts', { repos: String(m.repos.length), deps: String(m.dependencies.length) }))}`);
    ctx.out.line(`   ${t('meta.repos')} ${m.repos.map((r) => (r.present ? r.name : `${r.name}${paint.dim('°')}`)).join(', ') || '-'}`);
    if (m.dependencies.length) ctx.out.line(`   ${t('meta.deps')} ${paint.dim(m.dependencies.map((r) => r.name).join(', '))}`);
    if (m.owners.length) ctx.out.line(`   ${t('meta.owners')} ${[...new Set(m.owners.map((o) => o.who))].slice(0, 8).join(', ')}`);
    if (m.pipelines.length) ctx.out.line(`   ${t('meta.pipelines')} ${m.pipelines.map((p) => `${p.name} (${p.kind})`).join(', ')}`);
    ctx.out.line(paint.dim(`   ${t('meta.docs', { docs: String(m.docs.length), kt: String(m.kt.length), terms: String(m.glossary.length), skills: String(m.skills.length) })}`));
  }
  return 0;
}
