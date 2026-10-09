import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Brain, Check, ChevronsUpDown, FolderGit2, GraduationCap, History, Inbox, Menu, MessageCircleQuestion, Monitor, Moon, Network, PanelLeftClose, PanelLeftOpen, Palette as PaletteIcon, Puzzle, Search, Settings, Sun, SunMedium, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LOGOS, LogoMark, type LogoId, type LogoStyle } from '../ui/Logo';
import { currentKb, currentSession, get, post } from './api';
import { useT } from './i18n';
import { Palette } from './Palette';
import { hrefFor, type Route } from './router';
import { applyLook, LOOKS, readLogo, readLogoStyle, readLook, readMode, readRail, saveRail, type Look, type Mode, type Rail } from './theme';
import { toast, useToasts } from './toast';

type Modules = { modules: { id: string; enabled: boolean }[] };
type Waiting = { suggestions: { status: string }[] };
export type Status = { name: string; notes: number; concepts: number; writingLanguage?: string; toReview?: number; health?: { score: number }; categories?: { id: string; emoji: string; label: string; count: number }[] };

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => get<Status>('/api/status'), refetchInterval: 60_000 });
}

function useWaitingCount(): number {
  const s = useQuery({ queryKey: ['suggestions'], queryFn: () => get<Waiting>('/api/suggestions'), refetchInterval: 60_000 });
  const p = useStatus();
  return (s.data?.suggestions.filter((x) => x.status === 'pending').length ?? 0) + (p.data?.toReview ?? 0);
}

/** The person's appearance: theme, light or dark, side bar folded or not. */
export type Appearance = {
  look: Look; mode: Mode; rail: Rail; logo: LogoId; logoStyle: LogoStyle;
  setLook: (l: Look) => void; setMode: (m: Mode) => void; setLogo: (l: LogoId) => void; setLogoStyle: (s: LogoStyle) => void; toggleRail: () => void;
};

