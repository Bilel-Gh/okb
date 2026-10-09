import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, CalendarCheck, Hammer, Scale, Repeat } from 'lucide-react';
import type { ReactElement } from 'react';
import { get } from '../app/api';
import { tn, useT } from '../app/i18n';

type Badge = { id: string; tier: 'none' | 'bronze' | 'silver' | 'gold'; count: number; next: number | null };
export type ProgressData = { show: false } | { show: true; xp: number; today: number; level: { level: number; from: number; to: number }; streak: { current: number; best: number }; badges: Badge[] };

export function useProgress() {
  return useQuery({ queryKey: ['progress'], queryFn: () => get<ProgressData>('/api/progress'), staleTime: 60_000 });
}

/** The level: its number, a bar to the next one, and today's experience. */
export function ProgressLine({ data }: { data: Extract<ProgressData, { show: true }> }) {
  const t = useT();
  const { level, from, to } = data.level;
  const k = Math.max(0, Math.min(1, (data.xp - from) / Math.max(1, to - from)));
  const label = t('app.progress.xp', { xp: data.xp, left: to - data.xp, next: level + 1 });
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <div className="progress" role="meter" aria-valuemin={from} aria-valuemax={to} aria-valuenow={data.xp} aria-label={label}>
        <span className="pill accent num" aria-hidden="true">{t('app.progress.level', { level })}</span>
        <span className="progress-track" aria-hidden="true"><span className="progress-fill" style={{ width: `${Math.round(k * 100)}%` }} /></span>
        <span className="xs muted num" aria-hidden="true">{data.xp} / {to} XP</span>
      </div>
      <p className="small muted">{t('app.progress.today', { xp: data.today })} · {tn(t, 'app.progress.streak', data.streak.current)}</p>
    </div>
  );
}

const ICONS: Record<string, ReactElement> = {
  reader: <BookOpen size={18} aria-hidden="true" />, reviewer: <Repeat size={18} aria-hidden="true" />, decider: <Scale size={18} aria-hidden="true" />,
  builder: <Hammer size={18} aria-hidden="true" />, streak: <CalendarCheck size={18} aria-hidden="true" />,
};

export function Badges({ badges }: { badges: Badge[] }) {
  const t = useT();
  return (
    <ul className="badges">
      {badges.map((b) => (
        <li key={b.id} className={`badge-item tier-${b.tier}`}>
          <span className="badge-icon">{ICONS[b.id] ?? <Award size={18} aria-hidden="true" />}</span>
          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
            <strong className="small">{t(`progress.badge.${b.id}`)}</strong>
            <span className="xs muted">{t(`app.progress.tier.${b.tier}`)} · {b.next ? t('app.progress.next', { count: b.count, next: b.next }) : t('app.progress.gold', { count: b.count })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
