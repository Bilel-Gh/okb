import * as Popover from '@radix-ui/react-popover';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, ChevronRight, ChevronsUpDown, Ellipsis, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Palette as PaletteIcon, Plus, Search, Sun } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { KeepFileButton } from '../ui/KeepFile';
import { AssistantPanel } from '../ui/AssistantPanel';
import { LOGOS, LogoMark, type LogoId } from '../ui/Logo';
import { currentKb, currentSession, get, post } from './api';
import { useT } from './i18n';
import { MORE, SCREENS, SETTINGS, screenOf, screenTabs, type NavEntry } from './nav';
import { Palette } from './Palette';
import { hrefFor, type Route } from './router';
import { applyLook, LOOKS, readLogo, readLook, readMode, readRail, readStyle, saveRail, type Look, type Mode, type Rail, type Style } from './theme';
import { toast, useToasts } from './toast';

type Modules = { modules: { id: string; enabled: boolean }[] };
type Waiting = { suggestions: { status: string }[] };
export type Status = { name: string; notes: number; concepts: number; writingLanguage?: string; toReview?: number; review?: { pending: number; share: number | null }; health?: { score: number }; categories?: { id: string; emoji: string; label: string; count: number }[] };

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => get<Status>('/api/status'), refetchInterval: 60_000 });
}

export function useWaitingCount(): number {
  const s = useQuery({ queryKey: ['suggestions'], queryFn: () => get<Waiting>('/api/suggestions'), refetchInterval: 60_000 });
  const p = useStatus();
  return (s.data?.suggestions.filter((x) => x.status === 'pending').length ?? 0) + (p.data?.toReview ?? 0);
}

/** Whether the developer module is on (its pages show only then). */
export function useDevModule(): boolean {
  const modules = useQuery({ queryKey: ['modules'], queryFn: () => get<Modules>('/api/modules'), staleTime: 60_000 });
  return modules.data ? modules.data.modules.some((m) => m.id === 'dev' && m.enabled) : true;
}

/** The person's appearance: theme, light or dark, gradient or flat, logo, side bar folded or not. */
export type Appearance = {
  look: Look; mode: Mode; style: Style; rail: Rail; logo: LogoId;
  setLook: (l: Look) => void; setMode: (m: Mode) => void; setStyle: (s: Style) => void; setLogo: (l: LogoId) => void; toggleRail: () => void;
};

