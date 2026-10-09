import { useQuery } from '@tanstack/react-query';
import { get } from '../app/api';

type Badge = { id: string; tier: 'none' | 'bronze' | 'silver' | 'gold'; count: number; next: number | null };
export type ProgressData = { show: false } | { show: true; xp: number; today: number; level: { level: number; from: number; to: number }; streak: { current: number; best: number }; badges: Badge[] };

export function useProgress() {
  return useQuery({ queryKey: ['progress'], queryFn: () => get<ProgressData>('/api/progress'), staleTime: 60_000 });
}
