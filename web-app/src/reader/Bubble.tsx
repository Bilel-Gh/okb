import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { TypeMark } from '../ui/TypeMark';
import type { Term } from './enhance';

/** How long the pointer rests on a word before its bubble opens, and how long the bubble waits once left. */
const OPEN_DELAY = 140;
const CLOSE_DELAY = 220;
/** The closing fade, before the bubble leaves the page. */
const FADE = 120;
const GAP = 10;
const EDGE = 12;

type Open = { index: number; el: HTMLElement; closing: boolean };
type Place = { top: number; left: number; arrow: number; side: 'top' | 'bottom' };

const termOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? (target.closest('a.term[data-term]') as HTMLElement | null) : null;

/** The line of the word the pointer is on (a word can wrap over two lines). */
function rectOf(el: HTMLElement, y: number | null): DOMRect {
  const rects = [...el.getClientRects()];
  if (!rects.length) return el.getBoundingClientRect();
  if (y === null) return rects[0]!;
  return rects.reduce((best, r) => (Math.abs((r.top + r.bottom) / 2 - y) < Math.abs((best.top + best.bottom) / 2 - y) ? r : best));
}

/** Below the word, or above it when there is no room; always inside the window, the arrow on the word. */
function place(anchor: DOMRect, w: number, h: number): Place {
  const cx = anchor.left + anchor.width / 2;
  const left = Math.max(EDGE, Math.min(cx - w / 2, window.innerWidth - w - EDGE));
  const below = anchor.bottom + GAP + h <= window.innerHeight - EDGE || anchor.top - GAP - h < EDGE;
  return { top: below ? anchor.bottom + GAP : anchor.top - GAP - h, left, arrow: Math.max(16, Math.min(cx - left, w - 16)), side: below ? 'bottom' : 'top' };
}

/**
 * The bubbles of the words that have a concept card, for everything under
 * `root`: the concept, its one-line definition, the way to the card. It opens
 * after a short rest of the pointer (not when the pointer only crosses the
 * word), at once on keyboard focus, on a first tap on a touch screen; it
 * follows the word when the note scrolls, and fades out once left.
 */
