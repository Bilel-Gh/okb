import type { OkbConfig } from '../config/schema.js';
import { installClaudeModule } from '../integrations/system.js';
import { moduleDef, setModule, type ModuleId } from '../modules/catalog.js';
import { OkbError } from '../util/errors.js';

/**
 * The web app's routes added after 1.0: modules, the knowledge level of
 * repositories, concepts and translation. Reading, except the person's own
 * acts (a module turned on or installed, a translation they ask for).
 */
type Q = URLSearchParams;
type B = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { env: NodeJS.ProcessEnv } & Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KbConfig = (ctx: any, kb: unknown) => Promise<OkbConfig>;

function moduleId(v: unknown): ModuleId {
  if (typeof v !== 'string' || !moduleDef(v)) throw new OkbError('E_INVALID', 'unknown module', { key: 'moduleUnknown', params: { id: String(v ?? '') } });
  return v as ModuleId;
}

export function nextRoutes(kbConfig: KbConfig): Record<string, (ctx: Ctx, q: Q, b: B) => Promise<unknown>> {
  return {
    'GET /api/modules': async (ctx) => {
      const { moduleList } = await import('../cli/commands/modules.js');
      return { modules: await moduleList(ctx.env) };
    },
    'POST /api/modules/toggle': async (ctx, _q, b) => ({ ok: true, enabled: [...(await setModule(moduleId(b.id), b.on === true, ctx.env))].sort() }),
    'POST /api/modules/install': async (_ctx, _q, b) => installClaudeModule(moduleId(b.id)),
    // « Use OKB in Claude Code »: is Claude Code here, and which OKB plugins does it have?
    'GET /api/claude': async (ctx) => {
      const { claudeState, claudeModules } = await import('../integrations/system.js');
      const state = await claudeState();
      return { cli: Boolean(state.cli), marketplace: state.marketplace, plugins: await claudeModules(ctx.env.HOME ?? '') };
    },
    'GET /api/translate/estimate': async (ctx, q) => {
      const config = await kbConfig(ctx, q.get('kb'));
      const { estimateTranslation } = await import('../translate/translate.js');
      const { asBundlePath } = await import('../util/paths.js');
      return estimateTranslation(config, asBundlePath(q.get('path') ?? ''), q.get('lang') ?? '', q.get('scope') === 'full' ? 'full' : 'brief', ctx.env, { confirmSecret: q.get('confirmSecret') === '1' });
    },
    'POST /api/translate': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const { translateNote } = await import('../translate/translate.js');
      const { asBundlePath } = await import('../util/paths.js');
      const { renderMarkdown } = await import('./render.js');
      const path = asBundlePath(String(b.path ?? ''));
      const r = await translateNote(config, path, String(b.lang ?? ''), b.scope === 'full' ? 'full' : 'brief', ctx.env, { confirmSecret: b.confirmSecret === true });
      return { ok: true, ...r, html: await renderMarkdown(r.markdown, path) };
    },
    'POST /api/translate/save': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      const { proposeTranslation } = await import('../translate/translate.js');
      const { asBundlePath } = await import('../util/paths.js');
      const proposal = await proposeTranslation(config, asBundlePath(String(b.path ?? '')), String(b.lang ?? ''));
      return { ok: true, proposalId: proposal.id, target: proposal.changes[0]?.path ?? null };
    },
    'POST /api/repos/link': async (ctx, _q, b) => {
      const config = await kbConfig(ctx, b.kb);
      if (typeof b.folder !== 'string' || typeof b.path !== 'string' || !b.path.trim()) throw new OkbError('E_INVALID', 'folder and path are required', { key: 'usage', params: { usage: '{ folder, path }' } });
      const { linkBrainRepo } = await import('../knowledge/brain-repos.js');
      const { expandHome } = await import('../config/load.js');
      return { ok: true, repo: await linkBrainRepo(config, b.folder, expandHome(b.path.trim(), ctx.env), ctx.env) };
    },
  };
}
