import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { currentSession, get, setSession, type Session } from './api';
import { I18n, makeT, type Messages, type Translate } from './i18n';
import { useRoute } from './router';
import { Shell } from './Shell';
import { applyLook, readLook, readMode } from './theme';
import { Boundary } from '../ui/Boundary';
import { ErrorState, SkeletonRows } from '../ui/States';

const Today = lazy(() => import('../pages/Today'));
const BrainPage = lazy(() => import('../pages/Brain'));
const InboxPage = lazy(() => import('../pages/Inbox'));
const Repos = lazy(() => import('../pages/Repos'));
const Learn = lazy(() => import('../pages/Learn'));
const AskPage = lazy(() => import('../pages/Ask'));
const Modules = lazy(() => import('../pages/Modules'));
const ClaudePage = lazy(() => import('../pages/Claude'));

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } });

function Routes({ t }: { t: Translate }) {
  const route = useRoute();
  useEffect(() => { if (route.name === 'classic' || route.name === 'settings') window.location.href = route.name === 'settings' ? '/classic#/settings' : route.href; }, [route]);
  const titles: Record<string, string> = {
    today: t('app.nav.today'), brain: t('app.nav.brain'), inbox: t('app.nav.inbox'), repos: t('app.nav.repos'),
    learn: t('app.nav.learn'), ask: t('app.nav.ask'), modules: t('app.nav.modules'), claude: t('app.nav.claude'), settings: t('app.nav.settings'), classic: 'OKB',
  };
  const arch = route.name === 'repos' && route.tab === 'architecture';
  const base = arch ? t('app.repos.tab.arch') : titles[route.name] ?? 'OKB';
  const [title, setTitle] = useState(base);
  useEffect(() => setTitle(base), [route.name, arch]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell route={route} title={title} crumb={crumbOf(route, titles)}>
      <Boundary key={route.name} labels={{ title: t('app.error.title'), updated: t('app.error.updated'), reload: t('app.reload') }}>
      <Suspense fallback={<div className="page"><SkeletonRows /></div>}>
        {route.name === 'today' ? <Today /> : null}
        {route.name === 'brain' ? <BrainPage route={route} setTitle={setTitle} /> : null}
        {route.name === 'inbox' ? <InboxPage route={route} /> : null}
        {route.name === 'repos' ? <Repos route={route} /> : null}
        {route.name === 'learn' ? <Learn /> : null}
        {route.name === 'ask' ? <AskPage route={route} /> : null}
        {route.name === 'modules' ? <Modules /> : null}
        {route.name === 'claude' ? <ClaudePage /> : null}
      </Suspense>
      </Boundary>
    </Shell>
  );
}

/** The page a detail belongs to, shown before its title: « Cerveau / Idempotence ». */
function crumbOf(route: ReturnType<typeof useRoute>, titles: Record<string, string>): string | undefined {
  if (route.name === 'brain' && route.path) return titles.brain;
  if (route.name === 'repos' && (route.id || route.tab)) return titles.repos;
  if (route.name === 'inbox' && route.id) return titles.inbox;
  return undefined;
}

/** Boot: the session (token, KBs), the messages in the person's language, the theme. */
export function App() {
  const [state, setState] = useState<{ t: Translate } | { error: unknown } | null>(null);
  const boot = useMemo(() => async () => {
    try {
      applyLook({ look: readLook(), mode: readMode() });
      const session = await get<Session>('/api/session');
      let saved: string | null = null;
      try { saved = localStorage.getItem('okb-kb'); } catch { /* private window */ }
      setSession(session, session.kbs.some((k) => k.id === saved) ? saved : session.active);
      const i18n = await get<{ lang: 'fr' | 'en'; messages: Messages }>('/api/i18n');
      document.documentElement.lang = i18n.lang;
      setState({ t: makeT(i18n.messages, i18n.lang) });
    } catch (error) {
      setState({ error });
    }
  }, []);
  useEffect(() => { void boot(); }, [boot]);
  if (!state) return <div className="page"><SkeletonRows /></div>;
  if ('error' in state) return <div className="page"><ErrorState error={state.error} retry={() => { setState(null); void boot(); }} /></div>;
  if (!state.t.lang) return null;
  return (
    <I18n.Provider value={state.t}>
      <QueryClientProvider client={client}>
        {currentKbMissing() ? <NoKb t={state.t} /> : <Routes t={state.t} />}
      </QueryClientProvider>
    </I18n.Provider>
  );
}

/** No KB yet on this computer: the guided setup lives in the classic app for now. */
function currentKbMissing(): boolean {
  return !currentSession()?.kbs.length;
}

function NoKb({ t }: { t: Translate }) {
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1>{t('app.kb.noneTitle')}</h1>
      <p className="muted">{t('app.kb.noneWhy')}</p>
      <p><a className="btn primary" href="/classic#/newkb">{t('app.kb.create')}</a></p>
    </div>
  );
}
