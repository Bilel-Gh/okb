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

export function nextRoutes(_kbConfig: KbConfig): Record<string, (ctx: Ctx, q: Q, b: B) => Promise<unknown>> {
  return {
    'GET /api/modules': async (ctx) => {
      const { moduleList } = await import('../cli/commands/modules.js');
      return { modules: await moduleList(ctx.env) };
    },
    'POST /api/modules/toggle': async (ctx, _q, b) => ({ ok: true, enabled: [...(await setModule(moduleId(b.id), b.on === true, ctx.env))].sort() }),
    'POST /api/modules/install': async (_ctx, _q, b) => installClaudeModule(moduleId(b.id)),
  };
}
