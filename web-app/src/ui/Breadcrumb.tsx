import { ChevronRight } from 'lucide-react';

export type Stop = { readonly title: string; readonly href?: string | null };

/** Where a note sits: the brain, the drawer, the subject… and the note itself. */
export function Breadcrumb({ stops, label }: { stops: readonly Stop[]; label: string }) {
  return (
    <nav aria-label={label} className="crumbs">
      <ol>
        {stops.map((s, i) => {
          const last = i === stops.length - 1;
          return (
            <li key={`${i}-${s.title}`}>
              {i ? <ChevronRight size={13} aria-hidden="true" className="crumb-sep" /> : null}
              {s.href && !last ? <a href={s.href}>{s.title}</a> : <span aria-current={last ? 'location' : undefined}>{s.title}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
