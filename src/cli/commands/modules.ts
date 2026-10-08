import { lang, t } from '../../i18n/index.js';
import { claudeModules, installClaudeModule } from '../../integrations/system.js';
import { enabledModules, entitled, MODULES, moduleDef, setModule, type ModuleId } from '../../modules/catalog.js';
import { pick } from '../../templates/registry.js';
import { OkbError } from '../../util/errors.js';
import { paint } from '../ui/term.js';
import type { Ctx } from './common.js';

/** Every module with its state: enabled here, entitled, and installed in Claude Code. */
export async function moduleList(env: NodeJS.ProcessEnv = process.env) {
  const [on, claude] = await Promise.all([enabledModules(env), claudeModules(env.HOME ?? '')]);
  const l = lang();
  return MODULES.map((m) => ({
    id: m.id, status: m.status, emoji: m.emoji, plugin: m.plugin, profiles: m.profiles, features: m.features, license: m.license,
    name: pick(m.name, l), pitch: pick(m.pitch, l), brings: m.brings.map((b) => pick(b, l)),
    enabled: on.has(m.id), entitled: entitled(m.id),
    claude: m.plugin ? claude[m.plugin] ?? { installed: false, version: null } : null,
  }));
}

/**
 * `okb modules [on|off|install <id>]` — the core and the modules for a job:
 * what each brings, which are on, and which Claude Code has. Turning a module
 * off hides its pages and commands; the notes stay where they are.
 */
export async function cmdModules(ctx: Ctx): Promise<number> {
  const { out } = ctx;
  const [sub, id] = ctx.args.positionals;
  if (sub === 'on' || sub === 'off' || sub === 'install') {
    if (!id || !moduleDef(id)) throw new OkbError('E_INVALID', `unknown module "${id ?? ''}"`, { key: 'moduleUnknown', params: { id: id ?? '' }, hint: 'okb modules' });
    if (sub === 'install') {
      const r = await installClaudeModule(id);
      if (ctx.mode === 'json') { out.json({ ...r }); return r.ok ? 0 : 1; }
      for (const s of r.steps) out.line(paint.dim(`  ${s}`));
      if (r.ok) { out.ok(t('modules.installed', { id })); out.tip(t('modules.restart')); } else out.fail(t('modules.installFailed', { error: r.error ?? '' }));
      return r.ok ? 0 : 1;
    }
    const on = await setModule(id as ModuleId, sub === 'on');
    if (ctx.mode === 'json') { out.json({ ok: true, enabled: [...on].sort() }); return 0; }
    out.ok(t(sub === 'on' ? 'modules.on' : 'modules.off', { id }));
    return 0;
  }
  const list = await moduleList();
  if (ctx.mode === 'json') { out.json({ ok: true, modules: list }); return 0; }
  for (const m of list) {
    const state = m.status === 'planned' ? paint.dim(t('modules.planned')) : m.enabled ? paint.ok(t('modules.enabled')) : paint.dim(t('modules.disabled'));
    const claude = m.claude ? (m.claude.installed ? t('modules.claudeYes', { version: m.claude.version ?? '?' }) : t('modules.claudeNo')) : '';
    out.line(`${m.emoji} ${paint.bold(m.name)}  ${state}${claude ? paint.dim(`  · ${claude}`) : ''}`);
    out.line(`   ${m.pitch}`);
  }
  out.tip(t('modules.tip'));
  return 0;
}
