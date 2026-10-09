import { ChevronDown, Download, FileUp, Folder, Lock, PackageOpen, PackagePlus, Search, X } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { get, post } from '../app/api';
import { useNotes } from '../app/data';
import { tn, useT } from '../app/i18n';
import { go } from '../app/router';
import { toast } from '../app/toast';
import { DiffView } from '../ui/DiffView';
import { folderTree, type FolderNode } from './brain-tree';

type Pack = { kind: string; subject: string; exportedAt: string; from: { brain: string; person: string }; notes: unknown[]; skipped: { path: string; reason: string }[] };
type Compared = { subject: string; exportedAt: string; from: { brain: string; person: string }; into: string; skipped: number; added: { path: string; title: string }[]; changed: { path: string; title: string; diff: string }[]; same: number };

const flat = (nodes: readonly FolderNode[], out: FolderNode[] = []): FolderNode[] => {
  for (const n of nodes) { out.push(n); flat(n.children, out); }
  return out;
};
const leaf = (path: string) => path.split('/').pop() ?? path;
const parent = (path: string) => path.split('/').slice(0, -1).join(' › ');
const day = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** A folder of the brain, found by typing: its name, where it sits, how many notes it holds. */
function FolderPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const t = useT();
  const id = useId();
  const notes = useNotes();
  const [q, setQ] = useState('');
  const folders = useMemo(() => flat(folderTree((notes.data?.notes ?? []).map((n) => n.path))), [notes.data]);
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return folders.filter((f) => words.every((w) => f.path.toLowerCase().includes(w))).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [folders, q]);
  if (value) {
    return (
      <div className="field">
        <span className="label">{label}</span>
        <div className="picked">
          <Folder size={16} aria-hidden="true" />
          <span className="grow"><b>{leaf(value)}</b>{parent(value) ? <span className="muted small"> · {parent(value)}</span> : null}</span>
          <span className="muted small num">{tn(t, 'app.share.notes', folders.find((f) => f.path === value)?.count ?? 0)}</span>
          <button type="button" className="btn sm ghost icon" aria-label={t('app.share.change')} title={t('app.share.change')} onClick={() => onChange('')}><X size={15} aria-hidden="true" /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="search-field">
        <Search size={16} aria-hidden="true" />
        <input id={id} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('app.share.find')} autoComplete="off" />
      </div>
      <ul className="folder-hits" aria-label={label}>
        {matches.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => { onChange(f.path); setQ(''); }}>
              <Folder size={15} aria-hidden="true" />
              <span className="grow"><b>{f.name}</b>{parent(f.path) ? <span className="muted"> · {parent(f.path)}</span> : null}</span>
              <span className="muted num">{f.count}</span>
            </button>
          </li>
        ))}
        {!matches.length ? <li className="muted small" style={{ padding: '8px 10px' }}>{t('app.share.noFolder')}</li> : null}
      </ul>
    </div>
  );
}

function Export() {
  const t = useT();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const pack = await get<Pack>('/api/packs/export', { folder });
      const blob = new Blob([`${JSON.stringify(pack, null, 1)}\n`], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${leaf(folder)}.okbpack.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(pack.skipped.length ? t('app.share.readySkipped', { n: pack.notes.length, skipped: pack.skipped.length }) : t('app.share.ready', { n: pack.notes.length }));
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <section className="panel">
      <div className="panel-head"><h2><PackageOpen size={17} aria-hidden="true" />{t('app.share.exportTitle')}</h2></div>
      <div className="panel-body stack">
        <p className="small muted">{t('app.share.exportWhy')}</p>
        <FolderPicker value={folder} onChange={setFolder} label={t('app.share.subject')} />
        <p className="small muted"><Lock size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {t('app.share.never')}</p>
        <button type="button" className="btn primary" disabled={!folder || busy} onClick={() => void download()}><Download size={16} aria-hidden="true" />{t('app.share.download')}</button>
      </div>
    </section>
  );
}

