import type { CSSProperties } from 'react';

/** A score out of 100 as a ring filled to it, the number inside. */
export function Ring({ score, tone, label }: { score: number; tone: string; label?: string }) {
  return <span className="ring" style={{ '--v': score, '--ring': tone } as CSSProperties} role="img" aria-label={label ?? `${score} / 100`}><span className="num">{score}</span></span>;
}
