import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, CircleAlert, CircleCheck, CircleX, Copy, FileSearch, HardDrive, HeartPulse, Info, Layers, MessageSquare, RefreshCw, ShieldCheck, Stethoscope, Trash2, TriangleAlert } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { get, post } from '../app/api';
import { tn, useT, type Translate } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { ConfirmDialog } from '../ui/Confirm';
import { PageTabs } from '../ui/PageTabs';
import { ErrorState, SkeletonRows } from '../ui/States';
import { Ring } from '../ui/Ring';

type HealthGroup = { code: string; title: string; why?: string; fix?: string; items: { level: 'error' | 'warning' | 'info'; where: string; message: string }[] };
type Health = { scanned: number; okf: boolean; health: { score: number; errors: number; warnings: number; infos: number }; groups: HealthGroup[] };
type Storage = { findings: { code: string; level: string; path?: string }[]; backups: { date: string; files: number }[] };
type Doctor = { checks: { name: string; status: 'ok' | 'warn' | 'fail' | 'unknown'; detail: string; fix: string | null; label: string }[]; support: { kind: string; enabled: boolean; notes: string }[]; version: string };

const LEVEL_ICON: Record<string, ReactNode> = {
  error: <CircleX size={18} className="err-ink" aria-hidden="true" />, warning: <TriangleAlert size={18} className="warn-ink" aria-hidden="true" />, info: <Info size={18} className="muted" aria-hidden="true" />,
};

/* ================================================================ health */

