import { ArrowRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../app/i18n';

/**
 * The bubble of a word that has a concept card: the concept, its one-line
 * definition, and the way to the card. Nothing else, never a guess.
 */
export function Bubble({ anchor, title, text, href, onClose }: { anchor: HTMLElement; title: string; text: string; href: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const box = ref.current?.getBoundingClientRect();
    const w = box?.width ?? 320;
    const h = box?.height ?? 120;
    const below = r.bottom + 8 + h < window.innerHeight;
    setPos({ top: below ? r.bottom + 8 : r.top - 8 - h, left: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) });
  }, [anchor, text]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = () => { timer = setTimeout(onClose, 220); };
    const stay = () => { if (timer) clearTimeout(timer); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus(); } };
    const away = (e: Event) => { const n = e.target as Node; if (!ref.current?.contains(n) && !anchor.contains(n)) onClose(); };
    anchor.addEventListener('mouseleave', leave);
    anchor.addEventListener('mouseenter', stay);
    anchor.addEventListener('blur', leave);
    ref.current?.addEventListener('mouseleave', leave);
    ref.current?.addEventListener('mouseenter', stay);
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', away);
    window.addEventListener('scroll', onClose, true);
    anchor.setAttribute('aria-expanded', 'true');
    const box = ref.current;
    return () => {
      if (timer) clearTimeout(timer);
      anchor.removeEventListener('mouseleave', leave);
      anchor.removeEventListener('mouseenter', stay);
      anchor.removeEventListener('blur', leave);
      box?.removeEventListener('mouseleave', leave);
      box?.removeEventListener('mouseenter', stay);
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', onClose, true);
      anchor.removeAttribute('aria-expanded');
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className="bubble" role="dialog" aria-label={title} style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      <h4><span className="cat-emoji" aria-hidden="true">💡</span>{title}</h4>
      <p>{text}</p>
      <a href={href} onClick={onClose}>{t('app.bubble.read')} <ArrowRight size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /></a>
    </div>
  );
}
