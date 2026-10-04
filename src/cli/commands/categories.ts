import { proposeCategory } from '../../categories/assign.js';
import { loadCategories, templateCategories } from '../../categories/categories.js';
import { saveProposal } from '../../proposal/store.js';
import { OkbError } from '../../util/errors.js';
import { t, tn } from '../../i18n/index.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { buildGraph } from '../../kb/graph.js';
import { loadTemplates, pick } from '../../templates/registry.js';
import { columns, paint } from '../ui/term.js';
import { effective, type Ctx } from './common.js';

/**
 * `okb categories` — the kinds of notes in the KB: how many of each, with
 * their colour, the templates that produce them, and the notes left without one.
 */
export async function cmdCategories(ctx: Ctx): Promise<number> {
  const { config } = await effective(ctx.args);
  if (ctx.args.positionals[0] === 'set') {
    const [, note, category] = ctx.args.positionals;
    if (!note || !category) throw new OkbError('E_INVALID', 'usage: okb categories set <note.md> <category|auto>', { key: 'usage', params: { usage: 'okb categories set <note.md> <category|auto>' } });
    const proposal = await proposeCategory(config, note, category);
    await saveProposal(config, proposal);
    if (ctx.mode === 'json') ctx.out.json({ ok: true, proposalId: proposal.id });
    else { ctx.out.ok(t('categories.proposed', { path: paint.code(note) })); ctx.out.next([`okb review ${proposal.id}`]); }
    return 0;
  }
  const [bundle, categories, templates] = await Promise.all([loadBundleFor(config), loadCategories(config), loadTemplates(config)]);
  const graph = buildGraph(bundle, categories, templates);
  const byTemplate = templateCategories(templates);
  const lang = config.writing.language ?? config.profile.answer.language;
  const templatesOf = (id: string) => templates.filter((tp) => (byTemplate.get(tp.id) ?? categories.find((c) => c.templates.includes(tp.id))?.id) === id).map((tp) => tp.id);
  const uncategorized = graph.nodes.filter((n) => n.category === 'other');
  if (ctx.mode === 'json') {
    ctx.out.json({ ok: true, categories: graph.categories.map((c) => ({ ...c, templates: templatesOf(c.id) })), uncategorized: uncategorized.map((n) => n.id), links: graph.edges.length });
    return 0;
  }
  const total = graph.nodes.length;
  ctx.out.line(paint.bold(t('categories.title', { kb: config.profile.displayName || config.profile.id })) + paint.dim(`  ${tn('categories.total', total)} · ${tn('categories.links', graph.edges.length)}`));
  if (total) {
    const width = Math.min(60, columns() - 6);
    const used = graph.categories.filter((c) => c.count);
    let bar = '';
    let drawn = 0;
    used.forEach((c, i) => {
      const n = i === used.length - 1 ? width - drawn : Math.max(1, Math.round((c.count / total) * width));
      drawn += n;
      bar += paint.ansi(c.ansi, '█'.repeat(Math.max(0, n)));
    });
    ctx.out.line(`  ${bar}`);
  }
  ctx.out.line();
  const nameW = Math.max(...graph.categories.map((c) => pick(c.label, lang).length)) + 2;
  for (const c of graph.categories) {
    if (c.id === 'other' && !c.count) continue;
    const name = pick(c.label, lang);
    const tpls = templatesOf(c.id);
    ctx.out.line(`  ${paint.ansi(c.ansi, '●')} ${c.emoji} ${(c.count ? paint.bold : paint.dim)(name.padEnd(nameW))}${String(c.count).padStart(4)}  ${paint.dim(tpls.length ? tpls.join(', ') : '—')}`);
    ctx.out.line(`       ${paint.dim(pick(c.description, lang))}`);
  }
  if (uncategorized.length) {
    ctx.out.line();
    ctx.out.warn(tn('categories.uncategorized', uncategorized.length));
    for (const n of uncategorized.slice(0, 5)) ctx.out.line(`    ${paint.dim('·')} ${n.id}`);
    ctx.out.line(paint.dim(`  ${t('categories.fix')}`));
  }
  ctx.out.next(['okb serve', 'okb template list']);
  return 0;
}
