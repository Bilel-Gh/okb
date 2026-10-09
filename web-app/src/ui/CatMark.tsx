import type { CSSProperties } from 'react';

/**
 * A note's type: its emoji in a tinted square (Classique) or its name as a tag
 * (Atelier), in the type's colour. The theme's CSS shows one or the other.
 */
export function CatMark({ color, emoji, label, small = false }: { color: string; emoji: string; label: string; small?: boolean }) {
  return (
    <span className={`cat${small ? ' sm' : ''}`} style={{ '--c': color } as CSSProperties} title={label} aria-hidden="true">
      <span className="cat-emoji">{emoji}</span>
      <span className="cat-tag">{label.toLowerCase()}</span>
    </span>
  );
}
