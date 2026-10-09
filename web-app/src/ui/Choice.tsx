import { Star } from 'lucide-react';
import type { ReactNode } from 'react';

/** One option among a few, as a card: its name, what it means, the recommended one starred. */
export function Choice({ on, title, text, onClick, star = false, disabled = false }: { on: boolean; title: ReactNode; text?: ReactNode; onClick?: () => void; star?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`choice${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <span className="choice-dot" aria-hidden="true" />
      <span className="choice-text"><b>{title}{star ? <Star size={13} className="choice-star" aria-hidden="true" /> : null}</b>{text ? <small>{text}</small> : null}</span>
    </button>
  );
}

/** On or off. */
export function Switch({ on, onChange, label, disabled = false }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!on)}><span aria-hidden="true" /></button>;
}
