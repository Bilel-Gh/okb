import { useCategories } from '../app/data';
import { CatMark, type CatSize } from './CatMark';

/** A note type's mark, from the KB's own categories (label, colour for light or dark, icon). */
export function TypeMark({ id, size }: { id: string | undefined; size?: CatSize }) {
  const cats = useCategories();
  const key = id || 'other';
  return <CatMark id={key} color={cats.color(key)} emoji={cats.emoji(key)} label={cats.label(key)} size={size} />;
}
