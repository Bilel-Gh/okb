import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, File as FileIcon, FileText, Image as ImageIcon, Lock, LockOpen, Music, Paperclip, Search } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { toast } from '../app/toast';
import { KeepFileButton, useKeepFiles } from '../ui/KeepFile';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';

export type Doc = {
  id: string; path: string; title: string; mime: string; size: number; projectId: string | null; notePath: string | null;
  secret: boolean; textRead: boolean; addedAt: string; snippet: string;
};
type ProjectRef = { id: string; title: string };

const size = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1000))} ko`);
function DocIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith('image/') ? ImageIcon : mime.startsWith('audio/') || mime.startsWith('video/') ? Music : mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document') ? FileText : FileIcon;
  return <span className="cat sm" aria-hidden="true"><Icon size={14} /></span>;
}

/** A list of documents: open the file, see what matched, tie it to a project, make it 🔒. */
export function DocumentRows({ docs, projects, showProject = true }: { docs: readonly Doc[]; projects?: readonly ProjectRef[]; showProject?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (patch: { id: string; secret?: boolean; project?: string | null }) => post('/api/document/update', patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['documents'] }),
    onError: (e) => toast((e as Error).message, 'err'),
  });
  // The computer may have nothing to open a file with: the row then says where it is.
  const [unopened, setUnopened] = useState<{ id: string; file: string } | null>(null);
  const open = (id: string) => {
    post<{ ok: boolean; file: string }>('/api/document/open', { id }).then((r) => setUnopened(r.ok ? null : { id, file: r.file }), (e: Error) => toast(e.message, 'err'));
  };
  const date = (iso: string) => new Date(iso).toLocaleDateString(t.lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const titleOf = (id: string | null) => projects?.find((p) => p.id === id)?.title;
  return (
    <ul className="rows doc-rows">
      {docs.map((d) => (
        <li key={d.id}>
          <DocIcon mime={d.mime} />
          <span className="grow">
            <button type="button" className="title" onClick={() => open(d.id)} title={t('app.docs.open')}>{d.title}</button>
            <span className="meta">{[showProject ? titleOf(d.projectId) : null, size(d.size), date(d.addedAt), d.textRead ? null : t('app.docs.noText')].filter(Boolean).join(' · ')}</span>
            {d.snippet ? <span className="doc-snippet">{d.snippet}</span> : null}
            {unopened?.id === d.id ? <span className="doc-where" role="status">{t('app.docs.openFailed')} <code>{unopened.file}</code></span> : null}
          </span>
          <span className="actions">
            {showProject && projects?.length ? (
              <select className="select sm" value={d.projectId ?? ''} aria-label={t('app.docs.project', { title: d.title })} onChange={(e) => update.mutate({ id: d.id, project: e.target.value || null })}>
                <option value="">{t('app.docs.noProject')}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            ) : null}
            <button type="button" className={`btn sm ghost icon${d.secret ? ' on' : ''}`} aria-pressed={d.secret} aria-label={t(d.secret ? 'app.docs.unlock' : 'app.docs.lock', { title: d.title })} title={t(d.secret ? 'app.docs.unlockShort' : 'app.docs.lockShort')} onClick={() => update.mutate({ id: d.id, secret: !d.secret })}>
              {d.secret ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
            </button>
            <button type="button" className="btn sm ghost icon" aria-label={t('app.docs.openTitle', { title: d.title })} title={t('app.docs.open')} onClick={() => open(d.id)}><ExternalLink size={14} aria-hidden="true" /></button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Documents({ initialQuery = '' }: { initialQuery?: string } = {}) {
  const t = useT();
  const [q, setQ] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [over, setOver] = useState(false);
  useEffect(() => { setQ(initialQuery); }, [initialQuery]);
  useEffect(() => { const id = setTimeout(() => setQuery(q.trim()), 200); return () => clearTimeout(id); }, [q]);
  const docs = useQuery({ queryKey: ['documents', query], queryFn: () => get<{ documents: Doc[] }>('/api/documents', query ? { query } : {}) });
  const projects = useQuery({ queryKey: ['projects', 'open'], queryFn: () => get<{ projects: ProjectRef[] }>('/api/projects'), staleTime: 30_000 });
  const keep = useKeepFiles();
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); const files = [...e.dataTransfer.files]; if (files.length) keep.mutate(files); };
  const list = docs.data?.documents ?? [];
  return (
    <div className="page" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div className="page-head">
        <label className="doc-search"><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('app.docs.search')} aria-label={t('app.docs.search')} /></label>
        <span className="spacer" />
        <KeepFileButton />
      </div>
      <p className="page-intro">{t('app.docs.intro')}</p>
      {over ? <p className="notice" role="status"><Paperclip size={16} aria-hidden="true" />{t('app.docs.dropHere')}</p> : null}
      {docs.isLoading ? <SkeletonRows rows={4} /> : docs.error ? <ErrorState error={docs.error} retry={() => void docs.refetch()} /> : list.length ? (
        <section className="panel"><DocumentRows docs={list} projects={projects.data?.projects} /></section>
      ) : (
        <section className="panel"><Empty icon={<Paperclip size={22} />} title={t(query ? 'app.docs.noneFound' : 'app.docs.emptyTitle')}>{query ? t('app.docs.noneFoundText', { q: query }) : t('app.docs.emptyText')}</Empty></section>
      )}
    </div>
  );
}
