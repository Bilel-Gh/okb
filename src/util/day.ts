/**
 * A day, `YYYY-MM-DD`, as the person lives it: in their own time zone. A line
 * written at one in the morning belongs to that day, not to the day before
 * (which is what the UTC date would say east of Greenwich).
 */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The same local day, `days` later (or earlier). */
export function shiftDay(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

/** The first instant of a local day, as an ISO timestamp. */
export function startOfDay(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}
