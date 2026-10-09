import { BookOpen, Compass, FileText, LifeBuoy, Lightbulb, ListChecks, MessageSquareText, Repeat, Scale, Ticket, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

/** The icon of each built-in note type; a type a KB adds itself keeps its emoji. */
export const CAT_ICONS: Readonly<Record<string, LucideIcon>> = {
  concept: Lightbulb, guide: BookOpen, howto: ListChecks, process: Repeat, case: LifeBuoy,
  ticket: Ticket, decision: Scale, source: MessageSquareText, path: Compass, other: FileText,
};

export type CatSize = 'xs' | 'sm' | 'md' | 'lg';
const ICON_PX: Readonly<Record<CatSize, number>> = { xs: 12, sm: 14, md: 17, lg: 21 };

/** A note's type: its icon in a square tinted with its colour, the same everywhere. */
export function CatMark({ id, color, emoji, label, size = 'md' }: { id: string; color: string; emoji: string; label: string; size?: CatSize }) {
  const Icon = CAT_ICONS[id];
  return (
    <span className={`cat${size === 'md' ? '' : ` ${size}`}`} style={{ '--c': color } as CSSProperties} title={label} aria-hidden="true">
      {Icon ? <Icon size={ICON_PX[size]} strokeWidth={1.9} /> : emoji}
    </span>
  );
}

/** The type's icon alone, for chips and legends. */
export function CatIcon({ id, emoji, size = 14 }: { id: string; emoji: string; size?: number }) {
  const Icon = CAT_ICONS[id];
  return Icon ? <Icon size={size} strokeWidth={1.9} aria-hidden="true" /> : <span aria-hidden="true">{emoji}</span>;
}
