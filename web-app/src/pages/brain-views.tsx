import * as Popover from '@radix-ui/react-popover';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check, ChevronDown, ChevronRight, Clock, Copy, FolderClosed, LayoutGrid, Layers, List, ListFilter, Lock, LockOpen, Pin, Rows3, SlidersHorizontal, Star, Trash2, X,
} from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { post } from '../app/api';
import { useCategories, type NoteRow, type Recent } from '../app/data';
import { tn, useT } from '../app/i18n';
import { go, hrefFor } from '../app/router';
import { removeView, type Pin as PinT, type SavedView } from '../app/pins';
import { toast } from '../app/toast';
import { CatIcon } from '../ui/CatMark';
import { TypeMark } from '../ui/TypeMark';
import { activeFilters, writeFilters, type Filters } from './brain-filter';
import type { ListRow } from './brain-tree';

export type View = 'list' | 'table' | 'cards';
export type GroupBy = 'type' | 'folder' | 'none';

/* ------------------------------------------------------------- small parts */

export function Stars({ n }: { n: number | null | undefined }) {
  const t = useT();
  if (typeof n !== 'number') return <span className="stars none" aria-label={t('app.brain.noStars')}>—</span>;
  return (
    <span className="stars" role="img" aria-label={t('app.brain.stars', { n })} title={t('app.brain.stars', { n })}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} aria-hidden="true" className={i <= n ? 'on' : ''} />)}
    </span>
  );
}

export function when(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function Seg<V extends string>({ value, options, onChange, label }: { value: V; options: readonly { v: V; label: string; icon?: ReactNode }[]; onChange: (v: V) => void; label: string }) {
  return (
    <div className="segmented fill" role="group" aria-label={label}>
      {options.map((o) => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.icon}{o.label}</button>)}
    </div>
  );
}

/* ------------------------------------------------------------------ menus */

