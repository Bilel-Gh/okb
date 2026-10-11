import { useQuery } from '@tanstack/react-query';
import type { SharedHit, SharedIssue } from '../app/sharing';
import { SharedResults, SharedUnavailable } from '../ui/SharedResults';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Bookmark, Brain, ChevronRight, FolderTree, Layers, Lock, PanelLeftClose, PanelLeftOpen, Search, X, FolderClosed } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { get } from '../app/api';
import { DRAWER_BY_NUMBER, DRAWER_COLOR, recentNotes, useCategories, useNotes, type NoteRow } from '../app/data';
import { tn, useT } from '../app/i18n';
import { saveView, usePins, useSavedViews } from '../app/pins';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { NoteHistory } from '../reader/NoteHistory';
import { Prose } from '../reader/Prose';
import { Reader } from '../reader/Reader';
import { Breadcrumb } from '../ui/Breadcrumb';
import { CatIcon } from '../ui/CatMark';
import { ConfirmDialog } from '../ui/Confirm';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { TypeMark } from '../ui/TypeMark';
import { activeFilters, applyFilters, readFilters, sortNotes, writeFilters } from './brain-filter';
import { ancestors, drawerOf, flattenGroups, folderTree, groupNotes, type FolderNode } from './brain-tree';
import { BulkBar, DisplayMenu, FilterMenu, NoteCards, NotesTable, Shortcuts, type GroupBy, type View } from './brain-views';

type Hit = { path: string; title: string; crumbs: string[]; snippet: string };
type SideBy = 'folders' | 'types';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { const s = read(key); return (allowed as readonly string[]).includes(s ?? '') ? (s as T) : fallback; });
  return [v, (next: T) => { setV(next); write(key, next); }];
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** A drawer's colour, from its number (« 2 Produits » → the products' blue). */
export function drawerColor(name: string): string {
  const { n } = drawerOf(name);
  return (n !== null && DRAWER_COLOR[DRAWER_BY_NUMBER[n] ?? '']) || 'var(--ink-3)';
}