export function ConceptBubbles({ root, terms }: { root: RefObject<HTMLElement | null>; terms: readonly Term[] }) {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout>; fade?: ReturnType<typeof setTimeout> }>({});
  const pointerY = useRef<number | null>(null);
  const touch = useRef(false);
  // The word that gets the focus back after Escape: its bubble stays closed.
  const quiet = useRef<HTMLElement | null>(null);

  const clear = useCallback((which: 'open' | 'close' | 'fade') => {
    const id = timers.current[which];
    if (id) clearTimeout(id);
    timers.current[which] = undefined;
  }, []);
  const show = useCallback((el: HTMLElement) => {
    clear('open'); clear('close'); clear('fade');
    const index = Number(el.dataset.term);
    if (!terms[index]?.oneLiner) return;
    openRef.current = { index, el, closing: false };
    setOpen(openRef.current);
  }, [clear, terms]);
  const hide = useCallback((now = false) => {
    clear('open'); clear('close');
    if (!openRef.current) return;
    const fade = () => {
      setOpen((o) => (o ? { ...o, closing: true } : o));
      timers.current.fade = setTimeout(() => setOpen(null), FADE);
    };
    if (now) fade(); else timers.current.close = setTimeout(fade, CLOSE_DELAY);
  }, [clear]);

  // The words: hover, focus, tap.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const over = (e: PointerEvent) => {
      const a = termOf(e.target);
      if (!a || e.pointerType === 'touch') return;
      pointerY.current = e.clientY ?? null;
      const current = openRef.current;
      if (current && current.el === a && !current.closing) { clear('close'); return; }
      // One bubble already open: the next word follows without waiting.
      if (current && !current.closing) { show(a); return; }
      clear('open'); clear('close');
      timers.current.open = setTimeout(() => show(a), OPEN_DELAY);
    };
    const out = (e: PointerEvent) => {
      const a = termOf(e.target);
      if (!a || e.pointerType === 'touch') return;
      const to = e.relatedTarget as Node | null;
      if (to && (a.contains(to) || document.querySelector('.bubble')?.contains(to))) return;
      clear('open');
      if (openRef.current) hide();
    };
    const focus = (e: FocusEvent) => {
      const a = termOf(e.target);
      if (!a) return;
      if (quiet.current === a) { quiet.current = null; return; }
      pointerY.current = null;
      show(a);
    };
    const blur = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (termOf(e.target) && !(to && document.querySelector('.bubble')?.contains(to))) hide();
    };
    const down = (e: PointerEvent) => { touch.current = e.pointerType === 'touch'; };
    const click = (e: MouseEvent) => {
      const a = termOf(e.target);
      if (!a || !touch.current) return;
      const current = openRef.current;
      if (current?.el === a && !current.closing) return;
      e.preventDefault();
      show(a);
    };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerout', out);
    el.addEventListener('focusin', focus);
    el.addEventListener('focusout', blur);
    el.addEventListener('pointerdown', down);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerout', out);
      el.removeEventListener('focusin', focus);
      el.removeEventListener('focusout', blur);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('click', click);
    };
  }, [root, show, hide, clear]);

  // Escape, a tap elsewhere.
  useEffect(() => {
    if (!open || open.closing) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { hide(true); quiet.current = open.el; open.el.focus(); } };
    const away = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!open.el.contains(n) && !document.querySelector('.bubble')?.contains(n)) hide(true);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', away);
    open.el.setAttribute('aria-expanded', 'true');
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', away);
      open.el.removeAttribute('aria-expanded');
    };
  }, [open, hide]);

  useEffect(() => () => { clear('open'); clear('close'); clear('fade'); }, [clear]);

  if (!open) return null;
  const term = terms[open.index];
  if (!term?.oneLiner) return null;
  return createPortal(
    <Card
      key={open.index}
      anchor={open.el}
      pointerY={pointerY.current}
      closing={open.closing}
      title={term.term}
      text={term.oneLiner}
      href={hrefFor({ name: 'brain', path: term.path })}
      onEnter={() => { clear('close'); clear('fade'); if (open.closing) setOpen({ ...open, closing: false }); }}
      onLeave={() => hide()}
      onGone={() => hide(true)}
    />,
    document.body,
  );
}

function Card({ anchor, pointerY, closing, title, text, href, onEnter, onLeave, onGone }: {
  anchor: HTMLElement; pointerY: number | null; closing: boolean; title: string; text: string; href: string;
  onEnter: () => void; onLeave: () => void; onGone: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Place | null>(null);
  const gone = useRef(onGone);
  gone.current = onGone;

  // Measured before the first paint, then kept on the word while the note scrolls or the window changes.
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      const box = ref.current;
      if (!box) return;
      const r = rectOf(anchor, pointerY);
      if (r.bottom < 0 || r.top > window.innerHeight || !anchor.isConnected) { gone.current(); return; }
      setAt(place(r, box.offsetWidth, box.offsetHeight));
    };
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', later, true); window.removeEventListener('resize', later); };
  }, [anchor, pointerY]);

  return (
    <div
      ref={ref}
      className="bubble"
      role="dialog"
      aria-label={title}
      data-side={at?.side ?? 'bottom'}
      data-state={closing ? 'closing' : 'open'}
      style={{ top: at?.top ?? -9999, left: at?.left ?? -9999, '--arrow': `${at?.arrow ?? 24}px` } as CSSProperties}
      onPointerOver={onEnter}
      onPointerOut={(e) => { if (!(e.relatedTarget instanceof Node && (ref.current?.contains(e.relatedTarget) || anchor.contains(e.relatedTarget)))) onLeave(); }}
    >
      <span className="bubble-arrow" aria-hidden="true" />
      <p className="bubble-head"><TypeMark id="concept" size="xs" /><strong>{title}</strong></p>
      <p className="bubble-text">{text}</p>
      <a className="bubble-more" href={href}>{t('app.bubble.read')}<ArrowRight size={14} aria-hidden="true" /></a>
    </div>
  );
}