function Receive() {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<Compared | null>(null);
  const [into, setInto] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const compare = async (p: Pack, where: string) => {
    setBusy(true);
    try {
      const r = await post<Compared>('/api/packs/compare', { pack: p, ...(where ? { into: where } : {}) });
      setResult(r);
      setInto(r.into);
    } catch (e) { toast((e as Error).message, 'err'); setResult(null); } finally { setBusy(false); }
  };
  const read = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = JSON.parse(await file.text()) as Pack;
      setPack(p); setName(file.name);
      await compare(p, '');
    } catch { toast(t('app.share.notPack'), 'err'); }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void read(e.dataTransfer.files[0]); };
  const merge = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const r = await post<{ proposalId: string; notes: number }>('/api/packs/merge', { pack, into });
      toast(tn(t, 'app.share.merged', r.notes));
      go({ name: 'inbox', tab: 'proposals', id: r.proposalId });
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const reset = () => { setPack(null); setResult(null); setName(''); setInto(''); if (input.current) input.current.value = ''; };
  return (
    <section className="panel">
      <div className="panel-head"><h2><PackagePlus size={17} aria-hidden="true" />{t('app.share.receiveTitle')}</h2>{pack ? <><span className="spacer" /><button type="button" className="btn sm ghost" onClick={reset}>{t('app.share.another')}</button></> : null}</div>
      <div className="panel-body stack">
        {!pack ? (
          <>
            <p className="small muted">{t('app.share.receiveWhy')}</p>
            <label className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
              <FileUp size={22} aria-hidden="true" />
              <span><b>{t('app.share.drop')}</b><br /><span className="muted small">{t('app.share.dropHint')}</span></span>
              <input ref={input} type="file" accept=".json,application/json" className="sr-only" onChange={(e: ChangeEvent<HTMLInputElement>) => void read(e.target.files?.[0])} />
            </label>
          </>
        ) : result ? (
          <>
            <div className="pack-from">
              <span className="tile" aria-hidden="true"><PackageOpen size={18} /></span>
              <span className="grow">
                <b>{name}</b>
                <span className="muted small">{t('app.share.from', { brain: result.from.brain, day: day(result.exportedAt, t.lang) })}</span>
              </span>
            </div>
            <FolderPicker value={into} onChange={(v) => { setInto(v); if (v && pack) void compare(pack, v); }} label={t('app.share.into')} />
            <div className="pack-counts">
              <span className="pill ok">{tn(t, 'app.share.added', result.added.length)}</span>
              <span className="pill warn">{tn(t, 'app.share.changed', result.changed.length)}</span>
              <span className="pill">{tn(t, 'app.share.same', result.same)}</span>
              {result.skipped ? <span className="pill"><Lock size={12} aria-hidden="true" />{tn(t, 'app.share.kept', result.skipped)}</span> : null}
            </div>
            {result.added.length ? (
              <div className="stack" style={{ gap: 8 }}>
                <h3 className="small-title">{t('app.share.newNotes')}</h3>
                <ul className="pack-list">{result.added.map((n) => <li key={n.path}><span className="pack-dot add" aria-hidden="true" />{n.title}{parent(n.path) ? <span className="muted small"> · {parent(n.path)}</span> : null}</li>)}</ul>
              </div>
            ) : null}
            {result.changed.length ? (
              <div className="stack" style={{ gap: 8 }}>
                <h3 className="small-title">{t('app.share.changedNotes')}</h3>
                <p className="small muted">{t('app.share.changedWhy')}</p>
                {result.changed.map((n) => (
                  <details key={n.path} className="pack-diff">
                    <summary><span className="pack-dot changed" aria-hidden="true" /><span className="grow">{n.title}</span><ChevronDown size={16} className="exam-chev" aria-hidden="true" /></summary>
                    <DiffView text={n.diff} />
                  </details>
                ))}
              </div>
            ) : null}
            <div className="exam-run">
              <p className="small muted grow">{result.added.length ? t('app.share.mergeWhy') : t('app.share.nothingNew')}</p>
              <button type="button" className="btn primary" disabled={!result.added.length || !into || busy} onClick={() => void merge()}><PackagePlus size={16} aria-hidden="true" />{tn(t, 'app.share.merge', result.added.length)}</button>
            </div>
          </>
        ) : <p className="muted small">{busy ? t('app.share.comparing') : t('app.share.notPack')}</p>}
      </div>
    </section>
  );
}

/**
 * Share without a server (roadmap §6, step 1): a subject's notes in one file for
 * a colleague; a colleague's file compared with this brain, what is missing added
 * through a proposal, what differs shown and never overwritten.
 */
export default function Share() {
  return (
    <div className="grid-2 share">
      <Export />
      <Receive />
    </div>
  );
}
