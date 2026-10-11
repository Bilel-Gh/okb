import { useEffect, useState } from 'react';

/**
 * Hash addresses, the same as the first versions' (`#/note/<path>`, `#/notes?q=`,
 * `#/weekly`…), so links written in notes, the terminal and Claude keep working.
 * The 2.0 groups the pages into five screens (nav.ts): `#/projects`, `#/memory`,
 * `#/assistant` and `#/progress` are their own addresses.
 */
export type TodayTab = 'focus' | 'week';
export type InboxTab = 'all' | 'suggestions' | 'proposals' | 'captures' | 'history';
export type LearnTab = 'progress' | 'career';
export type ToolsTab = 'source' | 'skills' | 'templates' | 'categories' | 'share';
export type UpkeepTab = 'health' | 'doctor' | 'usage' | 'backup';
export type SettingsTab = 'appearance' | 'brains' | 'new';
export type Route =
  | { name: 'today'; tab?: TodayTab; done?: boolean; step?: string }
  | { name: 'brain'; path?: string; anchor?: string; query?: Record<string, string>; history?: boolean }
  | { name: 'graph'; focus?: string; brain?: boolean }
  | { name: 'projects'; id?: string }
  | { name: 'documents' }
  | { name: 'repos'; id?: string; tab?: 'architecture'; view?: 'containers' | 'context' | 'flow'; from?: string; call?: string }
  | { name: 'inbox'; tab?: InboxTab; id?: string; all?: boolean; compose?: boolean }
  | { name: 'learn'; tab?: LearnTab }
  | { name: 'ask'; q?: string }
  | { name: 'tools'; tab?: ToolsTab }
  | { name: 'upkeep'; tab?: UpkeepTab }
  | { name: 'modules' }
  | { name: 'claude' }
  | { name: 'settings'; tab?: SettingsTab }
  | { name: 'help' };

function queryOf(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) out[k] = v;
  return out;
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return { name: 'today' };
  const [pathPart = '', search = ''] = raw.split('?');
  const parts = pathPart.replace(/^\//, '').split('/');
  const head = parts[0] ?? '';
  const rest = parts.slice(1).join('/');
  const q = queryOf(search);
  switch (head) {
    case '':
    case 'today':
    case 'now':
    case 'home':
      return { name: 'today' };
    case 'focus':
      return { name: 'today', tab: 'focus', ...(q.done === '1' ? { done: true } : {}) };
    case 'weekly':
      return { name: 'today', tab: 'week', ...(q.step ? { step: q.step } : {}) };
    case 'notes':
    case 'brain':
    case 'search':
    case 'memory':
      return { name: 'brain', query: q };
    case 'projects':
      return { name: 'projects' };
    case 'documents':
      return { name: 'documents' };
    case 'project':
      return rest ? { name: 'projects', id: decodeURIComponent(rest) } : { name: 'projects' };
    case 'note': {
      const [encoded = '', anchor] = rest.split('#');
      const path = decodeURIComponent(encoded);
      return { name: 'brain', path, ...(anchor ? { anchor: decodeURIComponent(anchor) } : {}), ...(Object.keys(q).length ? { query: q } : {}) };
    }
    case 'versions':
      return { name: 'brain', path: decodeURIComponent(rest), history: true };
    case 'graph':
      return { name: 'graph', ...(q.focus ? { focus: q.focus } : {}), ...(q.brain === '1' ? { brain: true } : {}) };
    case 'repos': {
      if (rest !== 'architecture') return { name: 'repos' };
      const view = q.view === 'context' || q.view === 'flow' || q.view === 'containers' ? q.view : undefined;
      return { name: 'repos', tab: 'architecture', ...(view ? { view } : {}), ...(q.from ? { from: q.from } : {}), ...(q.call ? { call: q.call } : {}) };
    }
    case 'repo':
      return { name: 'repos', id: decodeURIComponent(rest) };
    case 'suggestions':
      return { name: 'inbox', tab: 'suggestions' };
    case 'review':
    case 'proposal':
      return rest ? { name: 'inbox', tab: 'proposals', id: decodeURIComponent(rest) } : { name: 'inbox' };
    case 'changes':
      return { name: 'inbox', tab: 'proposals' };
    case 'inbox':
      return { name: 'inbox', tab: 'captures', ...(q.new === '1' ? { compose: true } : {}), ...(q.all === '1' ? { all: true } : {}) };
    case 'history':
      return { name: 'inbox', tab: 'history' };
    case 'learn':
      return rest === 'progress' ? { name: 'learn', tab: 'progress' } : { name: 'learn' };
    case 'progress':
      return { name: 'learn' };
    case 'career':
      return { name: 'learn', tab: 'career' };
    case 'ask':
    case 'assistant':
      return q.q ? { name: 'ask', q: q.q } : { name: 'ask' };
    case 'tools':
      return { name: 'tools' };
    case 'source':
    case 'skills':
    case 'templates':
    case 'categories':
    case 'share':
      return { name: 'tools', tab: head };
    case 'packs':
      return { name: 'tools', tab: 'share' };
    case 'upkeep':
      return { name: 'upkeep' };
    case 'health':
    case 'doctor':
    case 'usage':
    case 'backup':
      return { name: 'upkeep', tab: head };
    case 'modules':
      return { name: 'modules' };
    case 'claude':
      return { name: 'claude' };
    case 'settings':
      return rest === 'appearance' ? { name: 'settings', tab: 'appearance' } : { name: 'settings' };
    case 'kbs':
      return { name: 'settings', tab: 'brains' };
    case 'newkb':
      return { name: 'settings', tab: 'new' };
    case 'help':
      return { name: 'help' };
    default:
      return { name: 'today' };
  }
}

