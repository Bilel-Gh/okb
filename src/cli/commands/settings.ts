import { languageName, t, has } from '../../i18n/index.js';
import { readSettings, SETTINGS, writeSetting, type SettingDef, type SettingGroup, type SettingValue } from '../../settings/settings.js';
import { OkbError } from '../../util/errors.js';
import { flagBool } from '../args.js';
import { choose, confirm, input } from '../ui/prompt.js';
import { fieldList, paint, sym } from '../ui/term.js';
import { canAsk, effective, type Ctx } from './common.js';

const GROUPS: readonly SettingGroup[] = ['language', 'writing', 'help', 'memory', 'history', 'assistant', 'advanced'];

/** A value as a person reads it: "Français", "Oui", "Pédagogique". */
export function displayValue(def: SettingDef, value: unknown): string {
  if (def.type === 'bool') return value ? t('ui.yes') : t('ui.no');
  if (def.type === 'list') return (value as string[]).length ? (value as string[]).join(', ') : t('settings.none');
  if (def.key === 'writing.language') return languageName(String(value));
  if (def.key === 'ui.language') return value === 'auto' ? t('wiz.lang.auto') : languageName(String(value));
  const optKey = `settings.opt.${def.key}.${String(value)}`;
  if (def.type === 'choice' && has(optKey)) return t(optKey);
  return String(value) || t('settings.none');
}

/** The same value, coloured: yes in green, no dimmed, paths in cyan, names in bold. */
function coloredValue(def: SettingDef, value: unknown): string {
  const text = displayValue(def, value);
  if (def.type === 'bool') return value ? paint.ok(text) : paint.dim(text);
  if (def.key === 'focus.file' || def.key === 'focus.journal') return value ? paint.path(String(value)) : paint.dim(text);
  if (def.key === 'profile.displayName') return paint.name(text);
  if (def.type === 'list' && !(value as string[]).length) return paint.dim(text);
  return paint.bold(text);
}

async function editOne(id: string, sv: SettingValue): Promise<unknown> {
  const { def } = sv;
  const label = t(`settings.label.${def.key}`);
  if (def.type === 'bool') return confirm(label, Boolean(sv.value));
  if (def.type === 'choice') {
    return choose(label, (def.options ?? []).map((o) => ({
      value: o,
      label: displayValue(def, o),
      ...(has(`settings.hint.${def.key}.${o}`) ? { hint: t(`settings.hint.${def.key}.${o}`) } : {}),
      recommended: def.recommended === o,
    })), String(sv.value));
  }
  const raw = await input(label, { initial: Array.isArray(sv.value) ? sv.value.join(', ') : String(sv.value ?? ''), ...(def.type === 'list' ? { placeholder: t('settings.listPlaceholder') } : {}) });
  void id;
  return raw;
}

/** `okb settings` — show, change one (`set key=value`) or walk a menu. */
export async function cmdSettings(ctx: Ctx): Promise<number> {
  const { args, out } = ctx;
  const { config } = await effective(args);
  const id = config.profile.id;
  const sub = args.positionals[0] ?? (canAsk(ctx) ? 'menu' : 'show');

  if (sub === 'show' || sub === 'list') {
    const values = await readSettings(id);
    if (ctx.mode === 'json') { out.json({ ok: true, kb: id, settings: values.map((v) => ({ key: v.def.key, value: v.value, default: v.isDefault, scope: v.def.scope })) }); return 0; }
    out.line(`${sym.kb()} ${paint.name(config.profile.displayName || id)}  ${paint.dim(t('settings.title'))}`);
    out.line(fieldList(GROUPS.filter((g) => g !== 'advanced' || flagBool(args, 'all')).map((g) => ({
      title: t(`settings.group.${g}`),
      rows: values.filter((v) => v.def.group === g).map((v) => [t(`settings.label.${v.def.key}`), coloredValue(v.def, v.value) + (v.isDefault ? paint.dim(` · ${t('settings.default')}`) : ''), v.def.key] as const),
    }))));
    out.next([`okb settings set <${t('settings.key')}>=<${t('settings.value')}>`, ...(flagBool(args, 'all') ? [] : ['okb settings show --all'])]);
    return 0;
  }

  // `okb settings profile beginner-visual|balanced|expert-concise`: four reading settings in one go.
  if (sub === 'profile') {
    const { applyReadingProfile, READING_PROFILES } = await import('../../settings/settings.js');
    const name = args.positionals[1] as keyof typeof READING_PROFILES | undefined;
    if (!name || !(name in READING_PROFILES)) throw new OkbError('E_INVALID', `okb settings profile ${Object.keys(READING_PROFILES).join('|')}`, { key: 'usage', params: { usage: `okb settings profile ${Object.keys(READING_PROFILES).join('|')}` } });
    const values = await applyReadingProfile(id, name);
    if (ctx.mode === 'json') out.json({ ok: true, profile: name, values });
    else out.ok(t('settings.profileApplied', { profile: name, values: Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ') }));
    return 0;
  }

  if (sub === 'set') {
    let pairs = args.positionals.slice(1);
    // `okb settings set key value` reads like a sentence: accept it for a single setting.
    if (pairs.length === 2 && !pairs[0]!.includes('=') && !pairs[1]!.includes('=')) pairs = [`${pairs[0]}=${pairs[1]}`];
    if (!pairs.length) throw new OkbError('E_INVALID', 'usage: okb settings set key=value', { key: 'usage', params: { usage: 'okb settings set <key>=<value>' } });
    const changed: { key: string; value: unknown }[] = [];
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq < 1) throw new OkbError('E_INVALID', `expected key=value, got "${pair}"`, { key: 'settingPair', params: { pair } });
      const key = pair.slice(0, eq);
      changed.push({ key, value: await writeSetting(id, key, pair.slice(eq + 1)) });
    }
    if (ctx.mode === 'json') { out.json({ ok: true, kb: id, changed }); return 0; }
    for (const c of changed) out.ok(t('settings.changed', { label: t(`settings.label.${c.key}`), value: displayValue(SETTINGS.find((s) => s.key === c.key)!, c.value) }));
    return 0;
  }

  if (sub !== 'menu') throw new OkbError('E_INVALID', `unknown subcommand "${sub}"`, { key: 'unknownSub', params: { sub, usage: 'okb settings [show|set key=value]' } });
  for (;;) {
    const group = await choose(t('settings.menu.q', { name: config.profile.displayName || id }), [
      ...GROUPS.map((g) => ({ value: g as string, label: t(`settings.group.${g}`), hint: t(`settings.groupHint.${g}`) })),
      { value: 'done', label: t('ui.done') },
    ]);
    if (group === 'done') return 0;
    const values = (await readSettings(id)).filter((v) => v.def.group === group);
    const key = await choose(t(`settings.group.${group}`), [
      ...values.map((v) => ({ value: v.def.key, label: t(`settings.label.${v.def.key}`), hint: displayValue(v.def, v.value) })),
      { value: 'back', label: t('ui.back') },
    ]);
    if (key === 'back') continue;
    const sv = values.find((v) => v.def.key === key)!;
    if (has(`settings.explain.${key}`)) out.line(paint.dim(`  ${t(`settings.explain.${key}`)}`));
    const value = await writeSetting(id, key, await editOne(id, sv));
    out.ok(t('settings.changed', { label: t(`settings.label.${key}`), value: displayValue(sv.def, value) }));
  }
}
