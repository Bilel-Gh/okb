import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ArrowRight, Brain, MessageCircleQuestion, FileText, FolderGit2, GraduationCap, Inbox, Monitor, Moon, PanelLeft, Palette as PaletteIcon, Puzzle, Sun, SunMedium, Terminal } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { get } from './api';
import { useCategories } from './data';
import { useT } from './i18n';
import { go, type Route } from './router';
import type { Appearance } from './Shell';
import { LOGOS, LogoMark } from '../ui/Logo';

type FindHit = { path: string; title: string; type: string; crumbs: string[]; snippet: string; status: string };
type Find = { hits: FindHit[]; best: FindHit | null };

/** One debounce for the search box: the server search is fast, but not every keystroke needs it. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** ⌘K: find a note by a few words (typos and accents forgiven), or go anywhere. */
export function Palette({ open, onOpenChange, appearance }: { open: boolean; onOpenChange: (v: boolean) => void; appearance: Appearance }) {
  const t = useT();
  const cats = useCategories();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 120);
  const find = useQuery({ queryKey: ['find', query], queryFn: () => get<Find>('/api/find', { q: query, limit: 12 }), enabled: open && query.length > 1 });
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const pick = (route: Route | string) => { onOpenChange(false); go(route); };
  const pages: { route: Route; label: string; icon: ReactElement }[] = [
    { route: { name: 'today' }, label: t('app.nav.today'), icon: <SunMedium size={16} aria-hidden="true" /> },
    { route: { name: 'brain' }, label: t('app.nav.brain'), icon: <Brain size={16} aria-hidden="true" /> },
    { route: { name: 'inbox' }, label: t('app.nav.inbox'), icon: <Inbox size={16} aria-hidden="true" /> },
    { route: { name: 'repos' }, label: t('app.nav.repos'), icon: <FolderGit2 size={16} aria-hidden="true" /> },
    { route: { name: 'learn' }, label: t('app.nav.learn'), icon: <GraduationCap size={16} aria-hidden="true" /> },
    { route: { name: 'modules' }, label: t('app.nav.modules'), icon: <Puzzle size={16} aria-hidden="true" /> },
    { route: { name: 'claude' }, label: t('app.nav.claude'), icon: <Terminal size={16} aria-hidden="true" /> },
  ];

  const shownPages = pages.filter((p) => !query || p.label.toLowerCase().includes(query.toLowerCase()));
  // The appearance, from the keyboard: a theme, light or dark, the side bar.
  const looks: { id: string; label: string; icon: ReactElement; run: () => void }[] = [
    { id: 'atelier', label: `${t('app.theme.look')} : ${t('app.theme.atelier')}`, icon: <PaletteIcon size={16} aria-hidden="true" />, run: () => appearance.setLook('atelier') },
    { id: 'classique', label: `${t('app.theme.look')} : ${t('app.theme.classique')}`, icon: <PaletteIcon size={16} aria-hidden="true" />, run: () => appearance.setLook('classique') },
    { id: 'light', label: `${t('app.theme.mode')} : ${t('app.mode.light')}`, icon: <Sun size={16} aria-hidden="true" />, run: () => appearance.setMode('light') },
    { id: 'dark', label: `${t('app.theme.mode')} : ${t('app.mode.dark')}`, icon: <Moon size={16} aria-hidden="true" />, run: () => appearance.setMode('dark') },
    { id: 'auto', label: `${t('app.theme.mode')} : ${t('app.mode.auto')}`, icon: <Monitor size={16} aria-hidden="true" />, run: () => appearance.setMode('auto') },
    { id: 'rail', label: appearance.rail === 'collapsed' ? t('app.rail.expand') : t('app.rail.collapse'), icon: <PanelLeft size={16} aria-hidden="true" />, run: appearance.toggleRail },
    ...LOGOS.map((l) => ({ id: `logo-${l}`, label: `${t('app.logo.title')} : ${t(`app.logo.${l}`)}`, icon: <LogoMark logo={l} look={appearance.look} style={appearance.logoStyle} size={16} />, run: () => appearance.setLogo(l) })),
    ...(['gradient', 'flat'] as const).map((st) => ({ id: `logo-style-${st}`, label: `${t('app.logo.title')} : ${t(`app.logo.${st}`)}`, icon: <PaletteIcon size={16} aria-hidden="true" />, run: () => appearance.setLogoStyle(st) })),
  ];
  const shownLooks = looks.filter((l) => query && l.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label={t('app.search.label')} shouldFilter={false} overlayClassName="palette-overlay" contentClassName="palette">
      <Command.Input value={q} onValueChange={setQ} placeholder={t('app.search.placeholder')} />
      <Command.List>
        {query.length > 1 && find.isFetching && !find.data ? <Command.Loading>{t('app.loading')}</Command.Loading> : null}
        {query.length > 1 && find.data && !find.data.hits.length ? <Command.Empty>{t('app.search.none', { q: query })}</Command.Empty> : null}
        {query.length > 1 && find.data?.hits.length ? (
          <Command.Group heading={t('app.search.notes')}>
            {find.data.hits.map((h) => (
              <Command.Item key={h.path} value={h.path} onSelect={() => pick({ name: 'brain', path: h.path })}>
                <FileText size={16} aria-hidden="true" />
                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                <span className="hint">{h.crumbs.slice(-2).join(' › ')}</span>
              </Command.Item>
            ))}
            <Command.Item value={`ask:${query}`} onSelect={() => pick({ name: 'ask', q: query })}>
              <MessageCircleQuestion size={16} aria-hidden="true" />{t('app.search.ask', { q: query })}
            </Command.Item>
            <Command.Item value={`all:${query}`} onSelect={() => pick({ name: 'brain', query: { q: query } })}>
              <ArrowRight size={16} aria-hidden="true" />{t('app.search.all', { q: query })}
            </Command.Item>
          </Command.Group>
        ) : null}
        {shownPages.length ? (
          <Command.Group heading={t('app.search.go')}>
            {shownPages.map((p) => (
              <Command.Item key={p.label} value={`page:${p.label}`} onSelect={() => pick(p.route)}>{p.icon}{p.label}</Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {shownLooks.length ? (
          <Command.Group heading={t('app.theme.title')}>
            {shownLooks.map((l) => <Command.Item key={l.id} value={`look:${l.id}`} onSelect={() => { l.run(); onOpenChange(false); }}>{l.icon}{l.label}</Command.Item>)}
          </Command.Group>
        ) : null}
        {!query ? (
          <Command.Group heading={t('app.search.lines')}>
            {cats.list.filter((c) => (c.count ?? 1) > 0).slice(0, 10).map((c) => (
              <Command.Item key={c.id} value={`cat:${c.id}`} onSelect={() => pick({ name: 'brain', query: { cat: c.id } })}>
                <span className="dot" style={{ '--c': cats.color(c.id) } as CSSProperties} aria-hidden="true" />{c.label[t.lang]}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}