const withQuery = (base: string, q: Record<string, string | undefined>): string => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return s ? `${base}?${s}` : base;
};

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'today':
      if (route.tab === 'focus') return withQuery('#/focus', { done: route.done ? '1' : undefined });
      if (route.tab === 'week') return withQuery('#/weekly', { step: route.step });
      return '#/';
    case 'brain': {
      if (route.path && route.history) return `#/versions/${encodeURIComponent(route.path)}`;
      const q = new URLSearchParams(route.query ?? {}).toString();
      if (route.path) return `#/note/${encodeURIComponent(route.path)}${route.anchor ? `#${encodeURIComponent(route.anchor)}` : ''}${q ? `?${q}` : ''}`;
      return `#/notes${q ? `?${q}` : ''}`;
    }
    case 'graph': return withQuery('#/graph', { focus: route.focus, brain: route.brain ? '1' : undefined });
    case 'projects': return route.id ? `#/project/${encodeURIComponent(route.id)}` : '#/projects';
    case 'documents': return '#/documents';
    case 'repos': {
      if (route.id) return `#/repo/${encodeURIComponent(route.id)}`;
      if (route.tab !== 'architecture') return '#/repos';
      return withQuery('#/repos/architecture', { view: route.view, from: route.from, call: route.call });
    }
    case 'inbox':
      if (route.id) return `#/review/${encodeURIComponent(route.id)}`;
      if (route.tab === 'suggestions') return '#/suggestions';
      if (route.tab === 'proposals') return '#/changes';
      if (route.tab === 'captures') return withQuery('#/inbox', { new: route.compose ? '1' : undefined, all: route.all ? '1' : undefined });
      if (route.tab === 'history') return '#/history';
      return '#/review';
    case 'learn': return route.tab === 'career' ? '#/career' : route.tab === 'progress' ? '#/learn/progress' : '#/learn';
    case 'ask': return route.q ? `#/ask?${new URLSearchParams({ q: route.q })}` : '#/ask';
    case 'tools': return route.tab ? `#/${route.tab}` : '#/tools';
    case 'upkeep': return route.tab ? `#/${route.tab}` : '#/upkeep';
    case 'modules': return '#/modules';
    case 'claude': return '#/claude';
    case 'settings': return route.tab === 'brains' ? '#/kbs' : route.tab === 'new' ? '#/newkb' : route.tab === 'appearance' ? '#/settings/appearance' : '#/settings';
    case 'help': return '#/help';
  }
}

export function go(route: Route | string): void {
  const href = typeof route === 'string' ? route : hrefFor(route);
  window.location.hash = href.replace(/^#/, '');
}

/** The current route, following the address bar. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