function useAppearance(): Appearance {
  const [state, setState] = useState(() => ({ look: readLook(), mode: readMode(), logo: readLogo(), style: readStyle() }));
  const [rail, setRail] = useState<Rail>(() => readRail(readLook()));
  const change = useCallback((patch: Partial<typeof state>) => setState((s) => { const next = { ...s, ...patch }; applyLook(next); return next; }), []);
  const setLook = useCallback((look: Look) => { change({ look }); setRail(readRail(look)); }, [change]);
  const setMode = useCallback((mode: Mode) => change({ mode }), [change]);
  const setStyle = useCallback((style: Style) => change({ style }), [change]);
  const setLogo = useCallback((logo: LogoId) => change({ logo }), [change]);
  const toggleRail = useCallback(() => setRail((r) => { const next = r === 'collapsed' ? 'expanded' : 'collapsed'; saveRail(next); return next; }), []);
  useEffect(() => {
    if (state.mode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyLook(state);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [state]);
  return { ...state, rail, setLook, setMode, setStyle, setLogo, toggleRail };
}

function NavLink({ entry, current, folded }: { entry: NavEntry; current: boolean; folded: boolean }) {
  const t = useT();
  const label = t(entry.label);
  const Icon = entry.icon;
  return (
    <a className="rail-link" href={hrefFor(entry.route)} aria-current={current ? 'page' : undefined} aria-label={label} title={folded ? label : undefined}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span className="rail-label">{label}</span>
    </a>
  );
}

/** Everything that is not daily, one click away: tools, health, modules, help. */
function MoreMenu({ folded, current }: { folded: boolean; current: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t('app.more.label');
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="rail-link" aria-label={label} title={folded ? label : undefined} data-current={current || undefined}>
          <Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" /><span className="rail-label">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu more-menu" side="right" align="end" sideOffset={8} aria-label={label}>
          {MORE.map((e) => {
            const Icon = e.icon;
            return (
              <a key={e.label} href={hrefFor(e.route)} onClick={() => setOpen(false)}>
                <Icon size={16} aria-hidden="true" />
                <span style={{ minWidth: 0 }}><b>{t(e.label)}</b>{e.hint ? <small>{t(e.hint)}</small> : null}</span>
              </a>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * « Garde ça » (⌘J), on every screen: a line the person writes is kept at
 * once, in their captures; it never waits for a yes, since they wrote it.
 */
type Spotted = { kind: 'todo' | 'waiting'; text: string; due?: string; who?: string };

function Keep({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [withAction, setWithAction] = useState(true);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const [probe, setProbe] = useState('');
  useEffect(() => { const id = setTimeout(() => setProbe(text.trim()), 300); return () => clearTimeout(id); }, [text]);
  const projects = useQuery({ queryKey: ['projects', 'open'], queryFn: () => get<{ projects: { id: string; title: string }[] }>('/api/projects'), enabled: open, staleTime: 30_000 });
  // An action spotted in the line (a thing to do with its date, something expected from someone): offered, never created unasked.
  const spotted = useQuery({ queryKey: ['detect', probe], queryFn: () => get<{ action: Spotted | null }>('/api/actions/detect', { text: probe }), enabled: open && probe.length > 3, staleTime: 60_000 }).data?.action ?? null;
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      // In a project, the line goes to its journal; otherwise to the captures, to sort later.
      if (project) await post('/api/entries', { text: text.trim(), project });
      else await post('/api/capture', { text });
      if (spotted && withAction) await post('/api/actions', { text: spotted.text, kind: spotted.kind, ...(spotted.due ? { due: spotted.due } : {}), ...(spotted.who ? { who: spotted.who } : {}), ...(project ? { project } : {}) });
      toast(t(spotted && withAction ? 'app.keep.keptAction' : project ? 'app.keep.keptProject' : 'app.keep.kept'));
      setText('');
      onOpenChange(false);
      for (const key of ['inbox', 'status-full', 'today', 'actions', 'entries']) void qc.invalidateQueries({ queryKey: [key] });
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const due = spotted?.due ? new Date(`${spotted.due}T12:00:00`).toLocaleDateString(t.lang, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className="btn keep-btn" aria-keyshortcuts="Meta+J Control+J" aria-label={t('app.keep.button')}>
          <Plus size={16} aria-hidden="true" /><span className="hide-narrow">{t('app.keep.button')}</span><kbd aria-hidden="true" className="hide-narrow">⌘J</kbd>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu keep-pop" align="end" sideOffset={8} aria-label={t('app.keep.button')} onOpenAutoFocus={(e) => { e.preventDefault(); field.current?.focus(); }}>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <textarea ref={field} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t('app.keep.placeholder')} aria-label={t('app.keep.placeholder')}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} />
            {spotted ? (
              <label className="keep-spotted">
                <input type="checkbox" checked={withAction} onChange={(e) => setWithAction(e.target.checked)} />
                <span>{t(spotted.kind === 'waiting' ? 'app.keep.spottedWaiting' : 'app.keep.spottedTodo')} <b>{spotted.text}</b>{due ? ` · ${due}` : ''}{spotted.who ? ` · ${spotted.who}` : ''}</span>
              </label>
            ) : null}
            {projects.data?.projects.length ? (
              <label className="keep-project">
                <span className="small muted">{t('app.keep.project')}</span>
                <select className="select sm" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">{t('app.keep.noProject')}</option>
                  {projects.data.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
            ) : null}
            <div className="keep-foot"><KeepFileButton small label={t('app.keep.file')} {...(project ? { project } : {})} /><span className="spacer" /><button type="submit" className="btn primary sm" disabled={!text.trim() || busy}>{t('app.keep.save')}</button></div>
            <p className="small muted keep-hint">{t('app.keep.hint')}</p>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
          <span className="rail-kb-text"><span>{name}</span><small>{kb?.space ? t(`app.space.${kb.space}`) : kb?.brain ? t(`brain.preset.${kb.brain}`) : t('app.kb.classic')}</small></span>
          <ChevronsUpDown size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu" side={folded ? 'right' : 'bottom'} align="start" sideOffset={6}>
          {(['baggage', 'work'] as const).map((space) => {
            // Two spaces that never mix: the person's own baggage first, then work. A brain with no space said is work.
            const kbs = (session?.kbs ?? []).filter((k) => (k.space ?? 'work') === space);
            return kbs.length ? (
              <div key={space} role="group" aria-label={t(`app.space.${space}`)}>
                <p className="menu-heading">{t(`app.space.${space}`)}</p>
                {kbs.map((k) => (
                  <button type="button" key={k.id} role="menuitemradio" aria-checked={k.id === kb?.id} onClick={() => pick(k.id)}>
                    {k.id === kb?.id ? <Check size={15} aria-hidden="true" /> : <span style={{ width: 15 }} />}
                    <span>{k.name}</span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
          <hr />
          <a href={hrefFor({ name: 'settings', tab: 'brains' })} onClick={() => setOpen(false)}><span style={{ width: 15 }} />{t('app.kb.manage')}</a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The appearance choices, shared by the menu of the top bar and the settings page. */
export function AppearanceChoices({ appearance }: { appearance: Appearance }) {
  const t = useT();
  const modes: { id: Mode; icon: ReactNode }[] = [
    { id: 'light', icon: <Sun size={14} aria-hidden="true" /> }, { id: 'dark', icon: <Moon size={14} aria-hidden="true" /> }, { id: 'auto', icon: <Monitor size={14} aria-hidden="true" /> },
  ];
  return (
    <>
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
      <p className="menu-heading">{t('app.style.title')}</p>
      <div className="segmented" role="group" aria-label={t('app.style.title')}>
        {(['gradient', 'flat'] as const).map((st) => <button type="button" key={st} aria-pressed={appearance.style === st} onClick={() => appearance.setStyle(st)}>{t(`app.style.${st}`)}</button>)}
      </div>
      <p className="menu-heading">{t('app.logo.title')}</p>
      <div className="logo-grid" role="group" aria-label={t('app.logo.title')}>
        {LOGOS.map((l) => (
          <button type="button" key={l} className="logo-option" role="menuitemradio" aria-checked={appearance.logo === l} aria-label={t(`app.logo.${l}`)} title={t(`app.logo.${l}`)} onClick={() => appearance.setLogo(l)}>
            <LogoMark logo={l} look={appearance.look} style={appearance.style} size={26} />
          </button>
        ))}
      </div>
      <p className="logo-name small muted">{t(`app.logo.${appearance.logo}`)}</p>
    </>
  );
}

function ThemeMenu({ appearance }: { appearance: Appearance }) {
  const t = useT();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn ghost icon" aria-label={t('app.theme.title')} title={t('app.theme.title')}><PaletteIcon size={18} aria-hidden="true" /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu theme-menu" align="end" sideOffset={6} aria-label={t('app.theme.title')}>
          <AppearanceChoices appearance={appearance} />
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
      {s.data.review?.pending ? <a href={hrefFor({ name: 'inbox', tab: 'toreview' })}><b>{s.data.review.pending} {t.lang === 'fr' ? 'à relire' : 'to review'}</b></a> : null}
      {s.data.review?.share !== null && s.data.review?.share !== undefined ? <a href={hrefFor({ name: 'upkeep', tab: 'health' })}>{s.data.review.share} % {t.lang === 'fr' ? 'validées' : 'validated'}</a> : null}
      {s.data.health ? <a href={hrefFor({ name: 'upkeep', tab: 'health' })}>{t('app.status.health', { n: s.data.health.score })}</a> : null}
      <span className="spacer" />
      <span>{(s.data.writingLanguage ?? '').slice(0, 2)} · {t('app.status.local')}</span>
    </footer>
  );
}

export type Crumb = { label: string; to?: Route };

/** The appearance, for the pages that change it (the settings page). */
const AppearanceContext = createContext<Appearance | null>(null);
export function useAppearanceChoices(): Appearance | null {
  return useContext(AppearanceContext);
}

export function Shell({ route, title, crumb, children }: { route: Route; title: string; crumb?: Crumb; children: ReactNode }) {
  const t = useT();
  const waiting = useWaitingCount();
  const appearance = useAppearance();
  const devOn = useDevModule();
  const [railOpen, setRailOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [keep, setKeep] = useState(false);
  const toasts = useToasts();
  const folded = appearance.rail === 'collapsed';
  const main = useRef<HTMLElement>(null);
  const [contentTitle, setContentTitle] = useState(false);
  // Asynchronous pages supply their own title once loaded; the top bar stays a visual label then.
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const update = () => setContentTitle([...el.querySelectorAll('h1')].some((heading) => {
      for (let node: HTMLElement | null = heading; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
        if (node === el) break;
      }
      return true;
    }));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const TopbarTitle = contentTitle ? 'p' : 'h1';

  useEffect(() => { setRailOpen(false); }, [route]);
  useEffect(() => { document.title = `${title} · OKB`; }, [title]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setKeep((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); appearance.toggleRail(); }
      else if (e.key === '/' && !typing) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [appearance]);
  useEffect(() => { if (currentSession()?.outdated) toast(t('app.outdated')); }, [t]);

  const screen = screenOf(route);
  const tabs = screenTabs(route, devOn);
  const inMore = MORE.some((e) => e.route.name === route.name);

  return (
    <div className="shell" data-rail={appearance.rail}>
      <SkipLink label={t('app.skip')} />
      {railOpen ? <div className="rail-scrim" onClick={() => setRailOpen(false)} aria-hidden="true" /> : null}
      <aside className="rail" data-open={railOpen} aria-label={t('app.nav.label')}>
        <div className="rail-top">
          <a className="rail-brand" href={hrefFor({ name: 'today' })} aria-label="OKB"><LogoMark logo={appearance.logo} look={appearance.look} style={appearance.style} size={28} /><span className="rail-word">OKB</span></a>
          <button type="button" className="rail-toggle" onClick={appearance.toggleRail} aria-expanded={!folded} aria-keyshortcuts="Meta+Backslash Control+Backslash"
            aria-label={folded ? t('app.rail.expand') : t('app.rail.collapse')} title={`${folded ? t('app.rail.expand') : t('app.rail.collapse')} (⌘\\)`}>
            {folded ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
        </div>
        <KbSwitcher folded={folded} />
        <nav className="rail-section" aria-label={t('app.nav.screens')}>
          {SCREENS.map((e) => <NavLink key={e.id} entry={e} current={screen === e.id} folded={folded} />)}
        </nav>
        <nav className="rail-section rail-foot" aria-label={t('app.more.label')}>
          <MoreMenu folded={folded} current={inMore} />
          <NavLink entry={SETTINGS} current={route.name === 'settings'} folded={folded} />
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost icon menu-btn" aria-label={t('app.nav.open')} aria-expanded={railOpen} onClick={() => setRailOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          <TopbarTitle className="topbar-title">
            {crumb && crumb.label !== title ? <>{crumb.to ? <a className="topbar-crumb" href={hrefFor(crumb.to)}>{crumb.label}</a> : <span className="topbar-crumb">{crumb.label}</span>}<ChevronRight size={15} aria-hidden="true" /></> : null}
            <span>{title}</span>
          </TopbarTitle>
          <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-keyshortcuts="Meta+K" aria-label={t('app.search.open')}>
            <Search size={16} aria-hidden="true" /><span className="hide-narrow">{t('app.search.placeholder')}</span><kbd aria-hidden="true">⌘K</kbd>
          </button>
          <Keep open={keep} onOpenChange={setKeep} />
          <AssistantPanel context={title} />
          <a className="btn validate-btn" href={hrefFor({ name: 'inbox' })} aria-current={route.name === 'inbox' ? 'page' : undefined} aria-label={waiting ? `${t('app.nav.inbox')}, ${waiting}` : t('app.nav.inbox')}>
            <CheckCheck size={16} aria-hidden="true" /><span className="hide-narrow">{t('app.nav.inbox')}</span>{waiting ? <span className="count" aria-hidden="true">{waiting}</span> : null}
          </a>
          <ThemeMenu appearance={appearance} />
        </header>
        {tabs.length ? (
          <nav className="screen-tabs" aria-label={t(SCREENS.find((x) => x.id === screen)!.label)}>
            <div className="tabs">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return <a key={hrefFor(tab.to)} href={hrefFor(tab.to)} aria-current={tab.current ? 'page' : undefined}><Icon size={15} aria-hidden="true" />{t(tab.label)}</a>;
              })}
            </div>
          </nav>
        ) : null}
        <main ref={main} id="main" tabIndex={-1}><AppearanceContext.Provider value={appearance}>{children}</AppearanceContext.Provider></main>
        <StatusBar waiting={waiting} />
      </div>
      <nav className="tabbar" aria-label={t('app.nav.main')}>
        {SCREENS.map((e) => {
          const Icon = e.icon;
          return (
            <a key={e.id} href={hrefFor(e.route)} aria-current={screen === e.id ? 'page' : undefined}>
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />{t(e.label)}
            </a>
          );
        })}
      </nav>
      <Palette open={palette} onOpenChange={setPalette} appearance={appearance} devOn={devOn} />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => <div key={x.id} className={`toast${x.kind === 'err' ? ' err' : ''}`}>{x.text}</div>)}
      </div>
    </div>
  );
}

/**
 * « Skip to content »: the focus goes to the page. The link does not follow
 * #main, which the hash router would read as an address (F2.0-42).
 */
export function SkipLink({ label }: { label: string }) {
  return (
    <a className="skip-link" href="#main" onClick={(e) => {
      e.preventDefault();
      const main = document.getElementById('main');
      main?.focus();
      main?.scrollIntoView?.({ block: 'start' });
    }}>{label}</a>
  );
}
