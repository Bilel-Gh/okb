import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, ChevronRight, FolderTree, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { get } from '../app/api';
import { useCategories } from '../app/data';
import { useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { Reader } from '../reader/Reader';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

type Note = { path: string; title: string; description: string; type: string; status: string; category: string };
type Hit = { path: string; title: string; crumbs: string[]; snippet: string };

/** Drawers and their subjects, from the notes' folders: `2 Produits/Atlas/…` → drawer « 2 Produits », subject « Atlas ». */
function treeOf(notes: readonly Note[]) {
  const drawers = new Map<string, { count: number; subjects: Map<string, number> }>();
  for (const n of notes) {
    const parts = n.path.split('/');
    if (parts.length < 2) continue;
    const d = drawers.get(parts[0]!) ?? { count: 0, subjects: new Map() };
    d.count++;
    if (parts.length > 2) d.subjects.set(parts[1]!, (d.subjects.get(parts[1]!) ?? 0) + 1);
    drawers.set(parts[0]!, d);
  }
  return [...drawers.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export default function BrainPage({ route, setTitle }: { route: Extract<Route, { name: 'brain' }>; setTitle: (s: string) => void }) {
  const t = useT();
  const cats = useCategories();
  const notes = useQuery({ queryKey: ['notes'], queryFn: () => get<{ notes: Note[] }>('/api/notes'), staleTime: 30_000 });
  const query = route.query ?? {};
  const [q, setQ] = useState(query.q ?? '');
  const [treeOpen, setTreeOpen] = useState(false);
  const folder = query.in ?? '';
  const cat = query.cat ?? '';
  const status = query.status ?? '';
  const dq = useDebounced(q.trim(), 140);
  const server = useQuery({ queryKey: ['find', dq, 'explorer'], queryFn: () => get<{ hits: Hit[] }>('/api/find', { q: dq, limit: 60 }), enabled: dq.length > 1 });

  // Keep the address in step with the filters, so a view can be bookmarked.
  const setFilter = (patch: Record<string, string>) => {
    const next = { ...query, ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    go({ name: 'brain', ...(route.path ? { path: route.path } : {}), query: next });
  };
  useEffect(() => { if (!route.path) setTitle(t('app.nav.brain')); }, [route.path, setTitle, t]);

  const list = useMemo(() => {
    const all = notes.data?.notes ?? [];
    const byPath = new Map(all.map((n) => [n.path, n]));
    let out: Note[];
    if (dq.length > 1 && server.data) {
      // The server's search forgives typos and accents and ranks by relevance.
      out = server.data.hits.map((h) => byPath.get(h.path)).filter((n): n is Note => Boolean(n));
      const local = all.filter((n) => norm(n.title).includes(norm(dq)) && !out.includes(n));
      out = [...out, ...local];
    } else if (dq) {
      out = all.filter((n) => norm(`${n.title} ${n.path}`).includes(norm(dq)));
    } else out = [...all];
    return out.filter((n) => (!folder || n.path.startsWith(`${folder}/`)) && (!cat || n.category === cat) && (!status || n.status === status));
  }, [notes.data, dq, server.data, folder, cat, status]);

  const parent = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({ count: list.length, getScrollElement: () => parent.current, estimateSize: () => 52, overscan: 12 });
  const tree = useMemo(() => treeOf(notes.data?.notes ?? []), [notes.data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes.data?.notes ?? []) m.set(n.category, (m.get(n.category) ?? 0) + 1);
    return m;
  }, [notes.data]);

  const reading = Boolean(route.path);
  if (notes.error) return <div className="page"><ErrorState error={notes.error} retry={() => void notes.refetch()} /></div>;

  return (
    <div className={`explorer${reading ? ' is-reading' : ''}${treeOpen ? ' tree-open' : ''}`}>
      <nav className="ex-tree" aria-label={t('app.brain.tree')}>
        <div className="ex-tree-head"><h2 className="xs muted">{t('app.brain.drawers')}</h2><button type="button" className="btn ghost sm icon tree-close" aria-label={t('app.close')} onClick={() => setTreeOpen(false)}><X size={16} aria-hidden="true" /></button></div>
        <a className={`ex-node${!folder ? ' on' : ''}`} href={hrefFor({ name: 'brain', query: { ...query, in: '' } })} onClick={(e) => { e.preventDefault(); setFilter({ in: '' }); setTreeOpen(false); }}>
          <span>{t('app.brain.everything')}</span><span className="num muted">{notes.data?.notes.length ?? ''}</span>
        </a>
        {tree.map(([drawer, d]) => (
          <div key={drawer} className="ex-group">
            <a className={`ex-node drawer${folder === drawer ? ' on' : ''}`} href="#" onClick={(e) => { e.preventDefault(); setFilter({ in: drawer }); setTreeOpen(false); }}>
              <span>{drawer}</span><span className="num muted">{d.count}</span>
            </a>
            {[...d.subjects.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subject, n]) => (
              <a key={subject} className={`ex-node sub${folder === `${drawer}/${subject}` ? ' on' : ''}`} href="#" onClick={(e) => { e.preventDefault(); setFilter({ in: `${drawer}/${subject}` }); setTreeOpen(false); }}>
                <span>{subject}</span><span className="num muted">{n}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>

      <section className="ex-list" aria-label={t('app.brain.list')}>
        <div className="ex-list-head">
          <div className="row">
            <button type="button" className="btn ghost icon tree-toggle" aria-label={t('app.brain.drawers')} onClick={() => setTreeOpen(true)}><FolderTree size={18} aria-hidden="true" /></button>
            <div className="search-field" style={{ flex: 1 }}>
              <Search size={16} aria-hidden="true" />
              <input className="input" type="search" value={q} placeholder={t('app.brain.filter')} aria-label={t('app.brain.filter')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q }); if (e.key === 'ArrowDown') (parent.current?.querySelector('a') as HTMLElement | null)?.focus(); }} />
            </div>
          </div>
          <div className="chips" role="group" aria-label={t('app.brain.lines')}>
            {cats.list.filter((c) => counts.get(c.id)).map((c) => (
              <button type="button" key={c.id} className="line-badge chip" aria-pressed={cat === c.id} style={{ '--line': cats.color(c.id) } as CSSProperties} onClick={() => setFilter({ cat: cat === c.id ? '' : c.id })}>
                <span className="station sm" aria-hidden="true" />{c.label[t.lang]}<span className="num muted">{counts.get(c.id)}</span>
              </button>
            ))}
            <button type="button" className="line-badge chip" aria-pressed={status === 'draft'} onClick={() => setFilter({ status: status === 'draft' ? '' : 'draft' })}>{t('app.brain.drafts')}</button>
          </div>
          <p className="xs muted" aria-live="polite">{notes.isLoading ? t('app.loading') : t('app.brain.count', { n: list.length })}{folder ? ` · ${folder}` : ''}</p>
        </div>
        {notes.isLoading ? <SkeletonRows rows={10} /> : list.length ? (
          <div ref={parent} className="ex-scroll" role="list">
            <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
              {rows.getVirtualItems().map((v) => {
                const n = list[v.index]!;
                const parts = n.path.split('/');
                return (
                  <a key={n.path} role="listitem" href={hrefFor({ name: 'brain', path: n.path, query })} className={`ex-row${route.path === n.path ? ' on' : ''}`} aria-current={route.path === n.path ? 'page' : undefined}
                    style={{ transform: `translateY(${v.start}px)`, '--line': cats.color(n.category) } as CSSProperties}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); ((e.currentTarget.nextElementSibling ?? e.currentTarget) as HTMLElement).focus(); }
                      if (e.key === 'ArrowUp') { e.preventDefault(); ((e.currentTarget.previousElementSibling ?? e.currentTarget) as HTMLElement).focus(); }
                    }}>
                    <span className="station sm" aria-hidden="true" />
                    <span className="ex-row-text">
                      <span className="ex-row-title">{n.title}{n.status === 'draft' ? <span className="pill xs" style={{ marginLeft: 6 }}>{t('app.brain.draft')}</span> : null}</span>
                      <span className="ex-row-path">{parts.slice(0, -1).join(' › ')}</span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" className="ex-row-chev" />
                  </a>
                );
              })}
            </div>
          </div>
        ) : <Empty title={t('app.brain.noneTitle')} action={<button type="button" className="btn sm" onClick={() => { setQ(''); setFilter({ q: '', cat: '', in: '', status: '' }); }}>{t('app.brain.clear')}</button>}>{t('app.brain.none')}</Empty>}
      </section>

      <section className="ex-reader" aria-label={t('app.brain.reader')}>
        {route.path ? (
          <>
            <a className="btn ghost sm back-to-list" href={hrefFor({ name: 'brain', query })} onClick={(e) => { e.preventDefault(); go({ name: 'brain', query }); }}><ArrowLeft size={16} aria-hidden="true" />{t('app.brain.back')}</a>
            <Reader path={route.path} anchor={route.anchor} setTitle={setTitle} />
          </>
        ) : (
          <Empty title={t('app.brain.pickTitle')}>{t('app.brain.pick')}</Empty>
        )}
      </section>
    </div>
  );
}
