import type { CSSProperties } from 'react';

export type Stop = { readonly title: string; readonly href?: string | null };

/**
 * Where a note sits, drawn as stations on its line: the brain, the drawer, the
 * subject… and the note itself, the « you are here » station.
 */
export function LineStrip({ stops, color, label }: { stops: readonly Stop[]; color: string; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="line-strip" style={{ '--line': color } as CSSProperties}>
        {stops.map((s, i) => {
          const last = i === stops.length - 1;
          const dot = <span className={`station sm${last ? ' here' : ''}`} aria-hidden="true" />;
          return (
            <li key={`${i}-${s.title}`}>
              {s.href && !last ? (
                <a href={s.href}>{dot}<span className="label">{s.title}</span></a>
              ) : (
                <span className="stop" aria-current={last ? 'location' : undefined}>{dot}<span className="label">{s.title}</span></span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
