import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookMarked, ChevronRight, FileStack, ListChecks, Settings2, Share2, Sparkles, Tags, Terminal, TriangleAlert, Upload } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { get, post } from '../app/api';
import { useCategories } from '../app/data';
import { tn, useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { CatIcon } from '../ui/CatMark';
import { Choice } from '../ui/Choice';
import { PageTabs } from '../ui/PageTabs';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { TypeMark } from '../ui/TypeMark';

type Setting = { key: string; value: unknown };
type Template = { id: string; category: string; label: string; when: string; folder: string; sections: { emoji: string; heading: string; required: boolean; guide: string }[] };
type Templates = { templates: Template[]; style: Record<string, unknown>; brief: string };
type Candidate = { path: string; title: string; type: string; steps?: number };
type Draft = { name: string; content: string; counts: { steps: number } };

/* ================================================================ add a source */

function Source() {
  const t = useT();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: Setting[] }>('/api/settings') });
  const needsTemplate = settings.data?.settings.find((x) => x.key === 'kb.requireTemplate')?.value === true;
  const [src, setSrc] = useState('');
  const [mode, setMode] = useState<'claude' | 'digest'>('claude');
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: 'claude'; blocks: number; claude: string } | { kind: 'digest'; id: string } | null>(null);
  const run = async () => {
    if (!src.trim()) return;
    setBusy(true);
    try {
      if (mode === 'claude') {
        const out = await post<{ blocks: number; claude: string }>('/api/source', { source: src.trim(), mode: 'capture' });
        setDone({ kind: 'claude', blocks: out.blocks, claude: out.claude });
      } else {
        const out = await post<{ proposalId: string }>('/api/source', { source: src.trim(), mode: 'digest', path: target.trim() || 'notes/import.md', title: title.trim() });
        setDone({ kind: 'digest', id: out.proposalId });
      }
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="page-intro">{t('web.source.lead')}</p>
      <section className="panel">
        <div className="panel-body stack lg" style={{ paddingTop: 20 }}>
          <div className="field">
            <label htmlFor="src">{t('web.source.label')}</label>
            <input id="src" className="input lg" value={src} onChange={(e) => setSrc(e.target.value)} placeholder={t('web.source.placeholder')} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
            <small>{t('web.source.help')}</small>
          </div>
          <div className="choices">
            <Choice on={mode === 'claude'} title={t('web.source.withClaude')} text={t('web.source.withClaudeText')} star onClick={() => setMode('claude')} />
            <Choice on={mode === 'digest'} title={t('web.source.digest')} text={needsTemplate ? t('web.source.digestNeedsTemplate') : t('web.source.digestText')} disabled={needsTemplate} onClick={() => setMode('digest')} />
          </div>
          {mode === 'digest' ? (
            <div className="grid-even">
              <div className="field"><label htmlFor="src-target">{t('web.source.target')}</label><input id="src-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="guides/ma-note.md" /></div>
              <div className="field"><label htmlFor="src-title">{t('web.source.noteTitle')}</label><input id="src-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('web.source.titlePlaceholder')} /></div>
            </div>
          ) : null}
          <div className="row"><span className="spacer" /><button type="button" className="btn primary" disabled={!src.trim() || busy} aria-busy={busy} onClick={() => void run()}><Upload size={16} aria-hidden="true" />{t('web.source.go')}</button></div>
        </div>
      </section>
      {done?.kind === 'claude' ? <div className="notice ok"><Sparkles size={18} aria-hidden="true" /><div className="stack" style={{ gap: 8 }}><span>{t('web.source.readyClaude', { blocks: done.blocks })}</span><code className="cmd"><Terminal size={13} aria-hidden="true" />{done.claude}</code></div></div> : null}
      {done?.kind === 'digest' ? <div className="notice ok"><Sparkles size={18} aria-hidden="true" /><span className="grow">{t('web.source.readyDigest')}</span><a className="btn sm primary" href={hrefFor({ name: 'inbox', tab: 'proposals', id: done.id })}>{t('web.review.open')}<ArrowRight size={14} aria-hidden="true" /></a></div> : null}
    </>
  );
}

/* ================================================================ procedures → skills */

