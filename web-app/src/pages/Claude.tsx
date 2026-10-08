import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Terminal } from 'lucide-react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { toast } from '../app/toast';
import { ErrorState, SkeletonRows } from '../ui/States';

type ClaudeState = { cli: boolean; marketplace: boolean; plugins: Record<string, { installed: boolean; version: string | null }> };

/** The web app is the main door; Claude Code is an option: what it adds, how to install it, in one click. */
export default function ClaudePage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['claude'], queryFn: () => get<ClaudeState>('/api/claude') });
  const install = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; steps: string[]; error?: string }>('/api/modules/install', { id }),
    onSuccess: (r) => { r.ok ? toast(t('app.claude.installed')) : toast(t('modules.installFailed', { error: r.error ?? '' }), 'err'); void qc.invalidateQueries({ queryKey: ['claude'] }); void qc.invalidateQueries({ queryKey: ['modules'] }); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  if (q.isLoading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  const core = q.data.plugins.okb?.installed;
  const dev = q.data.plugins['okb-dev']?.installed;
  const steps = [
    { done: q.data.cli, title: t('app.claude.step1'), body: t('app.claude.step1Body') },
    { done: Boolean(core), title: t('app.claude.step2'), body: t('app.claude.step2Body') },
    { done: Boolean(dev), title: t('app.claude.step3'), body: t('app.claude.step3Body') },
    { done: false, title: t('app.claude.step4'), body: t('app.claude.step4Body') },
  ];
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <section className="stack" style={{ gap: 'var(--s3)' }}>
        <h2>{t('app.claude.title')}</h2>
        <p className="muted" style={{ maxWidth: '68ch' }}>{t('app.claude.why')}</p>
        <ul className="brings">
          <li>{t('app.claude.bring1')}</li><li>{t('app.claude.bring2')}</li><li>{t('app.claude.bring3')}</li><li>{t('app.claude.bring4')}</li>
        </ul>
      </section>
      <section className="panel" aria-labelledby="steps-h">
        <div className="panel-head"><h2 id="steps-h">{t('app.claude.how')}</h2></div>
        <ol className="steps-line">
          {steps.map((s, i) => (
            <li key={s.title} className={s.done ? 'done' : undefined}>
              <span className="step-dot" aria-hidden="true">{s.done ? <Check size={14} /> : i + 1}</span>
              <div className="stack" style={{ gap: 4 }}><strong>{s.title}{s.done ? <span className="sr-only"> ({t('app.claude.done')})</span> : null}</strong><span className="small muted">{s.body}</span></div>
            </li>
          ))}
        </ol>
        <div className="panel-body row wrap">
          {!q.data.cli ? <p className="notice warn small">{t('app.claude.noCli')}</p> : (
            <>
              {!core ? <button type="button" className="btn primary" disabled={install.isPending} aria-busy={install.isPending} onClick={() => install.mutate('core')}><Download size={16} aria-hidden="true" />{t('app.claude.installCore')}</button> : null}
              {core && !dev ? <button type="button" className="btn primary" disabled={install.isPending} aria-busy={install.isPending} onClick={() => install.mutate('dev')}><Download size={16} aria-hidden="true" />{t('app.claude.installDev')}</button> : null}
              {core && dev ? <p className="notice info small"><Check size={16} aria-hidden="true" />{t('app.claude.allSet')}</p> : null}
            </>
          )}
        </div>
      </section>
      <section className="panel" aria-labelledby="try-h">
        <div className="panel-head"><h2 id="try-h">{t('app.claude.try')}</h2></div>
        <div className="panel-body stack">
          {['app.claude.ex1', 'app.claude.ex2', 'app.claude.ex3'].map((k) => <code key={k} className="cmd"><Terminal size={14} aria-hidden="true" />{t(k)}</code>)}
        </div>
      </section>
    </div>
  );
}
