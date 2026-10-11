import * as Dialog from '@radix-ui/react-dialog';
import { Backpack } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, get, post } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';

type Draft = { title: string; text: string; removed: { text: string; kind: string }[] };

/**
 * « Garder dans mon bagage »: the note without anything of the workplace, for
 * the person to reread before it is proposed to their baggage. OKB made this
 * first version without AI; a version that still names the workplace is refused.
 */
export function KeepInBaggage({ path, open, onOpenChange }: { path: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<{ message: string; fix: string; none: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => { const err = e as ApiError; setProblem({ message: err.message || err.title, fix: err.fix ?? '', none: err.key === 'baggageNone' }); };

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDraft(null); setProblem(null);
    get<Draft>('/api/baggage/draft', { path }).then((d) => { if (live) { setDraft(d); setTitle(d.title); setText(d.text); } }, (e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [open, path]);

  const keep = async () => {
    setBusy(true); setProblem(null);
    try {
      await post('/api/baggage/keep', { path, title, text });
      toast(t('app.baggage.kept'));
      onOpenChange(false);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const removed = [...new Set((draft?.removed ?? []).map((d) => d.text))];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide" aria-describedby={undefined}>
          <Dialog.Title asChild><h2><Backpack size={18} aria-hidden="true" />{t('app.baggage.heading')}</h2></Dialog.Title>
          {problem ? <p className="notice err" role="alert">{problem.message}{problem.fix ? ` ${problem.fix}` : ''}</p> : null}
          {problem?.none ? <p><a className="btn primary" href={hrefFor({ name: 'settings', tab: 'brains' })} onClick={() => onOpenChange(false)}>{t('app.baggage.make')}</a></p> : null}
          {draft ? (
            <form className="baggage-form" onSubmit={(e) => { e.preventDefault(); void keep(); }}>
              <p className="muted small">{t('app.baggage.why')}</p>
              <label className="field"><span className="label">{t('app.baggage.title')}</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></label>
              <label className="field"><span className="label">{t('app.baggage.text')}</span><textarea className="textarea" rows={12} value={text} onChange={(e) => setText(e.target.value)} /></label>
              {removed.length ? (
                <div className="baggage-removed">
                  <p className="small muted" id="baggage-removed">{t('app.baggage.removed')}</p>
                  <ul aria-labelledby="baggage-removed">{removed.map((r) => <li key={r} className="pill">{r}</li>)}</ul>
                </div>
              ) : <p className="small muted">{t('app.baggage.nothingRemoved')}</p>}
              <div className="dialog-actions">
                <Dialog.Close asChild><button type="button" className="btn ghost">{t('web.cancel')}</button></Dialog.Close>
                <button type="submit" className="btn primary" disabled={busy || !title.trim() || !text.trim()} aria-busy={busy || undefined}>{t('app.baggage.keep')}</button>
              </div>
            </form>
          ) : !problem ? <p className="muted" role="status">{t('app.loading')}</p> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
