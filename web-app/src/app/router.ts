import { useEffect, useState } from 'react';

/**
 * Hash addresses, the same as the classic app's (`#/note/<path>`, `#/notes?q=`),
 * so links written in notes, the terminal and Claude keep working. A page not
 * rebuilt yet opens in the classic app at the same address.
 */
export type Route =
  | { name: 'today' }
  | { name: 'brain'; path?: string; anchor?: string; query?: Record<string, string> }
  | { name: 'repos'; id?: string; tab?: 'architecture'; view?: 'containers' | 'context' | 'flow'; from?: string; call?: string }
  | { name: 'inbox'; tab?: 'suggestions' | 'proposals'; id?: string }
  | { name: 'learn' }
  | { name: 'ask'; q?: string }
  | { name: 'modules' }
  | { name: 'claude' }
  | { name: 'settings' }
  | { name: 'classic'; href: string };

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
  switch (head) {
    case '':
    case 'today':
    case 'now':
      return { name: 'today' };
    case 'notes':
    case 'brain':
    case 'search':
      return { name: 'brain', query: queryOf(search) };
    case 'note': {
      const [encoded = '', anchor] = rest.split('#');
      const path = decodeURIComponent(encoded);
      const query = queryOf(search);
      return { name: 'brain', path, ...(anchor ? { anchor: decodeURIComponent(anchor) } : {}), ...(Object.keys(query).length ? { query } : {}) };
    }
    case 'repos': {
      if (rest !== 'architecture') return { name: 'repos' };
      const q = queryOf(search);
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
    case 'learn':
      return { name: 'learn' };
    case 'ask': {
      const q = queryOf(search).q;
      return q ? { name: 'ask', q } : { name: 'ask' };
    }
    case 'modules':
      return { name: 'modules' };
    case 'claude':
      return { name: 'claude' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'classic', href: `/classic#${raw.startsWith('/') ? raw : `/${raw}`}` };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'today': return '#/';
    case 'brain': {
      const q = new URLSearchParams(route.query ?? {}).toString();
      if (route.path) return `#/note/${encodeURIComponent(route.path)}${route.anchor ? `#${encodeURIComponent(route.anchor)}` : ''}${q ? `?${q}` : ''}`;
      return `#/notes${q ? `?${q}` : ''}`;
    }
    case 'repos': {
      if (route.id) return `#/repo/${encodeURIComponent(route.id)}`;
      if (route.tab !== 'architecture') return '#/repos';
      const q = new URLSearchParams({ ...(route.view ? { view: route.view } : {}), ...(route.from ? { from: route.from } : {}), ...(route.call ? { call: route.call } : {}) }).toString();
      return `#/repos/architecture${q ? `?${q}` : ''}`;
    }
    case 'inbox': return route.id ? `#/review/${encodeURIComponent(route.id)}` : route.tab === 'suggestions' ? '#/suggestions' : '#/review';
    case 'learn': return '#/learn';
    case 'ask': return route.q ? `#/ask?${new URLSearchParams({ q: route.q })}` : '#/ask';
    case 'modules': return '#/modules';
    case 'claude': return '#/claude';
    case 'settings': return '#/settings';
    case 'classic': return route.href;
  }
}

export function go(route: Route | string): void {
  const href = typeof route === 'string' ? route : hrefFor(route);
  if (href.startsWith('/classic')) { window.location.href = href; return; }
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
