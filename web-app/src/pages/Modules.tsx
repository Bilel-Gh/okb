import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download } from 'lucide-react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { toast } from '../app/toast';
import { ErrorState, SkeletonRows } from '../ui/States';

type Module = {
  id: string; status: 'core' | 'available' | 'planned'; name: string; pitch: string; brings: string[]; plugin: string | null;
  enabled: boolean; entitled: boolean; claude: { installed: boolean; version: string | null } | null;
};

/** The core and one module per job: what each brings, turn it on or off, add it to Claude Code. */
export default function Modules() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['modules'], queryFn: () => get<{ modules: Module[] }>('/api/modules') });
  const toggle = useMutation({
    mutationFn: (v: { id: string; on: boolean }) => post('/api/modules/toggle', v),
    onSuccess: (_r, v) => { toast(t(v.on ? 'modules.on' : 'modules.off', { id: v.id })); void qc.invalidateQueries(); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  const install = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; steps: string[]; error?: string }>('/api/modules/install', { id }),
    onSuccess: (r, id) => { r.ok ? toast(`${t('modules.installed', { id })} ${t('modules.restart')}`) : toast(t('modules.installFailed', { error: r.error ?? '' }), 'err'); void qc.invalidateQueries({ queryKey: ['modules'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  if (q.isLoading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  return (
    <div className="page">
      <p className="muted" style={{ maxWidth: '72ch' }}>{t('app.modules.intro')}</p>
      <ul className="module-grid">
        {q.data.modules.map((m) => (
          <li key={m.id} className={`panel module${m.status === 'planned' ? ' planned' : ''}`}>
            <div className="panel-head">
              <h2>{m.name}</h2>
              <span className="spacer" />
              {m.status === 'core' ? <span className="pill ok">{t('app.modules.always')}</span> : m.status === 'planned' ? <span className="pill">{t('modules.planned')}</span> : m.enabled ? <span className="pill ok"><Check size={12} aria-hidden="true" />{t('modules.enabled')}</span> : <span className="pill">{t('modules.disabled')}</span>}
            </div>
            <div className="panel-body stack">
              <p>{m.pitch}</p>
              <ul className="brings">{m.brings.map((b) => <li key={b}>{b}</li>)}</ul>
              {m.claude ? <p className="xs muted">{m.claude.installed ? t('modules.claudeYes', { version: m.claude.version ?? '?' }) : t('modules.claudeNo')}</p> : null}
              {m.status !== 'planned' ? (
                <div className="row wrap">
                  {m.status === 'available' ? (
                    <button type="button" className={`btn sm${m.enabled ? '' : ' primary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: m.id, on: !m.enabled })}>{m.enabled ? t('app.modules.turnOff') : t('app.modules.turnOn')}</button>
                  ) : null}
                  {m.plugin && !m.claude?.installed ? <button type="button" className="btn sm" disabled={install.isPending} aria-busy={install.isPending} onClick={() => install.mutate(m.id)}><Download size={14} aria-hidden="true" />{t('app.modules.install')}</button> : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
