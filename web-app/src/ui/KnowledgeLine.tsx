import type { CSSProperties } from 'react';

export type Tier = 'discovery' | 'usable' | 'solid' | 'expert' | 'reference';
const ORDER: readonly Tier[] = ['discovery', 'usable', 'solid', 'expert', 'reference'];
/** Where each tier starts on the line, in percent (src/knowledge/level.ts). */
const STARTS: Readonly<Record<Tier, number>> = { discovery: 0, usable: 20, solid: 45, expert: 70, reference: 90 };

/**
 * How well OKB knows a repository, drawn as a line: five tier stations, the run
 * so far in the repository's colour, and the « you are here » marker.
 */
export function KnowledgeLine({ percent, tier, tiers, color, label, showLabels = true }: { percent: number; tier: Tier; tiers: Readonly<Record<Tier, string>>; color: string; label: string; showLabels?: boolean }) {
  const at = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="k-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={at} aria-label={label} style={{ '--line': color } as CSSProperties}>
      <div className="k-track" aria-hidden="true">
        <div className="k-rail" />
        <div className="k-run" style={{ '--k': at / 100 } as CSSProperties} />
        {ORDER.map((t) => (
          <span key={t} className={`k-stop${STARTS[t] <= at ? ' passed' : ''}`} style={{ left: `calc(6px + (100% - 12px) * ${STARTS[t] / 100})` }} />
        ))}
        <span className="k-here-track" style={{ '--k': at / 100 } as CSSProperties}><span className="k-here" /></span>
      </div>
      {showLabels ? <div className="k-labels" aria-hidden="true">
        {ORDER.map((t) => (
          <span key={t} className={t === tier ? 'on' : undefined} style={{ left: `${STARTS[t]}%` }}>{tiers[t]}</span>
        ))}
      </div> : null}
    </div>
  );
}
