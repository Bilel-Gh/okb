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

const WEEKDAYS: Readonly<Record<string, number>> = { dimanche: 0, sunday: 0, lundi: 1, monday: 1, mardi: 2, tuesday: 2, mercredi: 3, wednesday: 3, jeudi: 4, thursday: 4, vendredi: 5, friday: 5, samedi: 6, saturday: 6 };
const MONTHS: Readonly<Record<string, number>> = {
  janvier: 1, january: 1, fevrier: 2, february: 2, mars: 3, march: 3, avril: 4, april: 4, mai: 5, may: 5, juin: 6, june: 6,
  juillet: 7, july: 7, aout: 8, august: 8, septembre: 9, september: 9, octobre: 10, october: 10, novembre: 11, november: 11, decembre: 12, december: 12,
};

/**
 * The day a person means: « mardi », « hier », « le 14 février », « 14/02 »,
 * `2027-02-14`, in French or in English. A weekday is the last one before
 * today (today has its own word); a day and a month without a year is the
 * last one that is not in the future. Null when the words name no day.
 */
export function dayFromWords(words: string, now: Date = new Date()): string | null {
  const text = words.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’`]/g, "'");
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return Number.isNaN(Date.parse(`${iso[0]}T12:00:00Z`)) ? null : iso[0];
  if (/\bavant[- ]hier\b/.test(text)) return localDay(shiftDay(now, -2));
  if (/\b(hier|yesterday)\b/.test(text)) return localDay(shiftDay(now, -1));
  if (/\b(aujourd'?hui|today)\b/.test(text)) return localDay(now);
  const named = new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)? (${Object.keys(MONTHS).join('|')})\\b`).exec(text);
  const slashed = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  const dayMonth = named ? [Number(named[1]), MONTHS[named[2]!]!] : slashed ? [Number(slashed[1]), Number(slashed[2])] : null;
  if (dayMonth) {
    const [d, m] = dayMonth as [number, number];
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    const thisYear = new Date(now.getFullYear(), m - 1, d, 12);
    if (thisYear.getMonth() !== m - 1) return null;
    return localDay(thisYear.getTime() > now.getTime() + 86_400_000 ? new Date(now.getFullYear() - 1, m - 1, d, 12) : thisYear);
  }
  const weekday = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})\\b`).exec(text);
  if (weekday) {
    const back = ((now.getDay() - WEEKDAYS[weekday[1]!]! + 7) % 7) || 7;
    return localDay(shiftDay(now, -back));
  }
  return null;
}
