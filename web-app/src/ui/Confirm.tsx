import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';
import { useT } from '../app/i18n';

/**
 * Ask before something that changes the brain or cannot be taken back: a
 * centred card with the consequences, and an optional reason to type.
 */
export function ConfirmDialog({ open, onOpenChange, title, children, confirm, danger = false, input, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; children?: ReactNode; confirm: string; danger?: boolean;
  input?: { label: string; placeholder?: string }; onConfirm: (value: string) => void | Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await onConfirm(value); onOpenChange(false); setValue(''); } finally { setBusy(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
          {children ? <div className="muted">{children}</div> : null}
          {input ? (
            <div className="field">
              <label htmlFor="confirm-input">{input.label}</label>
              <input id="confirm-input" className="input" value={value} placeholder={input.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} autoFocus />
            </div>
          ) : null}
          <div className="dialog-actions">
            <Dialog.Close asChild><button type="button" className="btn ghost">{t('web.cancel')}</button></Dialog.Close>
            <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} aria-busy={busy} onClick={() => void run()}>{confirm}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
