import { AlertTriangle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../app/api';
import { useT } from '../app/i18n';

/** Something went wrong: the server's own words, and a way to try again. */
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useT();
  const e = error instanceof ApiError ? error : null;
  const offline = e?.status === 0;
  return (
    <div className="notice err" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="stack" style={{ gap: 4 }}>
        <strong>{offline ? t('app.error.offline.title') : e?.title ?? t('app.error.title')}</strong>
        <span>{offline ? t('app.error.offline.why') : e?.message || String((error as Error)?.message ?? error)}</span>
        {e?.fix ? <span>{e.fix}</span> : null}
        {retry ? <span><button type="button" className="btn sm" onClick={retry}><RotateCw size={14} aria-hidden="true" />{t('app.retry')}</button></span> : null}
      </div>
    </div>
  );
}

export function Empty({ title, children, action, icon, center = false }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode; center?: boolean }) {
  return (
    <div className={`empty${center ? ' center' : ''}`}>
      {icon ? <span className="empty-icon" aria-hidden="true">{icon}</span> : null}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const t = useT();
  return (
    <div className="stack" style={{ padding: 'var(--s4) var(--s5)' }} aria-busy="true" aria-label={t('app.loading')}>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" style={{ width: `${85 - ((i * 13) % 40)}%` }} />)}
    </div>
  );
}