function HealthTab() {
  const t = useT();
  const [sources, setSources] = useState(false);
  const r = useQuery({ queryKey: ['health', sources], queryFn: () => get<Health>('/api/health', { sources: sources ? 1 : '' }) });
  if (r.isLoading) return <SkeletonRows rows={6} />;
  if (r.error || !r.data) return <ErrorState error={r.error} retry={() => void r.refetch()} />;
  const h = r.data.health;
  const tone = h.errors ? 'var(--err)' : h.score < 70 ? 'var(--warn)' : 'var(--ok)';
  const nav = async () => {
    try { const out = await post<{ proposalId?: string }>('/api/nav'); if (out.proposalId) { toast(t('web.health.navReady')); go({ name: 'inbox', tab: 'proposals', id: out.proposalId }); } else toast(t('web.health.navCurrent')); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const groups = [...r.data.groups].sort((a, b) => (order[a.items[0]?.level ?? 'info'] ?? 3) - (order[b.items[0]?.level ?? 'info'] ?? 3));
  return (
    <>
      <section className="panel hero health-hero">
        <Ring score={h.score} tone={tone} />
        <div className="grow stack" style={{ gap: 6 }}>
          <h2>{t('maintain.title')}</h2>
          <p className="muted">{tn(t, 'maintain.scanned', r.data.scanned)} · {r.data.okf ? t('maintain.conform') : t('maintain.notConform')}</p>
          <div className="row wrap"><span className={`pill sm ${h.errors ? 'err' : ''}`}>{tn(t, 'status.errors', h.errors)}</span><span className={`pill sm ${h.warnings ? 'warn' : ''}`}>{tn(t, 'status.warnings', h.warnings)}</span><span className="pill sm">{tn(t, 'maintain.infos', h.infos)}</span></div>
        </div>
        <div className="actions">
          <button type="button" className="btn sm" onClick={() => void nav()}><RefreshCw size={14} aria-hidden="true" />{t('web.health.nav')}</button>
          <button type="button" className="btn sm ghost" aria-pressed={sources} onClick={() => setSources(!sources)}><FileSearch size={14} aria-hidden="true" />{sources ? t('web.health.noSources') : t('web.health.sources')}</button>
        </div>
      </section>
      {!groups.length ? <p className="notice ok"><CircleCheck size={18} aria-hidden="true" />{t('maintain.clean')}</p> : (
        <section className="panel">
          <div className="panel-body flush">
            {groups.map((g) => (
              <details key={g.code} className="fold health-group">
                <summary>
                  <ChevronRight size={15} className="fold-chev" aria-hidden="true" />
                  {LEVEL_ICON[g.items[0]?.level ?? 'info']}
                  <b>{g.title}</b>
                  <span className="pill sm num">{g.items.length}</span>
                </summary>
                <div className="health-body stack">
                  {g.why ? <p className="muted small">{g.why}</p> : null}
                  {g.fix ? <p className="small"><span className="muted">{t('app.upkeep.fix')} </span>{g.fix}</p> : null}
                  <ul className="health-items">{g.items.slice(0, 80).map((i, n) => <li key={n}><a href={hrefFor({ name: 'brain', path: i.where })}>{i.where.replace(/\.md$/, '')}</a><span className="muted">{i.message}</span></li>)}</ul>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ================================================================ backups and storage */

function BackupTab() {
  const t = useT();
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ['storage'], queryFn: () => get<Storage>('/api/storage') });
  const tr = useQuery({ queryKey: ['trash'], queryFn: () => get<{ items: unknown[] }>('/api/trash') });
  if (st.isLoading) return <SkeletonRows rows={4} />;
  if (st.error || !st.data) return <ErrorState error={st.error} retry={() => void st.refetch()} />;
  const last = st.data.backups[0];
  const run = async () => {
    try { const out = await post<{ created: boolean; info: { date: string } }>('/api/backup/run', {}); toast(out.created ? t('web.storage.backupDone') : t('backup.already', { date: out.info.date })); void qc.invalidateQueries({ queryKey: ['storage'] }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const verify = async () => {
    try { const out = await post<{ date: string; bad: unknown[]; missing: unknown[]; files: number }>('/api/backup/verify', {}); toast(out.bad.length || out.missing.length ? t('backup.broken', { date: out.date, bad: out.bad.length + out.missing.length }) : t('backup.verified', { date: out.date, files: out.files }), out.bad.length || out.missing.length ? 'err' : undefined); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const findings = st.data.findings.filter((f) => !['no-backup', 'old-backup', 'unverified-backup'].includes(f.code) || !last);
  const by = new Map<string, Storage['findings']>();
  for (const f of findings) by.set(f.code, [...(by.get(f.code) ?? []), f]);
  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2><HardDrive size={17} aria-hidden="true" />{t('app.upkeep.backups')}</h2></div>
        <div className="panel-body stack">
          <p className={`notice ${last ? 'ok' : 'warn'}`}>{last ? <ShieldCheck size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}<span>{last ? t('web.storage.lastBackup', { date: last.date, files: last.files }) : t('backup.none')}</span></p>
          <div className="row wrap">
            <button type="button" className="btn primary sm" onClick={() => void run()}><HardDrive size={14} aria-hidden="true" />{t('web.storage.backupNow')}</button>
            {last ? <button type="button" className="btn sm" onClick={() => void verify()}><ShieldCheck size={14} aria-hidden="true" />{t('web.storage.verify')}</button> : null}
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{t('web.storage.title')}</h2></div>
        <div className="panel-body stack">
          {!by.size ? <p className="notice ok"><CircleCheck size={18} aria-hidden="true" />{t('brain.check.clean')}</p> : (
            <ul className="checks">
              {[...by].map(([code, list]) => (
                <li key={code}>{LEVEL_ICON[list[0]!.level] ?? LEVEL_ICON.info}<div className="stack" style={{ gap: 2 }}><span>{t(`brain.check.${code}`)} ({list.length})</span>{list.some((f) => f.path) ? <code className="xs muted">{list.filter((f) => f.path).slice(0, 3).map((f) => f.path).join(', ')}</code> : null}</div></li>
              ))}
            </ul>
          )}
          {by.has('sync-copy') || by.has('moved-note') || by.has('missing-id') ? <p className="small muted">{t('web.storage.repairHint')} <code>okb brain repair</code></p> : null}
          {tr.data?.items.length ? <p className="small row"><Trash2 size={14} className="muted" aria-hidden="true" />{t('web.storage.trash', { n: tr.data.items.length })} <code>okb trash</code></p> : null}
        </div>
      </section>
    </>
  );
}

/* ================================================================ diagnosis */

function DoctorTab() {
  const t = useT();
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ['doctor'], queryFn: () => get<Doctor>('/api/doctor') });
  const [asking, setAsking] = useState(false);
  if (r.isLoading) return <SkeletonRows rows={8} />;
  if (r.error || !r.data) return <ErrorState error={r.error} retry={() => void r.refetch()} />;
  const icon = { ok: <CircleCheck size={18} className="ok-ink" aria-hidden="true" />, warn: <TriangleAlert size={18} className="warn-ink" aria-hidden="true" />, fail: <CircleX size={18} className="err-ink" aria-hidden="true" />, unknown: <CircleAlert size={18} className="muted" aria-hidden="true" /> };
  const fix = async (f: string) => {
    try { const out = await post<{ ok: boolean }>('/api/doctor/fix', { fix: f }); toast(out.ok ? t('web.doctor.fixed') : t('doctor.fixFailed'), out.ok ? undefined : 'err'); void qc.invalidateQueries({ queryKey: ['doctor'] }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const update = async () => {
    toast(t('update.running'));
    try { const out = await post<{ ok: boolean; version: string }>('/api/update'); toast(out.ok ? `${t('update.done', { version: out.version })} — ${t('web.doctor.restart')}` : t('update.failed'), out.ok ? undefined : 'err'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <>
      <p className="page-intro">{t('web.doctor.lead')}</p>
      <section className="panel">
        <ul className="rows">
          {r.data.checks.map((c) => (
            <li key={c.name}>
              {icon[c.status]}
              <div className="grow"><span className="title">{c.label}</span><span className="meta">{c.detail}</span></div>
              {c.fix ? <button type="button" className="btn sm primary" onClick={() => void fix(c.fix!)}>{t('web.doctor.fix')}</button> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{t('web.doctor.update')}</h2><span className="pill sm num" style={{ marginLeft: 'auto' }}>v{r.data.version}</span></div>
        <div className="panel-body row wrap"><p className="muted grow">{t('update.q')}</p><button type="button" className="btn" onClick={() => setAsking(true)}><RefreshCw size={14} aria-hidden="true" />{t('web.doctor.updateGo')}</button></div>
      </section>
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={t('update.q')} confirm={t('web.doctor.updateGo')} onConfirm={update} />
    </>
  );
}

/* ================================================================ usage */

type Usage = {
  days: number;
  stats: {
    pricesAsOf: string; logs: number;
    okb: { runs: number; costUsd: number; tokens: number; cacheHitRatio: number | null; byWorkflow: { workflow: string; runs: number; costUsd: number; avgCostUsd: number; avgTokens: number; agentsCostUsd: number; medianMinutes: number }[]; byModel: { label: string; costUsd: number; tokens: number }[]; agents: { type: string; runs: number; costUsd: number; models: string[] }[]; skillTokensEstimated: number; hook: { runs: number; tokensEstimated: number } };
    other: { costUsd: number };
    daily: { day: string; okbCostUsd: number; otherCostUsd: number }[];
    advice: { key: string; params: Record<string, string> }[];
  };
  quality: { kb: string; applied: number; proposals: number; superseded: number; changesDropped: number; changesProposed: number; pending: number; pendingOldestDays: number | null; reviewHoursMedian: number | null; editedAfter: number; appliedFiles: number; droppedByKind: Record<string, number>; rolledBack: number }[];
  commands: { command: string; calls: number; failures: number; codes: Record<string, number>; medianMs: number }[];
  feedback: { at: string; text: string }[];
};

function useFormat(t: Translate) {
  const nf = (d = 0) => new Intl.NumberFormat(t.lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  return {
    usd: (n: number) => `${nf(n < 10 ? 2 : 0).format(n)} $`,
    tok: (n: number) => (n >= 1e6 ? `${nf(1).format(n / 1e6)} M` : n >= 1e3 ? `${nf(0).format(n / 1e3)} k` : nf(0).format(n)),
    pct: (x: number) => `${nf(0).format(x * 100)} %`,
    n: (x: number, d = 0) => nf(d).format(x),
  };
}

function DailyChart({ daily, days }: { daily: Usage['stats']['daily']; days: number }) {
  const t = useT();
  const f = useFormat(t);
  const end = Date.now();
  const list = Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = daily.find((x) => x.day === d);
    return { day: d, okb: row?.okbCostUsd ?? 0, other: row?.otherCostUsd ?? 0 };
  });
  const max = Math.max(0.01, ...list.map((x) => x.okb + x.other));
  const W = 1000, H = 140, gap = 3, bw = Math.max(2, (W - gap * list.length) / list.length);
  const step = days <= 7 ? 1 : days <= 31 ? 7 : 30;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="usage-chart" role="img" aria-label={t('web.usage.daily')}>
        {list.map((x, i) => {
          const xPos = i * (bw + gap);
          const hOkb = (x.okb / max) * H, hOther = (x.other / max) * H;
          return (
            <g key={x.day}>
              {hOther > 0 ? <rect x={xPos} y={H - hOkb - hOther} width={bw} height={Math.max(1, hOther)} rx={3} className="bar-other"><title>{x.day} · {t('web.usage.other')} {f.usd(x.other)}</title></rect> : null}
              {hOkb > 0 ? <rect x={xPos} y={H - hOkb} width={bw} height={Math.max(1, hOkb)} rx={3} className="bar-okb"><title>{x.day} · OKB {f.usd(x.okb)}</title></rect> : null}
              {i === 0 || i === list.length - 1 || (i % step === 0 && i < list.length - Math.max(2, step / 2)) ? <text x={xPos + bw / 2} y={H + 16} textAnchor={i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle'} className="axis">{x.day.slice(5).replace('-', '/')}</text> : null}
            </g>
          );
        })}
      </svg>
      <p className="row small muted" style={{ gap: 16 }}><span className="row" style={{ gap: 6 }}><i className="swatch okb" />OKB</span><span className="row" style={{ gap: 6 }}><i className="swatch other" />{t('web.usage.other')}</span></p>
    </div>
  );
}

function Table({ head, rows }: { head: { label: string; num?: boolean }[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{head.map((h, i) => <th key={i} className={h.num ? 'num-col' : undefined}>{h.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={head[j]?.num ? 'num-col' : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function UsageTab() {
  const t = useT();
  const f = useFormat(t);
  const [days, setDays] = useState<number>(() => { try { return Number(localStorage.getItem('okb-usage-days')) || 30; } catch { return 30; } });
  const r = useQuery({ queryKey: ['usage', days], queryFn: () => get<Usage>('/api/usage', { days }) });
  const [text, setText] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const pick = (d: number) => { setDays(d); try { localStorage.setItem('okb-usage-days', String(d)); } catch { /* private window */ } };
  const head = (
    <div className="page-head">
      <p className="page-intro grow">{t('web.usage.lead')}</p>
      <div className="segmented" role="group" aria-label={t('app.upkeep.period')}>{[7, 30, 90].map((d) => <button type="button" key={d} aria-pressed={days === d} onClick={() => pick(d)}>{tn(t, 'web.usage.days', d)}</button>)}</div>
    </div>
  );
  if (r.isLoading) return <>{head}<SkeletonRows rows={6} /></>;
  if (r.error || !r.data) return <>{head}<ErrorState error={r.error} retry={() => void r.refetch()} /></>;
  const { stats, quality, commands, feedback } = r.data;
  const okb = stats.okb;
  const total = okb.costUsd + stats.other.costUsd;
  const q = quality.reduce((a, x) => ({ applied: a.applied + x.applied, proposals: a.proposals + x.proposals - x.superseded, dropped: a.dropped + x.changesDropped, changes: a.changes + x.changesProposed, edited: a.edited + x.editedAfter, files: a.files + x.appliedFiles }), { applied: 0, proposals: 0, dropped: 0, changes: 0, edited: 0, files: 0 });
  const leads = stats.advice.map((a) => t(a.key, a.params));
  const save = async () => {
    if (!text.trim()) return;
    try { await post('/api/feedback', { text }); toast(t('feedback.saved')); setText(''); void r.refetch(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const copyReport = async () => {
    try { const out = await get<{ markdown: string }>('/api/usage/report', { days }); setReport(out.markdown); await navigator.clipboard?.writeText(out.markdown); toast(t('web.usage.reportCopied')); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <>
      {head}
      <div className="usage-tiles">
        <div className="stat"><span>{t('web.usage.cost')}</span><b className="num">{f.usd(okb.costUsd)}</b><small className="muted">{total > 0 ? t('web.usage.costSub', { share: f.pct(okb.costUsd / total), other: f.usd(stats.other.costUsd) }) : t('web.usage.costNone')}</small></div>
        <div className="stat"><span>{t('web.usage.tasks')}</span><b className="num">{f.n(okb.runs)}</b><small className="muted">{okb.runs ? t('web.usage.tasksSub', { tokens: f.tok(okb.tokens), avg: f.usd(okb.costUsd / okb.runs) }) : t('web.usage.tasksNone')}</small></div>
        <div className="stat"><span>{t('web.usage.cache')}</span><b className="num">{okb.cacheHitRatio === null ? '—' : f.pct(okb.cacheHitRatio)}</b><small className="muted">{t('web.usage.cacheSub')}</small></div>
        <div className="stat"><span>{t('web.usage.quality')}</span><b className="num">{q.proposals ? `${q.applied}/${q.proposals}` : '—'}</b><small className="muted">{q.proposals ? t('web.usage.qualitySub', { dropped: String(q.dropped), changes: String(q.changes), edited: String(q.edited), files: String(q.files) }) : t('web.usage.qualityNone')}</small></div>
      </div>
      {leads.length ? <div className="notice warn"><TriangleAlert size={18} aria-hidden="true" /><div className="stack" style={{ gap: 4 }}><b>{t('report.leads')}</b>{leads.map((l) => <span key={l}>{l}</span>)}</div></div> : null}
      {!okb.runs ? <p className="notice plain"><Info size={18} aria-hidden="true" /><span><b>{t('web.usage.emptyTitle')}</b> {t('web.usage.emptyText', { logs: String(stats.logs) })}</span></p> : null}
      <section className="panel">
        <div className="panel-head"><h2>{t('web.usage.daily')}</h2><span className="small muted" style={{ marginLeft: 'auto' }}>{t('usage.subtitle', { prices: stats.pricesAsOf })}</span></div>
        <div className="panel-body"><DailyChart daily={stats.daily} days={r.data.days} /></div>
      </section>
      {okb.runs ? (
        <section className="panel">
          <div className="panel-head"><h2>{t('report.cost')}</h2></div>
          <div className="panel-body stack">
            <p className="small muted">{t('web.usage.workflowHelp')}</p>
            <Table head={[{ label: t('report.col.workflow') }, { label: t('report.col.runs'), num: true }, { label: t('report.col.total'), num: true }, { label: t('report.col.avg'), num: true }, { label: t('report.col.avgTokens'), num: true }]}
              rows={okb.byWorkflow.map((w) => [<code key="w">{w.workflow}</code>, String(w.runs), f.usd(w.costUsd), f.usd(w.avgCostUsd), f.tok(w.avgTokens)])} />
          </div>
        </section>
      ) : null}
      <div className="grid-even">
        <section className="panel">
          <div className="panel-head"><h2>{t('report.quality')}</h2></div>
          <div className="panel-body stack">
            <p className="small muted">{t('web.usage.qualityHelp')}</p>
            {quality.length ? <Table head={[{ label: t('report.col.kb') }, { label: t('report.col.applied'), num: true }, { label: t('report.col.dropped'), num: true }, { label: t('report.col.edited'), num: true }]}
              rows={quality.map((x) => [x.kb, `${x.applied}/${x.proposals - x.superseded}`, `${x.changesDropped}/${x.changesProposed}`, `${x.editedAfter}/${x.appliedFiles}`])} /> : <p className="muted small">{t('report.noQuality')}</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{t('report.commands')}</h2></div>
          <div className="panel-body">
            {commands.length ? <Table head={[{ label: t('report.col.command') }, { label: t('report.col.calls'), num: true }, { label: t('report.col.failures'), num: true }, { label: t('report.col.medianMs'), num: true }]}
              rows={commands.slice(0, 10).map((c) => [<code key="c">okb {c.command}</code>, String(c.calls), String(c.failures), f.n(c.medianMs)])} /> : <p className="muted small">{t('report.noCommands')}</p>}
          </div>
        </section>
      </div>
      <div className="grid-even">
        <section className="panel">
          <div className="panel-head"><h2><MessageSquare size={17} aria-hidden="true" />{t('web.usage.feedbackTitle')}</h2></div>
          <div className="panel-body stack">
            <p className="small muted">{t('web.usage.feedbackHelp')}</p>
            <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('web.usage.feedbackPlaceholder')} aria-label={t('web.usage.feedbackTitle')} />
            <span><button type="button" className="btn primary sm" disabled={!text.trim()} onClick={() => void save()}><Check size={14} aria-hidden="true" />{t('web.usage.feedbackSave')}</button></span>
            {feedback.length ? <ul className="stack small" style={{ gap: 4, listStyle: 'none', padding: 0, margin: 0 }}>{feedback.slice(-8).reverse().map((x) => <li key={x.at}><span className="muted">{x.at.slice(0, 10)} · </span>{x.text}</li>)}</ul> : null}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{t('web.usage.reportTitle')}</h2></div>
          <div className="panel-body stack">
            <p className="small muted">{t('web.usage.reportHelp')}</p>
            <span><button type="button" className="btn sm" onClick={() => void copyReport()}><Copy size={14} aria-hidden="true" />{t('web.usage.reportCopy')}</button></span>
            <code className="cmd">okb report --days {days}</code>
            {report ? <pre className="code-block">{report}</pre> : null}
          </div>
        </section>
      </div>
    </>
  );
}

export default function Upkeep({ route }: { route: Extract<Route, { name: 'upkeep' }> }) {
  const t = useT();
  const tab = route.tab ?? 'health';
  return (
    <div className="page">
      <PageTabs label={t('app.nav.upkeep')} tabs={[
        { to: { name: 'upkeep', tab: 'health' }, label: t('app.upkeep.tab.health'), current: tab === 'health', icon: HeartPulse },
        { to: { name: 'upkeep', tab: 'backup' }, label: t('app.upkeep.tab.backup'), current: tab === 'backup', icon: HardDrive },
        { to: { name: 'upkeep', tab: 'usage' }, label: t('app.upkeep.tab.usage'), current: tab === 'usage', icon: Layers },
        { to: { name: 'upkeep', tab: 'doctor' }, label: t('app.upkeep.tab.doctor'), current: tab === 'doctor', icon: Stethoscope },
      ]} />
      {tab === 'health' ? <HealthTab /> : tab === 'backup' ? <BackupTab /> : tab === 'usage' ? <UsageTab /> : <DoctorTab />}
    </div>
  );
}
