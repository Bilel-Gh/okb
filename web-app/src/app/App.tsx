import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { currentSession, get, setSession, type Session } from './api';
import { I18n, makeT, type Messages, type Translate } from './i18n';
import { titleKey } from './nav';
import { useRoute, type Route } from './router';
import { Shell, type Crumb } from './Shell';
import { applyLook, readLook, readMode } from './theme';
import { Boundary } from '../ui/Boundary';
import { ErrorState, SkeletonRows } from '../ui/States';

const Today = lazy(() => import('../pages/Today'));
const BrainPage = lazy(() => import('../pages/Brain'));
const GraphPage = lazy(() => import('../pages/Graph'));
const InboxPage = lazy(() => import('../pages/Inbox'));
const Repos = lazy(() => import('../pages/Repos'));
const Projects = lazy(() => import('../pages/Projects'));
const DocumentsPage = lazy(() => import('../pages/Documents'));
const DayPage = lazy(() => import('../pages/Day'));
const Learn = lazy(() => import('../pages/Learn'));
const AskPage = lazy(() => import('../pages/Ask'));
const Tools = lazy(() => import('../pages/Tools'));
const Upkeep = lazy(() => import('../pages/Upkeep'));
const Modules = lazy(() => import('../pages/Modules'));
const ClaudePage = lazy(() => import('../pages/Claude'));
const Settings = lazy(() => import('../pages/Settings'));
const Help = lazy(() => import('../pages/Help'));

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } });

function Routes({ t }: { t: Translate }) {
  const route = useRoute();
  const base = t(titleKey(route));
  const [title, setTitle] = useState(base);
  useEffect(() => setTitle(base), [route.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell route={route} title={title} crumb={crumbOf(route, t)}>
      <Boundary key={route.name} labels={{ title: t('app.error.title'), updated: t('app.error.updated'), reload: t('app.reload') }}>
      <Suspense fallback={<div className="page"><SkeletonRows /></div>}>
        {route.name === 'today' ? <Today route={route} /> : null}
        {route.name === 'brain' ? <BrainPage route={route} setTitle={setTitle} /> : null}
        {route.name === 'graph' ? <GraphPage route={route} /> : null}
        {route.name === 'documents' ? <DocumentsPage /> : null}
        {route.name === 'day' ? <DayPage day={route.day} /> : null}
        {route.name === 'inbox' ? <InboxPage route={route} setTitle={setTitle} /> : null}
        {route.name === 'projects' ? <Projects route={route} setTitle={setTitle} /> : null}
        {route.name === 'repos' ? <Repos route={route} setTitle={setTitle} /> : null}
        {route.name === 'learn' ? <Learn route={route} /> : null}
        {route.name === 'ask' ? <AskPage route={route} /> : null}
        {route.name === 'tools' ? <Tools route={route} /> : null}
        {route.name === 'upkeep' ? <Upkeep route={route} /> : null}
        {route.name === 'modules' ? <Modules /> : null}
        {route.name === 'claude' ? <ClaudePage /> : null}
        {route.name === 'settings' ? <Settings route={route} /> : null}
        {route.name === 'help' ? <Help /> : null}
      </Suspense>
      </Boundary>
    </Shell>
  );
}

/** The page a detail belongs to, shown before its title: « Mémoire › Idempotence ». */
function crumbOf(route: Route, t: Translate): Crumb | undefined {
  if (route.name === 'brain' && route.path) return { label: t('app.screen.memory'), to: { name: 'brain', ...(route.query ? { query: route.query } : {}) } };
  if (route.name === 'projects' && route.id) return { label: t('app.screen.projects'), to: { name: 'projects' } };
  if (route.name === 'repos' && route.id) return { label: t('app.projects.repos'), to: { name: 'repos' } };
  if (route.name === 'inbox' && route.id) return { label: t('app.nav.inbox'), to: { name: 'inbox', tab: 'proposals' } };
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

/** No KB yet on this computer: the guided setup comes first. */
function currentKbMissing(): boolean {
  return !currentSession()?.kbs.length;
}

const FirstRun = lazy(() => import('../pages/FirstRun'));
function NoKb({ t }: { t: Translate }) {
  return <Suspense fallback={<div className="page"><SkeletonRows /></div>}><FirstRun t={t} /></Suspense>;
}