function DrawerBadge({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const { n } = drawerOf(name);
  if (n === null) return null;
  return <span className={`drawer-n${size === 'lg' ? ' lg' : ''}`} style={{ '--c': drawerColor(name) } as CSSProperties} aria-hidden="true">{n}</span>;
}

/* ------------------------------------------------------------------ the side: folders or types */

function FolderRows({ nodes, depth, open, toggle, current, here, select }: {
  nodes: readonly FolderNode[]; depth: number; open: ReadonlySet<string>; toggle: (p: string) => void; current: string; here: string; select: (p: string) => void;
}) {
  const t = useT();
  return (
    <>
      {nodes.map((n) => {
        const isOpen = open.has(n.path);
        const { label } = depth === 0 ? drawerOf(n.name) : { label: n.name };
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.children.length ? isOpen : undefined} aria-selected={current === n.path} aria-level={depth + 1}>
            <div className={`tree-row${current === n.path ? ' on' : here === n.path ? ' here' : ''}`} style={{ '--depth': depth } as CSSProperties}>
              {n.children.length ? (
                <button type="button" className="tree-chev" aria-label={t(isOpen ? 'app.brain.fold' : 'app.brain.unfold', { name: label })} onClick={() => toggle(n.path)}>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              ) : <span className="tree-chev" aria-hidden="true" />}
              <a className="tree-label" href={hrefFor({ name: 'brain', query: { in: n.path } })} onClick={(e) => { e.preventDefault(); select(n.path); }} aria-current={current === n.path ? 'true' : undefined}>
                {depth === 0 ? <DrawerBadge name={n.name} /> : null}
                <span className="clip">{label}</span>
              </a>
              <span className="tree-count num">{n.count}</span>
            </div>
            {n.children.length && isOpen ? (
              <ul role="group"><FolderRows nodes={n.children} depth={depth + 1} open={open} toggle={toggle} current={current} here={here} select={select} /></ul>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

function TypeRows({ notes, open, toggle, cat, folder, pick }: {
  notes: readonly NoteRow[]; open: ReadonlySet<string>; toggle: (k: string) => void; cat: string; folder: string; pick: (cat: string, folder?: string) => void;
}) {
  const t = useT();
  const cats = useCategories();
  const byType = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const n of notes) {
      const drawers = m.get(n.category) ?? new Map<string, number>();
      const d = n.path.includes('/') ? n.path.split('/')[0]! : '';
      drawers.set(d, (drawers.get(d) ?? 0) + 1);
      m.set(n.category, drawers);
    }
    return m;
  }, [notes]);
  const order = cats.list.map((c) => c.id).filter((id) => byType.has(id));
  for (const id of byType.keys()) if (!order.includes(id)) order.push(id);
  return (
    <>
      {order.map((id) => {
        const drawers = [...byType.get(id)!.entries()].filter(([d]) => d).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
        const total = [...byType.get(id)!.values()].reduce((a, b) => a + b, 0);
        const key = `type:${id}`;
        const isOpen = open.has(key);
        const c = cats.list.find((x) => x.id === id);
        return (
          <li key={id} role="treeitem" aria-expanded={drawers.length ? isOpen : undefined} aria-selected={cat === id && !folder} aria-level={1}>
            <div className={`tree-row${cat === id && !folder ? ' on' : ''}`} style={{ '--depth': 0, '--c': cats.color(id) } as CSSProperties}>
              {drawers.length ? (
                <button type="button" className="tree-chev" aria-label={t(isOpen ? 'app.brain.fold' : 'app.brain.unfold', { name: cats.label(id) })} onClick={() => toggle(key)}><ChevronRight size={14} aria-hidden="true" /></button>
              ) : <span className="tree-chev" aria-hidden="true" />}
              <a className="tree-label" href={hrefFor({ name: 'brain', query: { cat: id } })} onClick={(e) => { e.preventDefault(); pick(id); }} title={c?.description?.[t.lang]}>
                <span className="cat xs"><CatIcon id={id} emoji={cats.emoji(id)} size={11} /></span>
                <span className="clip">{cats.label(id)}</span>
              </a>
              <span className="tree-count num">{total}</span>
            </div>
            {isOpen ? (
              <ul role="group">
                {drawers.map(([d, count]) => (
                  <li key={d} role="treeitem" aria-selected={cat === id && folder === d} aria-level={2}>
                    <div className={`tree-row${cat === id && folder === d ? ' on' : ''}`} style={{ '--depth': 1 } as CSSProperties}>
                      <span className="tree-chev" aria-hidden="true" />
                      <a className="tree-label" href={hrefFor({ name: 'brain', query: { cat: id, in: d } })} onClick={(e) => { e.preventDefault(); pick(id, d); }}>
                        <DrawerBadge name={d} /><span className="clip">{drawerOf(d).label}</span>
                      </a>
                      <span className="tree-count num">{count}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ the overview of a folder */

type BrainIndex = { folder: string; hub: string | null; title: string; hubHtml: string | null; crumbs: { title: string; path: string | null }[] };

function TypeBar({ notes, onPick }: { notes: readonly NoteRow[]; onPick: (cat: string) => void }) {
  const t = useT();
  const cats = useCategories();
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
  const order = cats.list.map((c) => c.id).filter((id) => counts.get(id));
  for (const id of counts.keys()) if (!order.includes(id)) order.push(id);
  if (!order.length) return null;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="typebar" role="img" aria-label={order.map((id) => `${cats.label(id)} ${counts.get(id)}`).join(', ')}>
        {order.map((id) => <span key={id} style={{ '--c': cats.color(id), flex: counts.get(id) } as CSSProperties} />)}
      </div>
      <ul className="type-legend">
        {order.map((id) => (
          <li key={id} style={{ '--c': cats.color(id) } as CSSProperties}>
            <button type="button" onClick={() => onPick(id)} title={t('app.brain.onlyType', { type: cats.label(id) })}>
              <span className="cat xs"><CatIcon id={id} emoji={cats.emoji(id)} size={11} /></span>{cats.label(id)} <b className="num">{counts.get(id)}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FolderOverview({ folder, cat, notes, tree, select, pickCat, brainName }: {
  folder: string; cat: string; notes: readonly NoteRow[]; tree: readonly FolderNode[]; select: (p: string) => void; pickCat: (c: string) => void; brainName: string;
}) {
  const t = useT();
  const cats = useCategories();
  const index = useQuery({ queryKey: ['brain-index', folder], queryFn: () => get<BrainIndex>('/api/brain/index', { folder }), enabled: Boolean(folder) });
  const inside = notes.filter((n) => !folder || n.path.startsWith(`${folder}/`));
  const node = useMemo(() => {
    let level: readonly FolderNode[] = tree;
    let found: FolderNode | null = null;
    for (const p of ancestors(folder)) { found = level.find((x) => x.path === p) ?? null; level = found?.children ?? []; }
    return found;
  }, [tree, folder]);
  const subs = folder ? node?.children ?? [] : tree;
  const name = folder ? drawerOf(folder.split('/').pop()!).label : brainName;
  const category = cat ? cats.list.find((c) => c.id === cat) : null;
  const recent = folder ? [] : recentNotes().slice(0, 6);
  const stops = folder ? [{ title: brainName, href: hrefFor({ name: 'brain' }) }, ...ancestors(folder).map((p) => ({ title: drawerOf(p.split('/').pop()!).label, href: hrefFor({ name: 'brain', query: { in: p } }) }))] : [];

  return (
    <div className="overview">
      {stops.length > 1 ? <Breadcrumb stops={stops} label={t('app.note.line')} /> : null}
      <header className="ov-head">
        {folder && drawerOf(folder).n !== null && !folder.includes('/') ? <DrawerBadge name={folder} size="lg" /> : folder ? <span className="tile off" aria-hidden="true"><FolderClosed size={20} /></span> : <span className="tile" aria-hidden="true"><Brain size={20} /></span>}
        <div style={{ minWidth: 0 }}>
          <h1>{index.data?.title && folder ? drawerOf(index.data.title).label : name}</h1>
          <p className="muted">{tn(t, 'app.brain.count', inside.length)}{subs.length ? ` · ${tn(t, 'app.brain.subfolders', subs.length)}` : ''}</p>
        </div>
      </header>
      {category ? (
        <div className="notice plain" style={{ '--c': cats.color(category.id) } as CSSProperties}>
          <TypeMark id={category.id} size="sm" />
          <div><b>{category.label[t.lang]}</b>{category.description ? <> — {category.description[t.lang]}</> : null}</div>
        </div>
      ) : null}
      <TypeBar notes={inside} onPick={pickCat} />
      {index.data?.hubHtml && index.data.hub ? (
        <section className="panel ov-hub">
          <div className="panel-head"><h2>{t('app.brain.fiveMin')}</h2><a className="link" href={hrefFor({ name: 'brain', path: index.data.hub })}>{t('app.brain.openHub')}</a></div>
          <div className="panel-body"><Prose html={index.data.hubHtml} dropTitle /></div>
        </section>
      ) : null}
      {subs.length ? (
        <section className="stack">
          <h2 className="section-title">{folder ? t('app.brain.subfoldersTitle') : t('app.brain.drawers')}</h2>
          <ul className="folder-cards">
            {subs.map((s) => {
              const ofThis = notes.filter((n) => n.path.startsWith(`${s.path}/`));
              const counts = new Map<string, number>();
              for (const n of ofThis) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
              return (
                <li key={s.path}>
                  <a href={hrefFor({ name: 'brain', query: { in: s.path } })} onClick={(e) => { e.preventDefault(); select(s.path); }}>
                    <span className="row" style={{ gap: 10 }}>
                      {folder ? <FolderClosed size={16} className="muted" aria-hidden="true" /> : <DrawerBadge name={s.name} />}
                      <b className="clip">{drawerOf(s.name).label}</b>
                    </span>
                    <span className="muted small">{tn(t, 'app.brain.count', s.count)}{s.children.length ? ` · ${tn(t, 'app.brain.subfolders', s.children.length)}` : ''}</span>
                    <span className="typebar thin" aria-hidden="true">
                      {[...counts.entries()].map(([id, c]) => <span key={id} style={{ '--c': cats.color(id), flex: c } as CSSProperties} />)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {recent.length ? (
        <section className="stack">
          <h2 className="section-title">{t('app.brain.recent')}</h2>
          <ul className="rows panel">
            {recent.map((r) => (
              <li key={r.path} className="link-row">
                <a href={hrefFor({ name: 'brain', path: r.path })}><TypeMark id={r.category} size="sm" /><span className="grow"><span className="title">{r.title}</span><span className="meta">{r.path.split('/').slice(0, -1).map((p) => drawerOf(p).label).join(' › ')}</span></span></a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export default function BrainPage({ route, setTitle }: { route: Extract<Route, { name: 'brain' }>; setTitle: (s: string) => void }) {
  const t = useT();
  const cats = useCategories();
  const notes = useNotes();
  const query = route.query ?? {};
  const [q, setQ] = useState(query.q ?? '');
  const [treeOpen, setTreeOpen] = useState(false);
  const [side, setSide] = useStored<SideBy>('okb-brain-by', 'folders', ['folders', 'types']);
  const [groupBy, setGroupBy] = useStored<GroupBy>('okb-brain-group', 'type', ['type', 'folder', 'none']);
  const [view, setView] = useStored<View>('okb-brain-view', 'list', ['list', 'table', 'cards']);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState(false);
  const pins = usePins();
  const savedViews = useSavedViews();
  const search = useRef<HTMLInputElement>(null);
  const [treeShown, setTreeShown] = useStored<'shown' | 'hidden'>('okb-brain-tree', 'shown', ['shown', 'hidden']);
  const [open, setOpen] = useState<Set<string>>(() => { try { return new Set(JSON.parse(read('okb-brain-open') ?? '[]') as string[]); } catch { return new Set(); } });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const folder = query.in ?? '';
  const filters = readFilters(query);
  // The tree and the folder page show one type at a time; the filters can hold several.
  const cat = filters.cats.length === 1 ? filters.cats[0]! : '';
  const dq = useDebounced(q.trim(), 140);
  const server = useQuery({ queryKey: ['find', dq, 'explorer'], queryFn: () => get<{ hits: Hit[]; shared?: SharedHit[]; sharedIssue?: SharedIssue }>('/api/find', { q: dq, limit: 80 }), enabled: dq.length > 1 });
  const brainName = (useQuery({ queryKey: ['status'], queryFn: () => get<{ name: string }>('/api/status') }).data?.name) ?? t('app.brain.everything');

  const setFilter = (patch: Record<string, string>) => {
    const next = { ...query, ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    go({ name: 'brain', query: next });
  };
  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    write('okb-brain-open', JSON.stringify([...next].slice(-200)));
    return next;
  });
  // The folders that lead to the chosen folder or the open note stay unfolded.
  useEffect(() => {
    const need = [...ancestors(folder), ...(route.path ? ancestors(route.path, true) : [])];
    if (need.every((p) => open.has(p))) return;
    setOpen((prev) => new Set([...prev, ...need]));
  }, [folder, route.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!route.path) setTitle(t('app.screen.memory')); }, [route.path, setTitle, t]);
  useEffect(() => { setQ(query.q ?? ''); }, [query.q]);

  const all = notes.data?.notes ?? [];
  const list = useMemo(() => {
    const byPath = new Map(all.map((n) => [n.path, n]));
    let out: NoteRow[];
    if (dq.length > 1 && server.data) {
      // The server's search forgives typos and accents and ranks by relevance.
      out = server.data.hits.map((h) => byPath.get(h.path)).filter((n): n is NoteRow => Boolean(n));
      const local = all.filter((n) => norm(n.title).includes(norm(dq)) && !out.includes(n));
      out = [...out, ...local];
    } else if (dq) {
      out = all.filter((n) => norm(`${n.title} ${n.path}`).includes(norm(dq)));
    } else out = all;
    const kept = applyFilters(out.filter((n) => !folder || n.path.startsWith(`${folder}/`)), filters);
    // A search keeps its order (by relevance); otherwise the order chosen.
    return dq ? kept : sortNotes(kept, filters.sort);
  }, [all, dq, server.data, folder, query.cat, query.status, query.quality, query.since, query.secret, query.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => folderTree(all.map((n) => n.path)), [all]);
  const grouping: GroupBy = dq ? 'none' : groupBy;
  const rows = useMemo(() => {
    if (grouping === 'none') return list.map((note) => ({ kind: 'note' as const, note, group: '' }));
    const groups = groupNotes(list, grouping, { order: cats.list.map((c) => c.id), label: (k) => cats.label(k), within: folder });
    return flattenGroups(groups, closed);
  }, [list, grouping, cats, folder, closed]);

  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: (i) => (rows[i]!.kind === 'group' ? 40 : 56), overscan: 12 });
  const reading = Boolean(route.path);
  const wide = view !== 'list' && !reading;
  const sel = useMemo(() => ({
    selected,
    toggle: (path: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; }),
    setMany: (paths: readonly string[], on: boolean) => setSelected((prev) => { const next = new Set(prev); for (const p of paths) if (on) next.add(p); else next.delete(p); return next; }),
  }), [selected]);
  const picked = useMemo(() => all.filter((n) => selected.has(n.path)), [all, selected]);
  const toggleGroup = (key: string) => setClosed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  // Escape clears the selection, then goes back to the list (« / » stays the search of the whole app).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, [contenteditable="true"]') !== null);
      if (e.key !== 'Escape' || typing || document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      if (selected.size) { setSelected(new Set()); return; }
      if (route.path) go({ name: 'brain', query });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected.size, route.path, query]);
  // The open note stays in sight in the list.
  useEffect(() => {
    if (!route.path) return;
    const i = rows.findIndex((r) => r.kind === 'note' && r.note.path === route.path);
    if (i >= 0) virtual.scrollToIndex(i, { align: 'auto' });
  }, [route.path, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Choosing the folder already chosen folds or unfolds it.
  const select = (p: string) => { if (folder === p && !route.path) toggle(p); else setFilter({ in: p }); setTreeOpen(false); };
  const pickType = (c: string, d?: string) => { setFilter({ cat: c, in: d ?? '' }); setTreeOpen(false); };
  const pickCat = (c: string) => setFilter({ cat: c === cat ? '' : c });
  const removeCat = (c: string) => setFilter({ cat: filters.cats.filter((x) => x !== c).join(',') });
  const where = (n: NoteRow) => {
    const parts = n.path.split('/').slice(0, -1);
    const skip = folder ? folder.split('/').length : 0;
    return parts.slice(skip).map((p) => drawerOf(p).label).join(' › ');
  };

  if (notes.error) return <div className="page"><ErrorState error={notes.error} retry={() => void notes.refetch()} /></div>;

  const chips: ReactNode[] = [];
  if (folder) chips.push(
    <button type="button" key="in" className="chip on" onClick={() => setFilter({ in: '' })} aria-label={t('app.brain.remove', { name: folder })}>
      <FolderClosed size={13} aria-hidden="true" /><span className="clip">{folder.split('/').map((p) => drawerOf(p).label).join(' › ')}</span><X size={13} aria-hidden="true" />
    </button>,
  );
  for (const c of filters.cats) chips.push(
    <button type="button" key={`cat:${c}`} className="chip on" style={{ '--c': cats.color(c) } as CSSProperties} onClick={() => removeCat(c)} aria-label={t('app.brain.remove', { name: cats.label(c) })}>
      <CatIcon id={c} emoji={cats.emoji(c)} size={13} />{cats.label(c)}<X size={13} aria-hidden="true" />
    </button>,
  );
  const more: [string, string][] = [
    ['status', filters.status ? t(`app.brain.f.${filters.status}`) : ''],
    ['quality', filters.quality ? t(`app.brain.f.${filters.quality}`) : ''],
    ['since', filters.since ? t('app.brain.f.sinceChip', { when: t(`app.brain.f.${filters.since}`) }) : ''],
    ['secret', filters.secret ? t(filters.secret === 'only' ? 'app.brain.f.onlySecret' : 'app.brain.f.hideSecret') : ''],
  ];
  for (const [k, label] of more) if (label) chips.push(
    <button type="button" key={k} className="chip on" onClick={() => setFilter({ [k]: '' })} aria-label={t('app.brain.remove', { name: label })}>{label}<X size={13} aria-hidden="true" /></button>,
  );
  const narrowed = Boolean(folder) || activeFilters(filters) > 0;
  if (chips.length > 1) chips.push(<button type="button" key="clear" className="chip ghost" onClick={() => setFilter({ in: '', ...writeFilters({ ...filters, cats: [], status: '', quality: '', since: '', secret: '' }) })}>{t('app.brain.clear')}</button>);
  if (narrowed) chips.push(<button type="button" key="save" className="chip ghost" onClick={() => setNaming(true)}><Bookmark size={13} aria-hidden="true" />{t('app.brain.saveView')}</button>);

  return (
    <div className={`explorer${reading ? ' is-reading' : ''}${wide ? ' is-wide' : ''}${treeOpen ? ' tree-open' : ''}${treeShown === 'hidden' ? ' tree-hidden' : ''}`}>
      {treeOpen ? <div className="ex-scrim" onClick={() => setTreeOpen(false)} aria-hidden="true" /> : null}
      <nav className="ex-tree" aria-label={t('app.brain.tree')}>
        <div className="ex-tree-head">
          <div className="segmented" role="group" aria-label={t('app.brain.by')}>
            <button type="button" aria-pressed={side === 'folders'} onClick={() => setSide('folders')}><FolderTree size={14} aria-hidden="true" />{t('app.brain.by.folders')}</button>
            <button type="button" aria-pressed={side === 'types'} onClick={() => setSide('types')}><Layers size={14} aria-hidden="true" />{t('app.brain.by.types')}</button>
          </div>
          <button type="button" className="btn ghost sm icon tree-close" aria-label={t('app.close')} onClick={() => setTreeOpen(false)}><X size={16} aria-hidden="true" /></button>
        </div>
        <Shortcuts pins={pins} recents={recentNotes()} views={savedViews} current={route.path} apply={(q) => { go({ name: 'brain', query: q }); setTreeOpen(false); }} />
        <ul className="tree" role="tree" aria-label={side === 'folders' ? t('app.brain.by.folders') : t('app.brain.by.types')}>
          <li role="treeitem" aria-selected={!folder && !cat} aria-level={1}>
            <div className={`tree-row${!folder && !cat ? ' on' : ''}`} style={{ '--depth': 0 } as CSSProperties}>
              <span className="tree-chev" aria-hidden="true" />
              <a className="tree-label" href={hrefFor({ name: 'brain' })} onClick={(e) => { e.preventDefault(); setFilter({ in: '', cat: '' }); setTreeOpen(false); }}>
                <Brain size={15} aria-hidden="true" className="tree-icon" /><span className="clip">{t('app.brain.everything')}</span>
              </a>
              <span className="tree-count num">{all.length || ''}</span>
            </div>
          </li>
          {side === 'folders'
            ? <FolderRows nodes={tree} depth={0} open={open} toggle={toggle} current={folder} here={route.path ? route.path.split('/').slice(0, -1).join('/') : ''} select={select} />
            : <TypeRows notes={all} open={open} toggle={toggle} cat={cat} folder={folder} pick={pickType} />}
        </ul>
      </nav>

      <section className="ex-list" aria-label={t('app.brain.list')}>
        {dq.length > 1 && server.data?.sharedIssue ? <SharedUnavailable issue={server.data.sharedIssue} /> : null}
        {dq.length > 1 && server.data?.shared?.length ? <SharedResults hits={server.data.shared} /> : null}
        <div className="ex-list-head">
          <div className="row">
            <button type="button" className="btn ghost icon tree-toggle" aria-label={t('app.brain.drawers')} onClick={() => setTreeOpen(true)}><FolderTree size={18} aria-hidden="true" /></button>
            <button type="button" className="btn ghost icon tree-hide" aria-label={treeShown === 'hidden' ? t('app.brain.showTree') : t('app.brain.hideTree')} title={treeShown === 'hidden' ? t('app.brain.showTree') : t('app.brain.hideTree')} onClick={() => setTreeShown(treeShown === 'hidden' ? 'shown' : 'hidden')}>
              {treeShown === 'hidden' ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
            </button>
            <div className="search-field" style={{ flex: 1 }}>
              <Search size={16} aria-hidden="true" />
              <input ref={search} className="input" type="search" value={q} placeholder={t('app.brain.filter')} aria-label={t('app.brain.filter')} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q }); if (e.key === 'ArrowDown') (parent.current?.querySelector('a') as HTMLElement | null)?.focus(); }} />
            </div>
          </div>
          {chips.length ? <div className="chips" role="group" aria-label={t('app.brain.active')}>{chips}</div> : null}
          <div className="row ex-list-meta">
            <span className="xs muted" aria-live="polite">{notes.isLoading ? t('app.loading') : tn(t, 'app.brain.count', list.length)}</span>
            <span className="spacer" />
            <FilterMenu filters={filters} set={setFilter} />
            <DisplayMenu view={view} setView={setView} group={groupBy} setGroup={setGroupBy} sort={filters.sort} setSort={(v) => setFilter({ sort: v === 'title' ? '' : v })} searching={Boolean(dq)} />
          </div>
        </div>
        {notes.isLoading ? <SkeletonRows rows={10} /> : rows.length && wide && view === 'table' ? (
          <NotesTable rows={rows} notes={list} query={query} current={route.path} where={where} isType={grouping === 'type'} toggleGroup={toggleGroup} sel={sel} />
        ) : rows.length && wide ? (
          <NoteCards notes={list} query={query} where={where} sel={sel} />
        ) : rows.length ? (
          <div ref={parent} className="ex-scroll">
            <div role="list" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
              {virtual.getVirtualItems().map((v) => {
                const row = rows[v.index]!;
                const style = { transform: `translateY(${v.start}px)` } as CSSProperties;
                if (row.kind === 'group') {
                  const isType = grouping === 'type';
                  return (
                    <button type="button" key={`g:${row.key}`} className="ex-group" data-open={row.open} aria-expanded={row.open} style={{ ...style, '--c': isType ? cats.color(row.key) : undefined } as CSSProperties}
                      onClick={() => toggleGroup(row.key)}>
                      <ChevronRight size={14} aria-hidden="true" className="ex-group-chev" />
                      {isType ? <span className="cat xs"><CatIcon id={row.key} emoji={cats.emoji(row.key)} size={11} /></span> : <FolderClosed size={14} aria-hidden="true" className="muted" />}
                      <span className="clip">{row.label || t('app.brain.here')}</span>
                      <span className="ex-group-count num">{row.count}</span>
                    </button>
                  );
                }
                const n = row.note;
                const on = route.path === n.path;
                return (
                  <a key={n.path} role="listitem" href={hrefFor({ name: 'brain', path: n.path, query })} className={`ex-row${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} style={style}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); ((e.currentTarget.nextElementSibling ?? e.currentTarget) as HTMLElement).focus(); }
                      if (e.key === 'ArrowUp') { e.preventDefault(); ((e.currentTarget.previousElementSibling ?? e.currentTarget) as HTMLElement).focus(); }
                    }}>
                    <TypeMark id={n.category} size="sm" />
                    <span className="ex-row-text">
                      <span className="ex-row-title">{n.title}</span>
                      <span className="ex-row-path">{where(n) || (folder ? drawerOf(folder.split('/').pop()!).label : '')}</span>
                    </span>
                    {n.secret ? <Lock size={13} className="muted" aria-label={t('web.notes.secret')} /> : null}
                    {n.status === 'draft' ? <span className="pill sm warn">{t('app.brain.draft')}</span> : null}
                  </a>
                );
              })}
            </div>
          </div>
        ) : <Empty title={t('app.brain.noneTitle')} action={<button type="button" className="btn sm" onClick={() => { setQ(''); go({ name: 'brain' }); }}>{t('app.brain.clear')}</button>}>{t('app.brain.none')}</Empty>}
        {picked.length ? <BulkBar notes={picked} clear={() => setSelected(new Set())} /> : null}
      </section>

      <section className="ex-reader" aria-label={t('app.brain.reader')}>
        {route.path ? (
          <>
            <a className="btn ghost sm back-to-list" href={hrefFor({ name: 'brain', query })} onClick={(e) => { e.preventDefault(); go({ name: 'brain', query }); }}><ArrowLeft size={16} aria-hidden="true" />{t('app.brain.back')}</a>
            {route.history ? <NoteHistory path={route.path} setTitle={setTitle} /> : <Reader path={route.path} anchor={route.anchor} understand={route.query?.understand === '1'} setTitle={setTitle} />}
          </>
        ) : notes.isLoading ? <SkeletonRows rows={8} /> : (
          <FolderOverview folder={folder} cat={cat} notes={all} tree={tree} select={select} pickCat={pickCat} brainName={brainName} />
        )}
      </section>
      <ConfirmDialog open={naming} onOpenChange={setNaming} title={t('app.brain.saveViewTitle')} confirm={t('app.brain.saveView')} input={{ label: t('app.brain.viewName'), placeholder: t('app.brain.viewNameHint') }}
        onConfirm={(name) => { if (name.trim()) { saveView(name, query); toast(t('app.brain.viewSaved', { name: name.trim() })); } }}>
        {t('app.brain.saveViewWhy')}
      </ConfirmDialog>
    </div>
  );
}