function useAppearance(): Appearance {
  const [state, setState] = useState(() => ({ look: readLook(), mode: readMode(), logo: readLogo(), logoStyle: readLogoStyle() }));
  const [rail, setRail] = useState<Rail>(() => readRail(readLook()));
  const change = useCallback((patch: Partial<typeof state>) => setState((s) => { const next = { ...s, ...patch }; applyLook(next); return next; }), []);
  const setLook = useCallback((look: Look) => { change({ look }); setRail(readRail(look)); }, [change]);
  const setMode = useCallback((mode: Mode) => change({ mode }), [change]);
  const setLogo = useCallback((logo: LogoId) => change({ logo }), [change]);
  const setLogoStyle = useCallback((logoStyle: LogoStyle) => change({ logoStyle }), [change]);
  const toggleRail = useCallback(() => setRail((r) => { const next = r === 'collapsed' ? 'expanded' : 'collapsed'; saveRail(next); return next; }), []);
  useEffect(() => {
    if (state.mode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyLook(state);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [state]);
  return { ...state, rail, setLook, setMode, setLogo, setLogoStyle, toggleRail };
}

function NavLink({ to, href, icon, label, current, count, folded }: { to?: Route; href?: string; icon: ReactNode; label: string; current?: boolean; count?: number; folded: boolean }) {
  const name = count ? `${label}, ${count}` : label;
  return (
    <a className="rail-link" href={href ?? hrefFor(to!)} aria-current={current ? 'page' : undefined} aria-label={name} title={folded ? name : undefined}>
      {icon}<span className="rail-label">{label}</span>{count ? <span className="count" aria-hidden="true">{count}</span> : null}
    </a>
  );
}

function KbSwitcher({ folded }: { folded: boolean }) {
  const t = useT();
  const session = currentSession();
  const kb = session?.kbs.find((k) => k.id === currentKb());
  const [open, setOpen] = useState(false);
  const pick = async (id: string) => {
    try { localStorage.setItem('okb-kb', id); } catch { /* private window */ }
    try { await post('/api/kb/switch', { id }); } catch { /* reading another KB still works */ }
    window.location.reload();
  };
  const name = kb?.name ?? t('app.kb.none');
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="rail-kb" aria-label={`${t('app.kb.switch')} : ${name}`} title={folded ? name : undefined}>
          <span className="kb-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <span className="rail-kb-text"><span>{name}</span><small>{kb?.brain ? t(`brain.preset.${kb.brain}`) : t('app.kb.classic')}</small></span>
          <ChevronsUpDown size={15} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu" side={folded ? 'right' : 'bottom'} align="start" sideOffset={6}>
          {(session?.kbs ?? []).map((k) => (
            <button type="button" key={k.id} role="menuitemradio" aria-checked={k.id === kb?.id} onClick={() => pick(k.id)}>
              {k.id === kb?.id ? <Check size={15} aria-hidden="true" /> : <span style={{ width: 15 }} />}
              <span>{k.name}</span>
            </button>
          ))}
          <a href="/classic#/kbs"><span style={{ width: 15 }} />{t('app.kb.manage')}</a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Theme and light/dark, each theme with a preview of its colours. */
function ThemeMenu({ appearance }: { appearance: Appearance }) {
  const t = useT();
  const modes: { id: Mode; icon: ReactNode }[] = [
    { id: 'auto', icon: <Monitor size={14} aria-hidden="true" /> }, { id: 'light', icon: <Sun size={14} aria-hidden="true" /> }, { id: 'dark', icon: <Moon size={14} aria-hidden="true" /> },
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn ghost icon" aria-label={t('app.theme.title')} title={t('app.theme.title')}><PaletteIcon size={18} aria-hidden="true" /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu theme-menu" align="end" sideOffset={6} aria-label={t('app.theme.title')}>
          <p className="menu-heading">{t('app.theme.look')}</p>
          {LOOKS.map((l) => (
            <button type="button" key={l} className="theme-option" role="menuitemradio" aria-checked={appearance.look === l} onClick={() => appearance.setLook(l)}>
              <span className={`theme-swatch swatch-${l}`} aria-hidden="true" />
              <span style={{ minWidth: 0 }}><b>{t(`app.theme.${l}`)}</b><small>{t(`app.theme.${l}Why`)}</small></span>
              {appearance.look === l ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          ))}
          <p className="menu-heading">{t('app.theme.mode')}</p>
          <div className="segmented" role="group" aria-label={t('app.theme.mode')}>
            {modes.map((m) => <button type="button" key={m.id} aria-pressed={appearance.mode === m.id} onClick={() => appearance.setMode(m.id)}>{m.icon}{t(`app.mode.${m.id}`)}</button>)}
          </div>
          <p className="menu-heading">{t('app.logo.title')}</p>
          <div className="segmented" role="group" aria-label={t('app.logo.style')}>
            {(['gradient', 'flat'] as const).map((st) => <button type="button" key={st} aria-pressed={appearance.logoStyle === st} onClick={() => appearance.setLogoStyle(st)}>{t(`app.logo.${st}`)}</button>)}
          </div>
          <div className="logo-grid" role="group" aria-label={t('app.logo.title')}>
            {LOGOS.map((l) => (
              <button type="button" key={l} className="logo-option" role="menuitemradio" aria-checked={appearance.logo === l} aria-label={t(`app.logo.${l}`)} title={t(`app.logo.${l}`)} onClick={() => appearance.setLogo(l)}>
                <LogoMark logo={l} look={appearance.look} style={appearance.logoStyle} size={26} />
              </button>
            ))}
          </div>
          <p className="logo-name small muted">{t(`app.logo.${appearance.logo}`)}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A line of facts at the foot of the window (Atelier): the brain, its notes, what waits, its health. */
function StatusBar({ waiting }: { waiting: number }) {
  const t = useT();
  const s = useStatus();
  if (!s.data) return <footer className="statusbar" aria-hidden="true" />;
  return (
    <footer className="statusbar" aria-label={t('app.status.label')}>
      <span><span className="dot" aria-hidden="true" />{s.data.name}</span>
      <a href={hrefFor({ name: 'brain' })}>{t('app.status.notes', { n: s.data.notes })}</a>
      <a href={hrefFor({ name: 'inbox' })}>{t('app.status.waiting', { n: waiting })}</a>
      {s.data.health ? <a href="/classic#/health">{t('app.status.health', { n: s.data.health.score })}</a> : null}
      <span className="spacer" />
      <span>{(s.data.writingLanguage ?? '').slice(0, 2)} · {t('app.status.local')}</span>
    </footer>
  );
}

export function Shell({ route, title, crumb, children }: { route: Route; title: string; crumb?: string; children: ReactNode }) {
  const t = useT();
  const waiting = useWaitingCount();
  const appearance = useAppearance();
  const modules = useQuery({ queryKey: ['modules'], queryFn: () => get<Modules>('/api/modules'), staleTime: 60_000 });
  const devOn = modules.data ? modules.data.modules.some((m) => m.id === 'dev' && m.enabled) : true;
  const [railOpen, setRailOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const toasts = useToasts();
  const folded = appearance.rail === 'collapsed';

  useEffect(() => { setRailOpen(false); }, [route]);
  useEffect(() => { document.title = `${title} · OKB`; }, [title]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); appearance.toggleRail(); }
      else if (e.key === '/' && !typing) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [appearance]);
  useEffect(() => { if (currentSession()?.outdated) toast(t('app.outdated')); }, [t]);

  const is = (name: Route['name']) => route.name === name;
  const nav = (to: Route, icon: ReactNode, label: string, count?: number) => <NavLink to={to} icon={icon} label={label} current={is(to.name)} count={count} folded={folded} />;

  return (
    <div className="shell" data-rail={appearance.rail}>
      <a className="skip-link" href="#main">{t('app.skip')}</a>
      {railOpen ? <div className="rail-scrim" onClick={() => setRailOpen(false)} aria-hidden="true" /> : null}
      <aside className="rail" data-open={railOpen} aria-label={t('app.nav.label')}>
        <div className="rail-top">
          <a className="rail-brand" href={hrefFor({ name: 'today' })} aria-label="OKB"><LogoMark logo={appearance.logo} look={appearance.look} style={appearance.logoStyle} size={28} /><span className="rail-word">OKB</span></a>
          <button type="button" className="rail-toggle" onClick={appearance.toggleRail} aria-expanded={!folded} aria-keyshortcuts="Meta+Backslash Control+Backslash"
            aria-label={folded ? t('app.rail.expand') : t('app.rail.collapse')} title={`${folded ? t('app.rail.expand') : t('app.rail.collapse')} (⌘\\)`}>
            {folded ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
        </div>
        <KbSwitcher folded={folded} />
        <nav className="rail-section" aria-label={t('app.nav.main')}>
          {nav({ name: 'today' }, <SunMedium size={18} aria-hidden="true" />, t('app.nav.today'))}
          {nav({ name: 'brain' }, <Brain size={18} aria-hidden="true" />, t('app.nav.brain'))}
          {nav({ name: 'ask' }, <MessageCircleQuestion size={18} aria-hidden="true" />, t('app.nav.ask'))}
          {nav({ name: 'inbox' }, <Inbox size={18} aria-hidden="true" />, t('app.nav.inbox'), waiting)}
          {devOn ? nav({ name: 'repos' }, <FolderGit2 size={18} aria-hidden="true" />, t('app.nav.repos')) : null}
          {nav({ name: 'learn' }, <GraduationCap size={18} aria-hidden="true" />, t('app.nav.learn'))}
          <NavLink href="/classic#/graph" icon={<Network size={18} aria-hidden="true" />} label={t('app.nav.graph')} folded={folded} />
        </nav>
        <div className="rail-foot">
          {nav({ name: 'modules' }, <Puzzle size={18} aria-hidden="true" />, t('app.nav.modules'))}
          {nav({ name: 'claude' }, <Terminal size={18} aria-hidden="true" />, t('app.nav.claude'))}
          <NavLink href="/classic#/settings" icon={<Settings size={18} aria-hidden="true" />} label={t('app.nav.settings')} folded={folded} />
          <NavLink href="/classic" icon={<History size={18} aria-hidden="true" />} label={t('app.nav.classic')} folded={folded} />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost icon menu-btn" aria-label={t('app.nav.open')} aria-expanded={railOpen} onClick={() => setRailOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          <h1 className="topbar-title">{crumb && crumb !== title ? <span className="topbar-crumb">{crumb} / </span> : null}{title}</h1>
          <span className="spacer" />
          <button type="button" className="btn search-btn" onClick={() => setPalette(true)} aria-keyshortcuts="Meta+K" aria-label={t('app.search.open')}>
            <Search size={15} aria-hidden="true" /><span className="hide-narrow">{t('app.search.placeholder')}</span><kbd aria-hidden="true">⌘K</kbd>
          </button>
          <ThemeMenu appearance={appearance} />
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
        <StatusBar waiting={waiting} />
      </div>
      <nav className="tabbar" aria-label={t('app.nav.main')}>
        <a href={hrefFor({ name: 'today' })} aria-current={is('today') ? 'page' : undefined}><SunMedium size={20} aria-hidden="true" />{t('app.nav.today')}</a>
        <a href={hrefFor({ name: 'brain' })} aria-current={is('brain') ? 'page' : undefined}><Brain size={20} aria-hidden="true" />{t('app.nav.brain')}</a>
        <a href={hrefFor({ name: 'inbox' })} aria-current={is('inbox') ? 'page' : undefined}><Inbox size={20} aria-hidden="true" />{t('app.nav.inbox')}{waiting ? <span className="count">{waiting}</span> : null}</a>
        {devOn ? <a href={hrefFor({ name: 'repos' })} aria-current={is('repos') ? 'page' : undefined}><FolderGit2 size={20} aria-hidden="true" />{t('app.nav.repos')}</a> : null}
        <a href={hrefFor({ name: 'learn' })} aria-current={is('learn') ? 'page' : undefined}><GraduationCap size={20} aria-hidden="true" />{t('app.nav.learn')}</a>
      </nav>
      <Palette open={palette} onOpenChange={setPalette} appearance={appearance} />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => <div key={x.id} className={`toast${x.kind === 'err' ? ' err' : ''}`}>{x.text}</div>)}
      </div>
    </div>
  );
}
