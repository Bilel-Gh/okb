import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, ExternalLink, History, Lock, MoreHorizontal, Pin, PinOff, Share2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { get, post } from '../app/api';
import { rememberNote, useCategories } from '../app/data';
import { tn, useT } from '../app/i18n';
import { isPinned, togglePin, usePins } from '../app/pins';
import { go, hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { Breadcrumb } from '../ui/Breadcrumb';
import { CatIcon } from '../ui/CatMark';
import { ErrorState, SkeletonRows } from '../ui/States';
import { ConceptBubbles } from './Bubble';
import { dropCrumbLine, drawDiagrams, markTerms, outline, wireLinks, type OutlineItem, type Term } from './enhance';
import { LocalGraph } from './LocalGraph';
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
    <div className="stack" style={{ gap: 10 }}>
      <h3 className="links-title">{title} <span className="muted num">{items.length}</span></h3>
      <ul className="link-chips">
        {items.slice(0, 40).map((b) => (
          <li key={b.path} style={{ '--c': cats.color(b.category) } as CSSProperties}>
            <a className="chip" href={hrefFor({ name: 'brain', path: b.path })} title={cats.label(b.category)}><CatIcon id={b.category} emoji={cats.emoji(b.category)} size={13} />{b.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The note's type, and a menu to give it another one: a proposal, approved like any change. */
function TypeMenu({ path, category }: { path: string; category: string }) {
  const t = useT();
  const cats = useCategories();
  const [open, setOpen] = useState(false);
  const pick = async (id: string) => {
    setOpen(false);
    try {
      const r = await post<{ proposalId: string }>('/api/categories/set', { path, category: id });
      toast(t('web.categories.changeProposed'));
      if (r.proposalId) go({ name: 'inbox', tab: 'proposals', id: r.proposalId });
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="pill tint type-pill" style={{ '--c': cats.color(category) } as CSSProperties} title={t('web.categories.change')}>
          <CatIcon id={category} emoji={cats.emoji(category)} size={13} />{cats.label(category)}<ChevronDown size={12} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu" align="start" sideOffset={6} aria-label={t('web.categories.change')}>
          <p className="menu-heading">{t('web.categories.change')}</p>
          {cats.list.map((c) => (
            <button type="button" key={c.id} role="menuitemradio" aria-checked={c.id === category} onClick={() => c.id !== category && pick(c.id)}>
              <span className="cat xs" style={{ '--c': cats.color(c.id) } as CSSProperties}><CatIcon id={c.id} emoji={c.emoji} size={11} /></span>
              <span style={{ flex: 1 }}>{c.label[t.lang]}</span>{c.id === category ? <Check size={15} aria-hidden="true" /> : null}
            </button>
          ))}
          <hr />
          <button type="button" onClick={() => pick('auto')}><Sparkles size={15} aria-hidden="true" />{t('web.categories.auto')}</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Reader({ path, anchor, setTitle }: { path: string; anchor?: string; setTitle: (s: string) => void }) {
  const t = useT();
  const note = useQuery({ queryKey: ['note', path], queryFn: () => get<NoteView>('/api/note', { path }) });
  const article = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<OutlineItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [translated, setTranslated] = useState<{ html: string; lang: string } | null>(null);
  const [rated, setRated] = useState<'up' | 'down' | null>(null);
  const pins = usePins();

  useEffect(() => { setTranslated(null); setRated(null); }, [path]);
  useEffect(() => {
    if (!note.data) return;
    setTitle(note.data.title);
    rememberNote({ path: note.data.path, title: note.data.title, category: note.data.category });
  }, [note.data, setTitle]);

  // The server's sanitized HTML, then the live reader on top of it; the title is drawn above, with the note's facts.
  useLayoutEffect(() => {
    const el = article.current;
    if (!el || !note.data) return;
    el.innerHTML = translated?.html ?? note.data.html;
    dropCrumbLine(el);
    if (el.firstElementChild?.tagName === 'H1') el.firstElementChild.remove();
    wireLinks(el);
    markTerms(el, note.data.terms);
    setToc(outline(el));
    void drawDiagrams(el);
    if (anchor) {
      const target = [...el.querySelectorAll('h1, h2, h3, h4')].find((h) => (h.textContent ?? '').toLowerCase().includes(anchor.toLowerCase()));
      target?.scrollIntoView({ block: 'start' });
    } else el.closest('.ex-reader')?.scrollTo({ top: 0 });
  }, [note.data, translated, anchor]);

  // The table of contents follows the reading.
  useEffect(() => {
    const el = article.current;
    if (!el || toc.length < 3 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { root: el.closest('.ex-reader'), rootMargin: '0px 0px -70% 0px' });
    for (const o of toc) { const h = document.getElementById(o.id); if (h) io.observe(h); }
    return () => io.disconnect();
  }, [toc]);

  const rate = async (verdict: 'up' | 'down') => {
    try { await post('/api/rate', { path, verdict }); setRated(verdict); toast(t('scores.rated')); } catch (e) { toast((e as Error).message, 'err'); }
  };

  if (note.isLoading) return <div className="reader-wrap"><div className="reader-main"><SkeletonRows rows={12} /></div></div>;
  if (note.error || !note.data) return <ErrorState error={note.error} retry={() => void note.refetch()} />;
  const n = note.data;
  const stops = [...n.crumbs.map((c) => ({ title: c.title, href: c.path ? hrefFor({ name: 'brain', path: c.path }) : null })), { title: n.title }];
  const scoreWhy = n.score ? [`${t('web.score.quality')} ${n.score.quality}/100`, `${t('web.score.value')} ${n.score.value}/100`, ...(n.score.young ? [t('web.score.young')] : []), ...n.score.notes].join('\n') : '';

  return (
    <div className="reader-wrap">
      <article className="reader-main">
        <Breadcrumb stops={stops} label={t('app.note.line')} />
        <h1 className="note-title">{n.title}</h1>
        {n.description && !/^Page du sujet|^Topic page/i.test(n.description) ? <p className="note-lead">{n.description}</p> : null}
        <div className="note-meta">
          <TypeMenu path={n.path} category={n.category} />
          {n.status === 'draft' ? <span className="pill warn">{t('app.note.draft')}</span> : n.status === 'stable' ? <span className="pill ok"><Check size={13} aria-hidden="true" />{t('app.note.stable')}</span> : null}
          {n.confidentiality === 'secret' ? <span className="pill err" title={t('web.notes.secretHint')}><Lock size={12} aria-hidden="true" />{t('web.notes.secret')}</span> : null}
          {n.sources ? <span className="pill">{tn(t, 'app.note.sources', n.sources)}</span> : null}
          {n.score ? <span className="pill" title={scoreWhy}>{t('app.note.quality', { n: n.score.quality })}</span> : null}
          <span className="spacer" />
          <span className="note-actions">
            <button type="button" className={`btn sm ghost icon${rated === 'up' ? ' on' : ''}`} aria-pressed={rated === 'up'} aria-label={t('web.score.up')} title={t('web.score.up')} onClick={() => void rate('up')}><ThumbsUp size={15} aria-hidden="true" /></button>
            <button type="button" className={`btn sm ghost icon${rated === 'down' ? ' on' : ''}`} aria-pressed={rated === 'down'} aria-label={t('web.score.down')} title={t('web.score.down')} onClick={() => void rate('down')}><ThumbsDown size={15} aria-hidden="true" /></button>
            <button type="button" className={`btn sm ghost icon${isPinned(pins, n.path) ? ' on' : ''}`} aria-pressed={isPinned(pins, n.path)} aria-label={isPinned(pins, n.path) ? t('app.note.unpin') : t('app.note.pin')} title={isPinned(pins, n.path) ? t('app.note.unpin') : t('app.note.pin')}
              onClick={() => toast(togglePin({ path: n.path, title: n.title, category: n.category }) ? t('app.note.pinned') : t('app.note.unpinned'))}>
              {isPinned(pins, n.path) ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
            </button>
            <Translate path={n.path} onShow={setTranslated} shown={translated?.lang ?? null} />
            <a className="btn sm ghost icon" href={hrefFor({ name: 'graph', focus: n.path })} aria-label={t('web.graph.see')} title={t('web.graph.see')}><Share2 size={15} aria-hidden="true" /></a>
            <Popover.Root>
              <Popover.Trigger asChild><button type="button" className="btn sm ghost icon" aria-label={t('app.note.more')} title={t('app.note.more')}><MoreHorizontal size={16} aria-hidden="true" /></button></Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="menu" align="end" sideOffset={6}>
                  <a href={hrefFor({ name: 'brain', path: n.path, history: true })}><History size={15} aria-hidden="true" />{t('web.notes.versions')}</a>
                  <button type="button" onClick={() => { post('/api/open', { path: n.path }).catch((e: Error) => toast(e.message, 'err')); }}><ExternalLink size={15} aria-hidden="true" />{t('web.notes.openObsidian')}</button>
                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(n.path).then(() => toast(t('app.note.copied'))); }}><Copy size={15} aria-hidden="true" />{t('app.note.copyPath')}</button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </span>
        </div>
        {translated ? <p className="notice info small" role="status">{t('app.translate.showing', { lang: translated.lang.toUpperCase() })} <button type="button" className="btn sm ghost" onClick={() => setTranslated(null)}>{t('app.translate.original')}</button></p> : null}
        <div ref={article} className="prose" lang={translated?.lang} />
        {n.backlinks.length || n.outlinks.length ? (
          <footer className="reader-links">
            <Links title={t('web.notes.backlinks')} items={n.backlinks} />
            <Links title={t('web.notes.outlinks')} items={n.outlinks} />
          </footer>
        ) : null}
        <LocalGraph path={n.path} />
      </article>
      {toc.length >= 3 ? (
        <nav className="reader-toc" aria-label={t('web.notes.onThisPage')}>
          <p>{t('web.notes.onThisPage')}</p>
          {toc.map((o) => <a key={o.id} className={`${o.level === 3 ? 'l3' : ''}${active === o.id ? ' on' : ''}`} href={`#${o.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(o.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>{o.text}</a>)}
        </nav>
      ) : null}
      <ConceptBubbles key={`${n.path}|${translated?.lang ?? ''}`} root={article} terms={n.terms} />
    </div>
  );
}