/** Every filter in one place: types (several), status, quality, date, 🔒. */
export function FilterMenu({ filters, set }: { filters: Filters; set: (patch: Record<string, string>) => void }) {
  const t = useT();
  const cats = useCategories();
  const n = activeFilters(filters);
  const write = (patch: Partial<Filters>) => set(writeFilters({ ...filters, ...patch }));
  const toggleCat = (id: string) => write({ cats: filters.cats.includes(id) ? filters.cats.filter((c) => c !== id) : [...filters.cats, id] });
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={`btn sm${n ? ' on' : ' ghost'}`} aria-label={n ? t('app.brain.filtersOn', { n }) : t('app.brain.filters')}>
          <ListFilter size={15} aria-hidden="true" />{t('app.brain.filters')}{n ? <span className="count-dot num">{n}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu filter-menu" align="end" sideOffset={6} aria-label={t('app.brain.filters')}>
          <p className="menu-heading">{t('app.brain.f.types')}</p>
          <div className="filter-types">
            {cats.list.map((c) => (
              <button key={c.id} type="button" role="menuitemcheckbox" aria-checked={filters.cats.includes(c.id)} onClick={() => toggleCat(c.id)} style={{ '--c': cats.color(c.id) } as CSSProperties}>
                <span className="cat xs"><CatIcon id={c.id} emoji={c.emoji} size={11} /></span><span className="grow">{c.label[t.lang]}</span>
                {filters.cats.includes(c.id) ? <Check size={15} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <hr />
          <p className="menu-heading">{t('app.brain.f.status')}</p>
          <Seg label={t('app.brain.f.status')} value={filters.status} onChange={(v) => write({ status: v })} options={[
            { v: '', label: t('app.brain.f.all') }, { v: 'draft', label: t('app.brain.f.draft') }, { v: 'stable', label: t('app.brain.f.stable') }, { v: 'deprecated', label: t('app.brain.f.deprecated') },
          ]} />
          <p className="menu-heading">{t('app.brain.f.quality')}</p>
          <Seg label={t('app.brain.f.quality')} value={filters.quality} onChange={(v) => write({ quality: v })} options={[
            { v: '', label: t('app.brain.f.allF') }, { v: 'good', label: t('app.brain.f.good') }, { v: 'weak', label: t('app.brain.f.weak') },
          ]} />
          <p className="menu-heading">{t('app.brain.f.since')}</p>
          <Seg label={t('app.brain.f.since')} value={filters.since} onChange={(v) => write({ since: v })} options={[
            { v: '', label: t('app.brain.f.ever') }, { v: '7d', label: t('app.brain.f.7d') }, { v: '30d', label: t('app.brain.f.30d') }, { v: '1y', label: t('app.brain.f.1y') },
          ]} />
          <p className="menu-heading">{t('app.brain.f.secret')}</p>
          <Seg label={t('app.brain.f.secret')} value={filters.secret} onChange={(v) => write({ secret: v })} options={[
            { v: '', label: t('app.brain.f.allF') }, { v: 'only', label: t('app.brain.f.onlySecret'), icon: <Lock size={12} aria-hidden="true" /> }, { v: 'hide', label: t('app.brain.f.hideSecret') },
          ]} />
          {n ? <><hr /><button type="button" onClick={() => write({ cats: [], status: '', quality: '', since: '', secret: '' })}><X size={15} aria-hidden="true" />{t('app.brain.f.clear')}</button></> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** How the notes are shown: list, table or cards; grouped; in which order. */
export function DisplayMenu({ view, setView, group, setGroup, sort, setSort, searching }: {
  view: View; setView: (v: View) => void; group: GroupBy; setGroup: (g: GroupBy) => void; sort: Filters['sort']; setSort: (s: Filters['sort']) => void; searching: boolean;
}) {
  const t = useT();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn sm ghost icon" aria-label={t('app.brain.display')} title={t('app.brain.display')}><SlidersHorizontal size={16} aria-hidden="true" /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu filter-menu" align="end" sideOffset={6} aria-label={t('app.brain.display')}>
          <p className="menu-heading">{t('app.brain.d.view')}</p>
          <Seg label={t('app.brain.d.view')} value={view} onChange={setView} options={[
            { v: 'list', label: t('app.brain.d.list'), icon: <List size={14} aria-hidden="true" /> },
            { v: 'table', label: t('app.brain.d.table'), icon: <Rows3 size={14} aria-hidden="true" /> },
            { v: 'cards', label: t('app.brain.d.cards'), icon: <LayoutGrid size={14} aria-hidden="true" /> },
          ]} />
          <p className="menu-heading">{t('app.brain.group')}</p>
          <Seg label={t('app.brain.group')} value={group} onChange={setGroup} options={[
            { v: 'type', label: t('app.brain.d.byType'), icon: <Layers size={14} aria-hidden="true" /> },
            { v: 'folder', label: t('app.brain.d.byFolder'), icon: <FolderClosed size={14} aria-hidden="true" /> },
            { v: 'none', label: t('app.brain.d.noGroup') },
          ]} />
          <p className="menu-heading">{t('app.brain.d.sort')}{searching ? <span className="muted"> · {t('app.brain.d.bySearch')}</span> : null}</p>
          <Seg label={t('app.brain.d.sort')} value={sort} onChange={setSort} options={[
            { v: 'title', label: t('app.brain.d.title') }, { v: 'recent', label: t('app.brain.d.recent') }, { v: 'quality', label: t('app.brain.d.quality') },
          ]} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* --------------------------------------------------------- table and cards */

type Selection = { selected: ReadonlySet<string>; toggle: (path: string) => void; setMany: (paths: readonly string[], on: boolean) => void };

function GroupHeader({ row, isType, onToggle }: { row: Extract<ListRow<NoteRow>, { kind: 'group' }>; isType: boolean; onToggle: () => void }) {
  const t = useT();
  const cats = useCategories();
  return (
    <button type="button" className="ex-group" data-open={row.open} aria-expanded={row.open} style={{ '--c': isType ? cats.color(row.key) : undefined } as CSSProperties} onClick={onToggle}>
      <ChevronRight size={14} aria-hidden="true" className="ex-group-chev" />
      {isType ? <span className="cat xs"><CatIcon id={row.key} emoji={cats.emoji(row.key)} size={11} /></span> : <FolderClosed size={14} aria-hidden="true" className="muted" />}
      <span className="clip">{row.label || t('app.brain.here')}</span>
      <span className="ex-group-count num">{row.count}</span>
    </button>
  );
}

/** The notes as a table: what they are, where, how good, when; a box to select each. */
export function NotesTable({ rows, notes, query, current, where, isType, toggleGroup, sel }: {
  rows: readonly ListRow<NoteRow>[]; notes: readonly NoteRow[]; query: Record<string, string>; current?: string; where: (n: NoteRow) => string; isType: boolean; toggleGroup: (key: string) => void; sel: Selection;
}) {
  const t = useT();
  const cats = useCategories();
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: (i) => (rows[i]!.kind === 'group' ? 40 : 48), overscan: 14 });
  const all = notes.length > 0 && notes.every((n) => sel.selected.has(n.path));
  const some = !all && notes.some((n) => sel.selected.has(n.path));
  return (
    <div className="ex-table" role="table" aria-label={t('app.brain.list')} aria-rowcount={notes.length}>
      <div className="ex-tr ex-th" role="row">
        <span role="columnheader" className="ex-check">
          <input type="checkbox" aria-label={t('app.brain.selectAll')} checked={all} ref={(el) => { if (el) el.indeterminate = some; }} onChange={() => sel.setMany(notes.map((n) => n.path), !all)} />
        </span>
        <span role="columnheader">{t('app.brain.c.note')}</span>
        <span role="columnheader">{t('app.brain.c.type')}</span>
        <span role="columnheader" className="hide-sm">{t('app.brain.c.where')}</span>
        <span role="columnheader">{t('app.brain.c.quality')}</span>
        <span role="columnheader" className="hide-sm">{t('app.brain.c.when')}</span>
      </div>
      <div ref={parent} className="ex-scroll">
        <div role="rowgroup" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((v) => {
            const row = rows[v.index]!;
            const style = { transform: `translateY(${v.start}px)` } as CSSProperties;
            if (row.kind === 'group') return <div key={`g:${row.key}`} role="row" style={{ ...style, position: 'absolute', left: 0, right: 0 }}><GroupHeader row={row} isType={isType} onToggle={() => toggleGroup(row.key)} /></div>;
            const n = row.note;
            const on = sel.selected.has(n.path);
            return (
              <div key={n.path} role="row" className={`ex-tr${on ? ' picked' : ''}${current === n.path ? ' current' : ''}`} style={style} aria-selected={on}>
                <span role="cell" className="ex-check"><input type="checkbox" aria-label={t('app.brain.select', { title: n.title })} checked={on} onChange={() => sel.toggle(n.path)} /></span>
                <span role="cell" className="ex-cell-title">
                  <a href={hrefFor({ name: 'brain', path: n.path, query })}>{n.title}</a>
                  {n.secret ? <Lock size={12} aria-label={t('web.notes.secret')} className="muted" /> : null}
                  {n.status === 'draft' ? <span className="pill sm warn">{t('app.brain.draft')}</span> : null}
                </span>
                <span role="cell" className="ex-cell-type" style={{ '--c': cats.color(n.category) } as CSSProperties}><TypeMark id={n.category} size="xs" /><span className="clip">{cats.label(n.category)}</span></span>
                <span role="cell" className="ex-cell-where hide-sm clip">{where(n) || '—'}</span>
                <span role="cell"><Stars n={n.stars} /></span>
                <span role="cell" className="ex-cell-when hide-sm num">{when(n.at, t.lang)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PAGE = 120;

/** The notes as cards: the type, the title, what it says, where it sits; a box to select each. */
export function NoteCards({ notes, query, where, sel }: { notes: readonly NoteRow[]; query: Record<string, string>; where: (n: NoteRow) => string; sel: Selection }) {
  const t = useT();
  const cats = useCategories();
  const [shown, setShown] = useState(PAGE);
  const any = sel.selected.size > 0;
  return (
    <div className="ex-scroll">
      <ul className={`note-cards${any ? ' selecting' : ''}`}>
        {notes.slice(0, shown).map((n) => {
          const on = sel.selected.has(n.path);
          return (
            <li key={n.path} className={`note-card${on ? ' picked' : ''}`} style={{ '--c': cats.color(n.category) } as CSSProperties}>
              <label className="note-card-check"><input type="checkbox" aria-label={t('app.brain.select', { title: n.title })} checked={on} onChange={() => sel.toggle(n.path)} /></label>
              <a href={hrefFor({ name: 'brain', path: n.path, query })}>
                <span className="note-card-type"><TypeMark id={n.category} size="xs" />{cats.label(n.category)}{n.secret ? <Lock size={12} aria-hidden="true" /> : null}{n.status === 'draft' ? <span className="pill sm warn">{t('app.brain.draft')}</span> : null}</span>
                <b className="note-card-title">{n.title}</b>
                {n.description ? <span className="note-card-text">{n.description}</span> : null}
                <span className="note-card-foot"><span className="clip">{where(n)}</span><Stars n={n.stars} /></span>
              </a>
            </li>
          );
        })}
      </ul>
      {notes.length > shown ? <div className="more-row"><button type="button" className="btn sm" onClick={() => setShown(shown + PAGE)}>{tn(t, 'app.brain.more', Math.min(PAGE, notes.length - shown))}</button></div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- bulk acts */

/** What to do with the selected notes: another type, 🔒 or not, their links. Each change is one proposal to approve. */
export function BulkBar({ notes, clear }: { notes: readonly NoteRow[]; clear: () => void }) {
  const t = useT();
  const cats = useCategories();
  const [busy, setBusy] = useState(false);
  const paths = notes.map((n) => n.path);
  const allSecret = notes.every((n) => n.secret);
  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await post<{ proposalId: string; notes: number; skipped: string[] }>(path, { paths, ...body });
      toast(r.skipped.length ? t('app.brain.bulk.proposedSkipped', { n: r.notes, skipped: r.skipped.length }) : tn(t, 'app.brain.bulk.proposed', r.notes));
      clear();
      go({ name: 'inbox', tab: 'proposals', id: r.proposalId });
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const copy = () => {
    const text = notes.map((n) => `- [${n.title}](${encodeURI(n.path)})`).join('\n');
    void navigator.clipboard?.writeText(text).then(() => toast(tn(t, 'app.brain.bulk.copied', notes.length)));
  };
  return (
    <div className="bulk-bar" role="toolbar" aria-label={t('app.brain.bulk.label')}>
      <span className="bulk-count num">{tn(t, 'app.brain.bulk.count', notes.length)}</span>
      <Popover.Root>
        <Popover.Trigger asChild><button type="button" className="btn sm" disabled={busy}><Layers size={14} aria-hidden="true" />{t('app.brain.bulk.type')}<ChevronDown size={13} aria-hidden="true" /></button></Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu" side="top" align="start" sideOffset={6}>
            {cats.list.map((c) => (
              <button key={c.id} type="button" onClick={() => void act('/api/categories/set', { category: c.id })}>
                <span className="cat xs" style={{ '--c': cats.color(c.id) } as CSSProperties}><CatIcon id={c.id} emoji={c.emoji} size={11} /></span>{c.label[t.lang]}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button type="button" className="btn sm" disabled={busy} onClick={() => void act('/api/notes/confidentiality', { level: allSecret ? 'normal' : 'secret' })}>
        {allSecret ? <LockOpen size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}{allSecret ? t('app.brain.bulk.unlock') : t('app.brain.bulk.lock')}
      </button>
      <button type="button" className="btn sm ghost" onClick={copy}><Copy size={14} aria-hidden="true" />{t('app.brain.bulk.copy')}</button>
      <span className="spacer" />
      <button type="button" className="btn sm ghost icon" aria-label={t('app.brain.bulk.clear')} title={t('app.brain.bulk.clear')} onClick={clear}><X size={15} aria-hidden="true" /></button>
    </div>
  );
}

/* ------------------------------------------------- pinned, recent, saved */

/** At the top of the tree: the notes pinned, those opened lately, the saved views. */
export function Shortcuts({ pins, recents, views, apply, current }: { pins: readonly PinT[]; recents: readonly Recent[]; views: readonly SavedView[]; apply: (q: Record<string, string>) => void; current?: string }) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({ pins: true, recent: false, views: true });
  const builtin = useMemo((): SavedView[] => [
    { id: 'b-drafts', name: t('app.brain.v.drafts'), query: { status: 'draft' } },
    { id: 'b-weak', name: t('app.brain.v.weak'), query: { quality: 'weak' } },
    { id: 'b-week', name: t('app.brain.v.week'), query: { since: '7d', sort: 'recent' } },
  ], [t]);
  const section = (key: string, title: string, icon: ReactNode, count: number, body: ReactNode) => (
    <div className="shortcut" data-open={open[key]}>
      <button type="button" className="shortcut-head" aria-expanded={open[key]} onClick={() => setOpen({ ...open, [key]: !open[key] })}>
        <ChevronRight size={13} aria-hidden="true" className="ex-group-chev" />{icon}<span className="grow">{title}</span><span className="tree-count num">{count || ''}</span>
      </button>
      {open[key] ? body : null}
    </div>
  );
  return (
    <div className="shortcuts">
      {pins.length ? section('pins', t('app.brain.pinned'), <Pin size={13} aria-hidden="true" />, pins.length, (
        <ul>{pins.map((p) => <li key={p.path}><a className={current === p.path ? 'on' : ''} href={hrefFor({ name: 'brain', path: p.path })}><TypeMark id={p.category} size="xs" /><span className="clip">{p.title}</span></a></li>)}</ul>
      )) : null}
      {recents.length ? section('recent', t('app.brain.recent'), <Clock size={13} aria-hidden="true" />, recents.length, (
        <ul>{recents.slice(0, 8).map((r) => <li key={r.path}><a className={current === r.path ? 'on' : ''} href={hrefFor({ name: 'brain', path: r.path })}><TypeMark id={r.category} size="xs" /><span className="clip">{r.title}</span></a></li>)}</ul>
      )) : null}
      {section('views', t('app.brain.views'), <ListFilter size={13} aria-hidden="true" />, builtin.length + views.length, (
        <ul>
          {[...builtin, ...views].map((v) => (
            <li key={v.id} className="view-row">
              <button type="button" onClick={() => apply(v.query)}><span className="clip">{v.name}</span></button>
              {v.id.startsWith('v-') ? <button type="button" className="view-remove" aria-label={t('app.brain.v.remove', { name: v.name })} title={t('app.brain.v.remove', { name: v.name })} onClick={() => removeView(v.id)}><Trash2 size={13} aria-hidden="true" /></button> : null}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
