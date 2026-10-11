import { useLayoutEffect, useRef } from 'react';
import { drawDiagrams, dropCrumbLine, normalizeNoteHeadings, wireLinks } from './enhance';

/** Server-rendered, sanitized note HTML, drawn as the reader draws it (links, diagrams), without the reader's extras. */
export function Prose({ html, dropTitle = false, className = 'prose' }: { html: string; dropTitle?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    dropCrumbLine(el);
    normalizeNoteHeadings(el, dropTitle);
    wireLinks(el);
    void drawDiagrams(el);
  }, [html, dropTitle]);
  return <div ref={ref} className={className} />;
}
