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
  if (q.isLoading) return <div className="page narrow"><SkeletonRows rows={6} /></div>;
  if (q.error || !q.data) return <div className="page narrow"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  const core = Boolean(q.data.plugins.okb?.installed);
  const dev = Boolean(q.data.plugins['okb-dev']?.installed);
  const steps = [
    { done: q.data.cli, title: t('app.claude.step1'), body: t('app.claude.step1Body'), action: null },
    { done: core, title: t('app.claude.step2'), body: t('app.claude.step2Body'), action: q.data.cli && !core ? 'core' : null },
    { done: dev, title: t('app.claude.step3'), body: t('app.claude.step3Body'), action: q.data.cli && core && !dev ? 'dev' : null },
    { done: false, title: t('app.claude.step4'), body: t('app.claude.step4Body'), action: null },
  ];
  const now = steps.findIndex((s) => !s.done);
  return (
    <div className="page narrow">
      <section className="panel hero claude-hero">
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted">{t('app.claude.title')}</p>
          <h2>{t('app.claude.headline')}</h2>
          <p className="muted">{t('app.claude.why')}</p>
          <ul className="brings">{['bring1', 'bring2', 'bring3', 'bring4'].map((k) => <li key={k}><Check size={14} aria-hidden="true" />{t(`app.claude.${k}`)}</li>)}</ul>
        </div>
      </section>
      <section className="panel" aria-labelledby="steps-h">
        <div className="panel-head"><h2 id="steps-h">{t('app.claude.how')}</h2></div>
        <div className="panel-body">
          {!q.data.cli ? <p className="notice warn small" style={{ marginBottom: 12 }}>{t('app.claude.noCli')}</p> : null}
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.title} className={`step${s.done ? ' done' : i === now ? ' now' : ''}`}>
                <span className="step-dot num" aria-hidden="true">{s.done ? <Check size={15} /> : i + 1}</span>
                <div><b>{s.title}{s.done ? <span className="sr-only"> ({t('app.claude.done')})</span> : null}</b><small>{s.body}</small></div>
                {s.done ? <span className="pill sm ok">{t('app.claude.doneShort')}</span> : s.action ? (
                  <button type="button" className="btn sm primary" disabled={install.isPending} aria-busy={install.isPending} onClick={() => install.mutate(s.action!)}><Download size={14} aria-hidden="true" />{t('app.claude.add')}</button>
                ) : <span />}
              </li>
            ))}
          </ol>
          {core && dev ? <p className="notice ok small"><Check size={16} aria-hidden="true" />{t('app.claude.allSet')}</p> : null}
        </div>
      </section>
      <section className="panel" aria-labelledby="try-h">
        <div className="panel-head"><h2 id="try-h">{t('app.claude.try')}</h2></div>
        <div className="panel-body stack">
          {['app.claude.ex1', 'app.claude.ex2', 'app.claude.ex3'].map((k) => <code key={k} className="cmd"><Terminal size={13} aria-hidden="true" />{t(k)}</code>)}
        </div>
      </section>
    </div>
  );
}
