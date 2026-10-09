import type { CSSProperties } from 'react';

export type Tier = 'discovery' | 'usable' | 'solid' | 'expert' | 'reference';
const ORDER: readonly Tier[] = ['discovery', 'usable', 'solid', 'expert', 'reference'];
/** Where each tier starts, in percent (src/knowledge/level.ts). */
const STARTS: Readonly<Record<Tier, number>> = { discovery: 0, usable: 20, solid: 45, expert: 70, reference: 90 };
const TICKS = ORDER.slice(1).map((t) => STARTS[t]);

/**
 * How well OKB knows a repository: a bar filled to the level in the
 * repository's product colour, a mark where each tier starts, the tier names below.
 */
export function LevelBar({ percent, tier, tiers, color, label, showLabels = true }: { percent: number; tier: Tier; tiers: Readonly<Record<Tier, string>>; color: string; label: string; showLabels?: boolean }) {
  const at = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={at} aria-label={label} style={{ '--c': color } as CSSProperties}>
      <div className="level-track" aria-hidden="true">
        <span className="level-fill" style={{ width: `${at}%` }} />
        {TICKS.map((p) => <span key={p} className={`level-tick${p <= at ? ' passed' : ''}`} style={{ left: `${p}%` }} />)}
      </div>
      {showLabels ? (
        <div className="level-labels" aria-hidden="true">
          {ORDER.map((t) => <span key={t} className={t === tier ? 'on' : undefined} style={{ left: `${STARTS[t]}%` }}>{tiers[t]}</span>)}
        </div>
      ) : null}
    </div>
  );
}
