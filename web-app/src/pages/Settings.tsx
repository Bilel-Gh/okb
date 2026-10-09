import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, FolderPlus, Info, Palette, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import type { Route } from '../app/router';
import { AppearanceChoices, useAppearanceChoices } from '../app/Shell';
import { toast } from '../app/toast';
import { Switch } from '../ui/Choice';
import { PageTabs } from '../ui/PageTabs';
import { ErrorState, SkeletonRows } from '../ui/States';
import { BrainsList, Wizard } from './Brains';

type Setting = { key: string; group: string; type: 'bool' | 'choice' | 'text' | 'number' | 'list'; options?: string[]; value: unknown; isDefault: boolean; scope: 'global' | 'kb' };
const GROUPS = ['language', 'writing', 'help', 'memory', 'history', 'assistant', 'advanced'];

function SettingRow({ s, save }: { s: Setting; save: (s: Setting, v: unknown) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState(Array.isArray(s.value) ? s.value.join(', ') : String(s.value ?? ''));
  const label = t(`settings.label.${s.key}`);
  const opt = (o: string) => {
    if (s.key === 'ui.language' || s.key === 'writing.language') return o === 'auto' ? t('wiz.lang.auto') : t.has(`app.lang.${o}`) ? t(`app.lang.${o}`) : o;
    return t.has(`settings.opt.${s.key}.${o}`) ? t(`settings.opt.${s.key}.${o}`) : o;
  };
  return (
    <div className="setting-row">
      <div className="grow">
        <b>{label}{s.scope === 'global' ? <span className="pill sm" style={{ marginLeft: 8 }}>{t('web.settings.allKbs')}</span> : null}</b>
        {t.has(`settings.explain.${s.key}`) ? <small className="muted">{t(`settings.explain.${s.key}`)}</small> : null}
      </div>
      {s.type === 'bool' ? <Switch on={Boolean(s.value)} onChange={(v) => void save(s, v)} label={label} />
        : s.type === 'choice' ? (
          (s.options ?? []).length <= 4 ? (
            <div className="segmented" role="group" aria-label={label}>{(s.options ?? []).map((o) => <button type="button" key={o} aria-pressed={String(s.value) === o} title={t.has(`settings.hint.${s.key}.${o}`) ? t(`settings.hint.${s.key}.${o}`) : undefined} onClick={() => void save(s, o)}>{opt(o)}</button>)}</div>
          ) : (
            <select className="select sm" style={{ width: 'auto', minWidth: 180 }} value={String(s.value)} aria-label={label} onChange={(e) => void save(s, e.target.value)}>{(s.options ?? []).map((o) => <option key={o} value={o}>{opt(o)}</option>)}</select>
          )
        ) : (
          <div className="row setting-input">
            <input className="input sm" value={text} placeholder={s.type === 'list' ? t('settings.listPlaceholder') : ''} aria-label={label} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(s, s.type === 'number' ? Number(text) : text); }} />
            <button type="button" className="btn sm" onClick={() => void save(s, s.type === 'number' ? Number(text) : text)}>{t('web.save')}</button>
          </div>
        )}
    </div>
  );
}

function General() {
  const t = useT();
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ['settings'], queryFn: () => get<{ kb: string; settings: Setting[] }>('/api/settings') });
  if (r.isLoading) return <SkeletonRows rows={8} />;
  if (r.error || !r.data) return <ErrorState error={r.error} retry={() => void r.refetch()} />;
  const save = async (s: Setting, value: unknown) => {
    try {
      const out = await post<{ value: unknown }>('/api/settings', { key: s.key, value });
      toast(t('settings.changed', { label: t(`settings.label.${s.key}`), value: typeof out.value === 'boolean' ? (out.value ? t('web.settings.on') : t('web.settings.off')) : String(out.value) }));
      if (s.key === 'ui.language') window.location.reload();
      void qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <>
      <p className="page-intro">{t('web.settings.lead')}</p>
      {GROUPS.map((g) => {
        const items = r.data.settings.filter((s) => s.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="panel">
            <div className="panel-head"><h2>{t(`settings.group.${g}`)}</h2>{t.has(`settings.groupHint.${g}`) ? <span className="small muted" style={{ marginLeft: 8 }}>{t(`settings.groupHint.${g}`)}</span> : null}</div>
            <div className="panel-body settings-list">{items.map((s) => <SettingRow key={`${s.key}:${String(s.value)}`} s={s} save={save} />)}</div>
          </section>
        );
      })}
      <p className="small muted row"><Info size={14} aria-hidden="true" />{t('web.settings.footer', { kb: r.data.kb })}</p>
    </>
  );
}

function Appearance() {
  const t = useT();
  const appearance = useAppearanceChoices();
  if (!appearance) return null;
  return (
    <>
      <p className="page-intro">{t('app.settings.appearanceWhy')}</p>
      <section className="panel appearance-panel"><div className="panel-body menu theme-menu inline"><AppearanceChoices appearance={appearance} /></div></section>
      <section className="panel">
        <div className="panel-head"><h2>{t('app.settings.rail')}</h2></div>
        <div className="panel-body"><div className="setting-row"><div className="grow"><b>{t('app.settings.railLabel')}</b><small className="muted">{t('app.settings.railWhy')}</small></div><Switch on={appearance.rail === 'collapsed'} onChange={() => appearance.toggleRail()} label={t('app.settings.railLabel')} /></div></div>
      </section>
    </>
  );
}

export default function Settings({ route }: { route: Extract<Route, { name: 'settings' }> }) {
  const t = useT();
  const tab = route.tab;
  return (
    <div className={`page${tab === 'new' ? ' narrow' : ''}`}>
      <PageTabs label={t('app.nav.settings')} tabs={[
        { to: { name: 'settings' }, label: t('app.settings.tab.general'), current: !tab, icon: SlidersHorizontal },
        { to: { name: 'settings', tab: 'appearance' }, label: t('app.settings.tab.appearance'), current: tab === 'appearance', icon: Palette },
        { to: { name: 'settings', tab: 'brains' }, label: t('app.settings.tab.brains'), current: tab === 'brains', icon: Brain },
        { to: { name: 'settings', tab: 'new' }, label: t('app.kb.create'), current: tab === 'new', icon: FolderPlus },
      ]} />
      {!tab ? <General /> : tab === 'appearance' ? <Appearance /> : tab === 'brains' ? <BrainsList /> : <Wizard first={false} />}
    </div>
  );
}
