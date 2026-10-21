import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { post } from '../../app/api';
import { useShareWords } from '../../app/sharing';
import { ORIGIN_WORDS, type FieldValue, type Importance, type Origin } from '../../app/tickets';
import { toast } from '../../app/toast';

/** Every write on the sheet refreshes the sheet and the views that read it (D70: one truth). */
export function useSheetWrite(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => post<unknown>(path, { ref, ...body }),
    onSuccess: () => { for (const key of [['sheet', ref], ['ticket', ref], ['tickets'], ['today'], ['projects'], ['actions']]) void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
}

/** The completeness ring: what we know of the ticket, not how far the work went. */
export function TkRing({ percent, size = 44, stroke = 4 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const tone = percent >= 80 ? 'var(--ok)' : percent >= 50 ? 'var(--accent)' : 'var(--warn)';
  return <span className={`tk-ring${size < 40 ? ' small' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hair)" strokeWidth={stroke} /><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * percent) / 100} ${c}`} /></svg>
    <b>{percent}</b>
  </span>;
}

/** Where a value comes from: a dot and always the word, never colour alone. */
export function Prov({ origin, at, url }: { origin: Origin; at?: string | null; url?: string | null }) {
  const w = useShareWords();
  const date = at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
  const label = <><span className={`d ${origin}`} />{w(...ORIGIN_WORDS[origin])}{date ? ` · ${date}` : ''}</>;
  return url ? <a className="tk-prov" href={url} target="_blank" rel="noreferrer">{label}</a> : <span className="tk-prov">{label}</span>;
}

/** An empty field: discreet, and one click to fill it or to ask the agent. */
export function Slot({ label, onAdd, onAsk }: { label: string; onAdd: () => void; onAsk?: () => void }) {
  const w = useShareWords();
  return <span className="tk-slot-row"><button type="button" className="tk-slot" onClick={onAdd}><Plus size={14} aria-hidden="true" />{label}</button>
    {onAsk ? <button type="button" className="tk-ask" onClick={onAsk} title={w('Demander à l’agent', 'Ask the agent')} aria-label={`${w('Demander à l’agent', 'Ask the agent')} : ${label}`}><Sparkles size={14} aria-hidden="true" /></button> : null}</span>;
}

/** Text edited where it is read. Once saved by the person, the agent never overwrites it. */
export function Editable({ value, onSave, multiline = false, maxLength, label, children, startOpen = false, onClose }: {
  value: string; onSave: (v: string) => void | Promise<void>; multiline?: boolean; maxLength: number; label: string; children?: ReactNode; startOpen?: boolean; onClose?: () => void;
}) {
  const w = useShareWords();
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState(value);
  const box = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);
  const close = () => { setOpen(false); setText(value); onClose?.(); };
  const save = async () => { const v = text.trim(); if (!v || v === value) { close(); return; } await onSave(v); setOpen(false); onClose?.(); };
  if (!open) return <button type="button" className="tk-editable" onClick={() => setOpen(true)} aria-label={`${w('Modifier', 'Edit')} : ${label}`}>{children ?? value}</button>;
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } };
  return <div className="tk-edit">
    {multiline ? <textarea ref={box} rows={3} value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} onKeyDown={keys} aria-label={label} />
      : <input ref={box} value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} onKeyDown={keys} aria-label={label} />}
    <div className="foot"><button type="button" className="btn sm primary" onClick={() => void save()}>{w('Enregistrer', 'Save')}</button><button type="button" className="btn sm ghost" onClick={close}>{w('Annuler', 'Cancel')}</button><span className="meta" style={{ marginLeft: 'auto' }}>{w('Ensuite, l’agent ne l’écrasera plus.', 'The agent will not overwrite it then.')}</span></div>
  </div>;
}

/** A field of the sheet: its value editable on the spot with its origin, or a slot when undefined. */
export function FieldLine({ field, label, value, onSave, onAsk, multiline = false, maxLength, strong }: {
  field: string; label: string; value: FieldValue | undefined; onSave: (v: string) => Promise<unknown>; onAsk?: () => void; multiline?: boolean; maxLength: number; strong?: (v: string) => ReactNode;
}) {
  const w = useShareWords();
  const [adding, setAdding] = useState(false);
  if (!value && !adding) return <Slot label={w('Ajouter', 'Add')} onAdd={() => setAdding(true)} {...(onAsk ? { onAsk } : {})} />;
  return <Editable key={field} value={value?.value ?? ''} label={label} multiline={multiline} maxLength={maxLength} startOpen={adding} onClose={() => setAdding(false)} onSave={async (v) => { await onSave(v); }}>
    {value ? <>{strong ? strong(value.value) : value.value}<Prov origin={value.origin} at={value.at} url={value.url} /></> : null}
  </Editable>;
}

const NEXT: Record<Importance, Importance> = { low: 'medium', medium: 'high', high: 'low' };
/** Importance as one to three bars, readable without colour; a click turns it. */
export function ImportanceBars({ value, onChange }: { value: Importance; onChange?: (v: Importance) => void }) {
  const w = useShareWords();
  const word = value === 'high' ? w('haute', 'high') : value === 'low' ? w('basse', 'low') : w('moyenne', 'medium');
  return <button type="button" className={`tk-imp ${value}`} onClick={() => onChange?.(NEXT[value])} title={`${w('Importance', 'Importance')} : ${word}`} aria-label={`${w('Importance', 'Importance')} : ${word}${onChange ? ` — ${w('changer', 'change')}` : ''}`} disabled={!onChange}><i /><i /><i /></button>;
}
