import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Brain, Check, MessageCircleQuestion, ChevronsUpDown, FolderGit2, GraduationCap, History, Inbox, Menu, Moon, Network, Puzzle, Search, Settings, Sun, SunMedium, Terminal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { currentKb, currentSession, get, post } from './api';
import { useT } from './i18n';
import { Palette } from './Palette';
import { hrefFor, type Route } from './router';
import { applyTheme, readTheme, type ThemeChoice } from './theme';
import { toast, useToasts } from './toast';

type Modules = { modules: { id: string; enabled: boolean }[] };
type Waiting = { suggestions: { status: string }[] };
type Status = { toReview: number };

function useWaitingCount(): number {
  const s = useQuery({ queryKey: ['suggestions'], queryFn: () => get<Waiting>('/api/suggestions'), refetchInterval: 60_000 });
  const p = useQuery({ queryKey: ['status'], queryFn: () => get<Status>('/api/status'), refetchInterval: 60_000 });
  return (s.data?.suggestions.filter((x) => x.status === 'pending').length ?? 0) + (p.data?.toReview ?? 0);
}

function NavLink({ to, icon, label, current, count }: { to: Route; icon: ReactNode; label: string; current: boolean; count?: number }) {
  return (
    <a className="rail-link" href={hrefFor(to)} aria-current={current ? 'page' : undefined}>
      {icon}<span>{label}</span>{count ? <span className="count" aria-label={String(count)}>{count}</span> : null}
    </a>
  );
}

function KbSwitcher() {
  const t = useT();
  const session = currentSession();
  const kb = session?.kbs.find((k) => k.id === currentKb());
  const [open, setOpen] = useState(false);
  const pick = async (id: string) => {
    try { localStorage.setItem('okb-kb', id); } catch { /* private window */ }
    try { await post('/api/kb/switch', { id }); } catch { /* reading another KB still works */ }
    window.location.reload();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="rail-kb" aria-label={t('app.kb.switch')}>
          <Brain size={18} aria-hidden="true" />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kb?.name ?? t('app.kb.none')}</span>
            <small>{kb?.brain ? t(`brain.preset.${kb.brain}`) : t('app.kb.classic')}</small>
          </span>
          <ChevronsUpDown size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu" side="bottom" align="start" sideOffset={6}>
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

export function Shell({ route, title, children }: { route: Route; title: string; children: ReactNode }) {
  const t = useT();
  const waiting = useWaitingCount();
  const modules = useQuery({ queryKey: ['modules'], queryFn: () => get<Modules>('/api/modules'), staleTime: 60_000 });
  const devOn = modules.data ? modules.data.modules.some((m) => m.id === 'dev' && m.enabled) : true;
  const [railOpen, setRailOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme());
  const toasts = useToasts();

  useEffect(() => { setRailOpen(false); }, [route]);
  useEffect(() => { document.title = `${title} · OKB`; }, [title]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
      else if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('auto');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  useEffect(() => { if (currentSession()?.outdated) toast(t('app.outdated')); }, [t]);

  const cycleTheme = () => {
    const next: ThemeChoice = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    applyTheme(next);
    setTheme(next);
  };
  const ThemeIcon = theme === 'auto' ? SunMedium : theme === 'light' ? Sun : Moon;
  const is = (name: Route['name']) => route.name === name;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">{t('app.skip')}</a>
      {railOpen ? <div className="rail-scrim" onClick={() => setRailOpen(false)} aria-hidden="true" /> : null}
      <aside className="rail" data-open={railOpen} aria-label={t('app.nav.label')}>
        <div className="rail-brand"><span className="rail-brand-mark" aria-hidden="true">O</span>OKB</div>
        <KbSwitcher />
        <nav className="rail-section" aria-label={t('app.nav.main')}>
          <NavLink to={{ name: 'today' }} icon={<SunMedium size={18} aria-hidden="true" />} label={t('app.nav.today')} current={is('today')} />
          <NavLink to={{ name: 'brain' }} icon={<Brain size={18} aria-hidden="true" />} label={t('app.nav.brain')} current={is('brain')} />
          <NavLink to={{ name: 'ask' }} icon={<MessageCircleQuestion size={18} aria-hidden="true" />} label={t('app.nav.ask')} current={is('ask')} />
          <NavLink to={{ name: 'inbox' }} icon={<Inbox size={18} aria-hidden="true" />} label={t('app.nav.inbox')} current={is('inbox')} count={waiting} />
          {devOn ? <NavLink to={{ name: 'repos' }} icon={<FolderGit2 size={18} aria-hidden="true" />} label={t('app.nav.repos')} current={is('repos')} /> : null}
          <NavLink to={{ name: 'learn' }} icon={<GraduationCap size={18} aria-hidden="true" />} label={t('app.nav.learn')} current={is('learn')} />
          <a className="rail-link" href="/classic#/graph"><Network size={18} aria-hidden="true" /><span>{t('app.nav.graph')}</span></a>
        </nav>
        <div className="rail-foot">
          <NavLink to={{ name: 'modules' }} icon={<Puzzle size={18} aria-hidden="true" />} label={t('app.nav.modules')} current={is('modules')} />
          <NavLink to={{ name: 'claude' }} icon={<Terminal size={18} aria-hidden="true" />} label={t('app.nav.claude')} current={is('claude')} />
          <a className="rail-link" href="/classic#/settings"><Settings size={18} aria-hidden="true" /><span>{t('app.nav.settings')}</span></a>
          <a className="rail-link" href="/classic"><History size={18} aria-hidden="true" /><span>{t('app.nav.classic')}</span></a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost icon menu-btn" aria-label={t('app.nav.open')} aria-expanded={railOpen} onClick={() => setRailOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          <h1>{title}</h1>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => setPalette(true)} aria-keyshortcuts="Meta+K">
            <Search size={16} aria-hidden="true" /><span className="hide-narrow">{t('app.search.open')}</span><kbd aria-hidden="true">⌘K</kbd>
          </button>
          <button type="button" className="btn ghost icon" onClick={cycleTheme} aria-label={t(`app.theme.${theme}`)} title={t(`app.theme.${theme}`)}><ThemeIcon size={18} aria-hidden="true" /></button>
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
      </div>
      <Palette open={palette} onOpenChange={setPalette} />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => <div key={x.id} className={`toast${x.kind === 'err' ? ' err' : ''}`}>{x.text}</div>)}
      </div>
    </div>
  );
}