function Skills() {
  const t = useT();
  const list = useQuery({ queryKey: ['skillify'], queryFn: () => get<{ candidates: Candidate[] }>('/api/skillify') });
  const [path, setPath] = useState<string | null>(null);
  const [dir, setDir] = useState('');
  const draft = useQuery({ queryKey: ['skillify', path], queryFn: () => get<{ draft: Draft }>('/api/skillify', { path: path! }), enabled: Boolean(path) });
  const write = async () => {
    if (!path || !dir.trim() || !draft.data) return;
    try { const out = await post<{ path: string }>('/api/skillify', { path, dir: dir.trim() }); toast(t('skillify.written', { path: out.path, steps: draft.data.draft.counts.steps })); } catch (e) { toast((e as Error).message, 'err'); }
  };
  if (list.isLoading) return <SkeletonRows rows={4} />;
  if (list.error) return <ErrorState error={list.error} retry={() => void list.refetch()} />;
  return (
    <>
      <p className="page-intro">{t('web.skills.lead')}</p>
      {!list.data?.candidates.length ? <section className="panel"><Empty icon={<ListChecks size={22} />} title={t('err.skillifyNoNotes.title')}>{t('err.skillifyNoNotes.fix')}</Empty></section> : (
        <div className="split">
          <section className="panel">
            <ul className="rows tight">
              {list.data.candidates.map((c) => (
                <li key={c.path} className="link-row">
                  <a href="#" aria-current={path === c.path ? 'true' : undefined} className={path === c.path ? 'on' : undefined} onClick={(e) => { e.preventDefault(); setPath(c.path); }}>
                    <TypeMark id="howto" size="sm" /><span className="grow"><span className="title">{c.title}</span><span className="meta">{c.path}</span></span><ChevronRight size={15} className="muted" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            {!path ? <Empty title={t('skillify.pick')} /> : draft.isLoading ? <SkeletonRows rows={8} /> : draft.data ? (
              <div className="panel-body stack lg" style={{ paddingTop: 20 }}>
                <div className="row"><h2 className="grow">{draft.data.draft.name}</h2><span className="pill accent">{draft.data.draft.counts.steps} {t('web.skills.steps')}</span></div>
                <pre className="code-block">{draft.data.draft.content}</pre>
                <p className="notice plain small">{t('skillify.reviewTip')}</p>
                <div className="field"><label htmlFor="skill-dir">{t('skillify.where')}</label><input id="skill-dir" className="input" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/chemin/du/projet/.claude/skills" /><small>{t('web.skills.whereHelp')}</small></div>
                <div className="row"><span className="spacer" /><button type="button" className="btn primary" disabled={!dir.trim()} onClick={() => void write()}>{t('web.skills.write')}</button></div>
              </div>
            ) : <ErrorState error={draft.error} />}
          </section>
        </div>
      )}
    </>
  );
}

/* ================================================================ templates and style */

function Templates() {
  const t = useT();
  const cats = useCategories();
  const r = useQuery({ queryKey: ['templates'], queryFn: () => get<Templates>('/api/templates') });
  if (r.isLoading) return <SkeletonRows rows={6} />;
  if (r.error || !r.data) return <ErrorState error={r.error} retry={() => void r.refetch()} />;
  const d = r.data;
  const value = (k: string, v: unknown) => (k === 'language' ? t(`app.lang.${String(v)}`) : t.has(`web.style.v.${String(v)}`) ? t(`web.style.v.${String(v)}`) : String(v));
  return (
    <>
      <p className="page-intro">{t('web.templates.lead')}</p>
      <section className="panel">
        <div className="panel-head"><h2><Sparkles size={17} aria-hidden="true" />{t('web.templates.style')}</h2><a className="link" href={hrefFor({ name: 'settings' })}>{t('web.templates.change')}</a></div>
        <div className="panel-body stack">
          <div className="row wrap">{Object.entries(d.style).filter(([k]) => k !== 'instructions').map(([k, v]) => <span key={k} className="pill"><span className="muted">{t.has(`web.style.k.${k}`) ? t(`web.style.k.${k}`) : k} ·</span> {value(k, v)}</span>)}</div>
          <details className="fold"><summary><ChevronRight size={15} className="fold-chev" aria-hidden="true" /><b>{t('web.templates.brief')}</b></summary><pre className="code-block">{d.brief}</pre></details>
        </div>
      </section>
      {cats.list.map((c) => {
        const items = d.templates.filter((tp) => tp.category === c.id);
        if (!items.length) return null;
        return (
          <section key={c.id} className="stack" style={{ '--c': cats.color(c.id) } as CSSProperties}>
            <div className="row" style={{ gap: 10 }}><TypeMark id={c.id} size="sm" /><h2 className="section-title">{c.label[t.lang]}</h2><span className="small muted clip">{c.description?.[t.lang]}</span></div>
            <ul className="grid-cards template-cards">
              {items.map((tp) => (
                <li key={tp.id} className="panel">
                  <div className="panel-head"><h3>{tp.label}</h3><span className="xs muted" style={{ marginLeft: 'auto' }}>{tp.folder}/</span></div>
                  <div className="panel-body stack" style={{ gap: 10 }}>
                    <p className="small muted">{tp.when}</p>
                    <ol className="sections">{tp.sections.map((s) => <li key={s.heading} title={s.guide}>{s.heading}{s.required ? <span className="req" aria-label={t('app.tools.required')}>*</span> : null}</li>)}</ol>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/* ================================================================ categories */

type CatsData = { categories: { id: string; count: number; templates: { id: string; label: string; folder: string }[] }[]; uncategorized: { path: string; title: string }[] };

function Categories() {
  const t = useT();
  const cats = useCategories();
  const r = useQuery({ queryKey: ['categories-full'], queryFn: () => get<CatsData>('/api/categories') });
  if (r.isLoading) return <SkeletonRows rows={6} />;
  if (r.error || !r.data) return <ErrorState error={r.error} retry={() => void r.refetch()} />;
  const list = r.data.categories.filter((c) => c.id !== 'other' || c.count);
  const total = list.reduce((n, c) => n + c.count, 0);
  const only = (id: string) => {
    try { const k = 'okb-graph-prefs-v3'; const p = JSON.parse(localStorage.getItem(k) ?? '{}') as { hidden?: string[] }; p.hidden = list.filter((x) => x.id !== id).map((x) => x.id); localStorage.setItem(k, JSON.stringify(p)); } catch { /* private window */ }
    go({ name: 'graph' });
  };
  return (
    <>
      <p className="page-intro">{t('web.categories.lead')}</p>
      {total ? (
        <section className="panel"><div className="panel-body stack" style={{ paddingTop: 18 }}>
          <div className="row"><b className="grow">{tn(t, 'web.graph.notes', total)}</b><a className="btn sm" href={hrefFor({ name: 'graph' })}><Share2 size={14} aria-hidden="true" />{t('web.categories.seeGraph')}</a></div>
          <div className="typebar">{list.filter((c) => c.count).map((c) => <span key={c.id} style={{ '--c': cats.color(c.id), flex: c.count } as CSSProperties} title={`${cats.label(c.id)} : ${c.count}`} />)}</div>
        </div></section>
      ) : null}
      <ul className="grid-cards cat-cards">
        {list.map((c) => {
          const meta = cats.list.find((x) => x.id === c.id);
          return (
            <li key={c.id} className="panel" style={{ '--c': cats.color(c.id) } as CSSProperties}>
              <div className="panel-head"><TypeMark id={c.id} /><h3>{cats.label(c.id)}</h3><span className="pill sm num" style={{ marginLeft: 'auto' }}>{c.count}</span></div>
              <div className="panel-body stack" style={{ gap: 10 }}>
                <p className="small muted">{meta?.description?.[t.lang]}</p>
                {c.templates.length ? <div className="stack" style={{ gap: 4 }}><span className="side-label">{t('web.categories.templates')}</span>{c.templates.map((tp) => <span key={tp.id} className="row small"><FileStack size={13} className="muted" aria-hidden="true" /><span className="grow">{tp.label}</span><span className="xs muted">{tp.folder}/</span></span>)}</div> : null}
                <div className="row" style={{ gap: 14 }}>
                  {c.count ? <a className="link" href={hrefFor({ name: 'brain', query: { cat: c.id } })}><CatIcon id={c.id} emoji={cats.emoji(c.id)} size={13} /> {t('app.tools.seeNotes')}</a> : null}
                  {c.count ? <button type="button" className="link-btn small" onClick={() => only(c.id)}>{t('web.categories.onlyThese')}</button> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {r.data.uncategorized.length ? (
        <section className="panel">
          <div className="panel-head"><h2><TriangleAlert size={17} aria-hidden="true" />{tn(t, 'web.categories.uncategorized', r.data.uncategorized.length)}</h2></div>
          <div className="panel-body stack">
            <p className="small muted">{t('web.categories.uncategorizedHow')}</p>
            <ul className="rows tight panel">{r.data.uncategorized.slice(0, 20).map((n) => <li key={n.path} className="link-row"><a href={hrefFor({ name: 'brain', path: n.path })}><span className="grow title">{n.title}</span><span className="meta">{n.path}</span></a></li>)}</ul>
          </div>
        </section>
      ) : null}
      <section className="panel dashed">
        <div className="panel-head"><h2><Settings2 size={17} aria-hidden="true" />{t('web.categories.customTitle')}</h2></div>
        <div className="panel-body stack"><p className="small muted">{t('web.categories.customText')}</p><code className="cmd">.okb/categories.yaml</code></div>
      </section>
    </>
  );
}

export default function Tools({ route }: { route: Extract<Route, { name: 'tools' }> }) {
  const t = useT();
  const tab = route.tab ?? 'source';
  return (
    <div className="page">
      <PageTabs label={t('app.nav.tools')} tabs={[
        { to: { name: 'tools', tab: 'source' }, label: t('app.tools.tab.source'), current: tab === 'source', icon: Upload },
        { to: { name: 'tools', tab: 'skills' }, label: t('app.tools.tab.skills'), current: tab === 'skills', icon: ListChecks },
        { to: { name: 'tools', tab: 'templates' }, label: t('app.tools.tab.templates'), current: tab === 'templates', icon: BookMarked },
        { to: { name: 'tools', tab: 'categories' }, label: t('app.tools.tab.categories'), current: tab === 'categories', icon: Tags },
      ]} />
      {tab === 'source' ? <Source /> : tab === 'skills' ? <Skills /> : tab === 'templates' ? <Templates /> : <Categories />}
    </div>
  );
}
