import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, History, Lock, MoreHorizontal, Network } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { get, post } from '../app/api';
import { rememberNote, useCategories } from '../app/data';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { LineStrip } from '../ui/LineStrip';
import { ErrorState, SkeletonRows } from '../ui/States';
import { Bubble } from './Bubble';
import { dropCrumbLine, drawDiagrams, markTerms, outline, wireLinks, type OutlineItem, type Term } from './enhance';
import { Translate } from './Translate';

export type NoteView = {
  path: string; title: string; type: string; status: string; description: string; category: string; confidentiality: string; sources: number;
  crumbs: { title: string; path: string | null }[];
  terms: (Term & { description: string })[];
  score: { stars: number; global: number; quality: number; value: number; young: boolean; notes: string[] } | null;
  html: string;
  backlinks: { path: string; title: string; category: string }[];
  outlinks: { path: string; title: string; category: string }[];
};

function Links({ title, items }: { title: string; items: NoteView['backlinks'] }) {
  const cats = useCategories();
  if (!items.length) return null;
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <h3 className="small">{title} <span className="muted num">{items.length}</span></h3>
      <ul className="link-stations">
        {items.slice(0, 40).map((b) => (
          <li key={b.path} style={{ '--line': cats.color(b.category) } as CSSProperties}>
            <a href={hrefFor({ name: 'brain', path: b.path })}><span className="station sm" aria-hidden="true" />{b.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Reader({ path, anchor, setTitle }: { path: string; anchor?: string; setTitle: (s: string) => void }) {
  const t = useT();
  const cats = useCategories();
  const note = useQuery({ queryKey: ['note', path], queryFn: () => get<NoteView>('/api/note', { path }) });
  const article = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<OutlineItem[]>([]);
  const [translated, setTranslated] = useState<{ html: string; lang: string } | null>(null);
  const [bubble, setBubble] = useState<{ index: number; el: HTMLElement } | null>(null);

  useEffect(() => { setTranslated(null); setBubble(null); }, [path]);
  useEffect(() => {
    if (!note.data) return;
    setTitle(note.data.title);
    rememberNote({ path: note.data.path, title: note.data.title, category: note.data.category });
  }, [note.data, setTitle]);

  // The server's sanitized HTML, then the live reader on top of it.
  useLayoutEffect(() => {
    const el = article.current;
    if (!el || !note.data) return;
    el.innerHTML = translated?.html ?? note.data.html;
    dropCrumbLine(el);
    wireLinks(el);
    markTerms(el, note.data.terms);
    setToc(outline(el));
    void drawDiagrams(el);
    if (anchor) {
      const target = [...el.querySelectorAll('h1, h2, h3, h4')].find((h) => (h.textContent ?? '').toLowerCase().includes(anchor.toLowerCase()));
      target?.scrollIntoView({ block: 'start' });
    } else el.closest('.ex-reader')?.scrollTo({ top: 0 });
  }, [note.data, translated, anchor]);

  // One bubble for every marked word: on hover, on keyboard focus, on a first tap.
  useEffect(() => {
    const el = article.current;
    if (!el) return;
    const show = (e: Event) => {
      const a = (e.target as HTMLElement).closest?.('a.term') as HTMLElement | null;
      if (a) setBubble({ index: Number(a.dataset.term), el: a });
    };
    const tap = (e: Event) => {
      const a = (e.target as HTMLElement).closest?.('a.term') as HTMLElement | null;
      if (a && (e as PointerEvent).pointerType === 'touch' && bubble?.el !== a) { e.preventDefault(); setBubble({ index: Number(a.dataset.term), el: a }); }
    };
    el.addEventListener('mouseover', show);
    el.addEventListener('focusin', show);
    el.addEventListener('click', tap);
    return () => { el.removeEventListener('mouseover', show); el.removeEventListener('focusin', show); el.removeEventListener('click', tap); };
  }, [bubble]);

  if (note.isLoading) return <SkeletonRows rows={12} />;
  if (note.error || !note.data) return <ErrorState error={note.error} retry={() => void note.refetch()} />;
  const n = note.data;
  const color = cats.color(n.category);
  const stops = [...n.crumbs.map((c) => ({ title: c.title, href: c.path ? hrefFor({ name: 'brain', path: c.path }) : null })), { title: n.title }];
  const term = bubble ? n.terms[bubble.index] : null;

  return (
    <div className="reader-wrap">
      <div className="reader-main">
        <div className="reader-bar">
          <span className="line-badge" style={{ '--line': color } as CSSProperties}><span className="station sm" aria-hidden="true" />{cats.label(n.category)}</span>
          {n.status === 'draft' ? <span className="pill warn">{t('app.note.draft')}</span> : null}
          {n.confidentiality === 'secret' ? <span className="pill err"><Lock size={12} aria-hidden="true" />{t('web.notes.secret')}</span> : null}
          {n.score ? <span className="pill" title={[`${t('web.score.quality')} ${n.score.quality}/100`, `${t('web.score.value')} ${n.score.value}/100`, ...n.score.notes].join('\n')}>{t('app.note.quality', { n: n.score.quality })}</span> : null}
          <span className="spacer" />
          <Translate path={n.path} onShow={setTranslated} shown={translated?.lang ?? null} />
          <Popover.Root>
            <Popover.Trigger asChild><button type="button" className="btn sm ghost icon" aria-label={t('app.note.more')}><MoreHorizontal size={16} aria-hidden="true" /></button></Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="menu" align="end" sideOffset={6}>
                <a href={`/classic#/versions/${encodeURIComponent(n.path)}`}><History size={15} aria-hidden="true" />{t('web.notes.versions')}</a>
                <a href={`/classic#/graph?focus=${encodeURIComponent(n.path)}`}><Network size={15} aria-hidden="true" />{t('web.graph.see')}</a>
                <button type="button" onClick={() => { post('/api/open', { path: n.path }).catch((e: Error) => toast(e.message, 'err')); }}><ExternalLink size={15} aria-hidden="true" />{t('web.notes.openObsidian')}</button>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(n.path).then(() => toast(t('app.note.copied'))); }}><Copy size={15} aria-hidden="true" />{t('app.note.copyPath')}</button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <LineStrip stops={stops} color={color} label={t('app.note.line')} />
        {translated ? <p className="notice info small" role="status">{t('app.translate.showing', { lang: translated.lang.toUpperCase() })} <button type="button" className="btn sm ghost" onClick={() => setTranslated(null)}>{t('app.translate.original')}</button></p> : null}
        <article ref={article} className="prose" lang={translated?.lang} />
        <footer className="reader-links">
          <Links title={t('web.notes.backlinks')} items={n.backlinks} />
          <Links title={t('web.notes.outlinks')} items={n.outlinks} />
        </footer>
      </div>
      {toc.length > 3 ? (
        <nav className="reader-toc" aria-label={t('web.notes.onThisPage')}>
          <h2 className="xs muted">{t('web.notes.onThisPage')}</h2>
          {toc.map((o) => <a key={o.id} className={o.level === 3 ? 'l3' : undefined} href={`#${o.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(o.id)?.scrollIntoView({ block: 'start' }); }}>{o.text}</a>)}
        </nav>
      ) : null}
      {term && bubble ? <Bubble anchor={bubble.el} title={term.term} text={term.oneLiner ?? ''} href={hrefFor({ name: 'brain', path: term.path })} onClose={() => setBubble(null)} /> : null}
    </div>
  );
}
