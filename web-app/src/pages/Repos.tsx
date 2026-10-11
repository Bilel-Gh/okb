import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowUpRight, BookOpen, Building2, CheckCircle2, ChevronRight, Circle, CircleHelp, Clock, FileQuestion, FolderGit2, GitBranch, Link2, Mail, Map as MapIcon,
  Network, Play, Plug, RefreshCw, Rocket, Search, Sparkles, Target, Terminal, Ticket, TriangleAlert,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { get, post } from '../app/api';
import { useScheme } from '../app/data';
import { tn, useT } from '../app/i18n';
import { go, hrefFor, type Route } from '../app/router';
import { toast } from '../app/toast';
import { Prose } from '../reader/Prose';
import { LevelBar, type Tier } from '../ui/LevelBar';
import { Empty, ErrorState, SkeletonRows } from '../ui/States';
import { ExamPanel } from './Exam';

const Arch = lazy(() => import('./Arch'));

type Gap = { part: string; points: number; key: string; params: Record<string, string | number> };
type Level = { percent: number; tier: Tier; partial: boolean; parts: { id: string; weight: number; score: number; measured: boolean }[]; next: Gap[] };
type TicketItem = { ref: string; title: string; status: string; branch?: string | null; commits: number; updatedAt: string; repos: { id: string; branch?: string | null }[]; journal: { kind: string; text: string }[] };
type Linked = { id: string; name: string; path: string; product?: string; description: string | null; stack: string[]; level: Level; status: { questions: { state: string }[]; notes: { kind: string; state: string; path: string }[]; stale: number; tickets: number; pending: { id: string }[] } };
type Unlinked = { name: string; product: string; folder: string; level: Level };
type ReposData = { repos: Linked[]; unlinked: Unlinked[]; tickets: TicketItem[]; workspaces?: { name: string; roots: string[]; prefixes: string[] }[] };
type Question = { id: string; theme: string; state: string; text: string; why?: string; target?: string; note?: string; askWho?: string };
type Iface = { kind: string; name: string; detail?: string; at?: string };
type RepoDetail = {
  repo: { id: string; name: string; path: string; displayPath?: string };
  status: { head: string | null; scan: { at: string | null; commit: string | null; behind: boolean }; notes: { kind: string; state: string; path: string }[]; pending: { id: string }[]; stale: number; tickets: number; otherNotes: number; coverage: { readFiles: number; readTotal: number; skimFiles: number; skimTotal: number } };
  level: Level; questions: Question[]; tickets: TicketItem[]; pack: { kind: string; path: string; title: string | null }[];
  map: { repo: { description?: string }; stack: { label: string; version?: string }[]; modules: { path: string; role?: string; files: number; lines: number; authors: string[] }[]; provides: Iface[]; consumes: Iface[]; commands: { run: string; from: string }[]; env: { name: string; sensitive: boolean }[] } | null;
  risks: { kind: string; text: string }[];
  freshness: { notes: { path: string; verdict: string; files: { file: string }[] }[]; news: { file: string }[] };
  landscape: string | null;
};

/** Each product has its colour, stable from its place in the sorted list. */
const LINES: readonly (readonly [string, string])[] = [
  ['#2563eb', '#6b9bff'], ['#ea580c', '#fb923c'], ['#0d9488', '#2dd4bf'], ['#7c3aed', '#a78bfa'], ['#0891b2', '#22d3ee'],
  ['#c026d3', '#e879f9'], ['#e11d48', '#fb7185'], ['#4f46e5', '#818cf8'], ['#059669', '#34d399'],
];
/** Products take the lines in order, so two products never share a colour (up to nine). */
export function lineOf(product: string, products: readonly string[]): string {
  const i = Math.max(0, [...products].sort((a, b) => a.localeCompare(b)).indexOf(product));
  const pair = LINES[i % LINES.length]!;
  return document.documentElement.dataset.mode === 'dark' ? pair[1] : pair[0];
}

function productsOf(data: ReposData): string[] {
  return [...new Set([...data.repos.map((r) => r.product ?? ''), ...data.unlinked.map((r) => r.product)])];
}

/** The next tier and where it starts. */
const NEXT_TIER: Readonly<Record<Tier, readonly [Tier, number] | null>> = { discovery: ['usable', 20], usable: ['solid', 45], solid: ['expert', 70], expert: ['reference', 90], reference: null };
const PACK_ICON: Readonly<Record<string, ReactNode>> = {
  overview: <Target size={16} aria-hidden="true" />, start: <Play size={16} aria-hidden="true" />, architecture: <Building2 size={16} aria-hidden="true" />,
  interfaces: <Plug size={16} aria-hidden="true" />, delivery: <Rocket size={16} aria-hidden="true" />, codemap: <MapIcon size={16} aria-hidden="true" />, questions: <FileQuestion size={16} aria-hidden="true" />,
};
const Q_ICON: Readonly<Record<string, ReactNode>> = {
  answered: <CheckCircle2 size={17} className="ok-ink" aria-hidden="true" />, pending: <Clock size={17} className="accent-ink" aria-hidden="true" />, received: <Mail size={17} className="accent-ink" aria-hidden="true" />,
  found: <Search size={17} className="muted" aria-hidden="true" />, unknown: <CircleHelp size={17} className="warn-ink" aria-hidden="true" />, open: <Circle size={17} className="muted" aria-hidden="true" />,
};

function useTiers() {
  const t = useT();
  return { discovery: t('knowledge.tier.discovery'), usable: t('knowledge.tier.usable'), solid: t('knowledge.tier.solid'), expert: t('knowledge.tier.expert'), reference: t('knowledge.tier.reference') };
}

function gapText(t: ReturnType<typeof useT>, g: Gap): string {
  const params: Record<string, string | number> = { ...g.params };
  if (typeof g.params.kind === 'string') params.page = t(`app.page.${g.params.kind}`);
  return t(g.key, params);
}

const rel = (iso: string | null, lang: string) => {
  if (!iso) return '';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
};

/* ================================================================ the list */

function RepoRow({ name, level, href, color }: { name: string; level: Level; href: string; color: string }) {
  const t = useT();
  const tiers = useTiers();
  const first = level.next[0];
  return (
    <li className="repo-row" style={{ '--c': color } as CSSProperties}>
      <div className="repo-row-name">
        <a className="title" href={href}>{name}</a>
        <span className="tier">{tiers[level.tier]}</span>
      </div>
      <LevelBar percent={level.percent} tier={level.tier} tiers={tiers} color={color} label={t('app.repos.levelLabel', { name, n: level.percent, tier: tiers[level.tier] })} showLabels={false} />
      <span className="repo-percent num">{level.percent} %</span>
      {first ? <span className="repo-next"><ArrowUpRight size={14} aria-hidden="true" />{t('knowledge.points', { n: Math.max(1, Math.round(first.points)) })} · {gapText(t, first)}</span> : null}
    </li>
  );
}

function TierScale() {
  const tiers = useTiers();
  const starts: [Tier, number][] = [['discovery', 0], ['usable', 20], ['solid', 45], ['expert', 70], ['reference', 90]];
  return (
    <div className="tier-scale" aria-hidden="true">
      <div />
      <div className="tier-scale-line">{starts.map(([k, x]) => <span key={k} style={{ left: `${x}%` }}>{tiers[k]}</span>)}</div>
      <div />
    </div>
  );
}

function Tickets({ tickets, showRepos }: { tickets: TicketItem[]; showRepos: boolean }) {
  const t = useT();
  if (!tickets.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2><Ticket size={17} aria-hidden="true" />{t('web.repos.tickets')}</h2></div>
      <div className="panel-body stack">
        <p className="small muted">{t('web.repos.ticketsLead')}</p>
        <ul className="rows tight panel">
          {tickets.map((tk) => (
            <li key={tk.ref} style={{ alignItems: 'flex-start' }}>
              <GitBranch size={16} className="muted" aria-hidden="true" style={{ marginTop: 3 }} />
              <div className="grow">
                <a className="title" href={hrefFor({ name: 'tickets', ref: tk.ref })}>{tk.ref}{tk.title && tk.title !== tk.ref ? ` · ${tk.title}` : ''}</a>
                <span className="meta">{[showRepos ? tk.repos.map((r) => (r.branch ? `${r.id} (${r.branch})` : r.id)).join(', ') : tk.branch ?? t('scope.noBranch'), tn(t, 'scope.commits', tk.commits), rel(tk.updatedAt, t.lang)].join(' · ')}</span>
                {tk.journal.map((j, i) => <span key={i} className="small"><span className="muted">{t(`ticket.kind.${j.kind}`)} · </span>{j.text}</span>)}
              </div>
              <span className={`pill sm ${tk.status === 'active' ? 'accent' : 'ok'}`}>{t(`ticket.status.${tk.status}`)}</span>
            </li>
          ))}
        </ul>
        <code className="cmd"><Terminal size={13} aria-hidden="true" />/okb:ticket</code>
      </div>
    </section>
  );
}

/* ================================================================ one repository */

function LinkForm({ folder, name }: { folder: string; name: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const link = useMutation({
    mutationFn: () => post('/api/repos/link', { folder, path }),
    onSuccess: () => { toast(t('app.repos.linked', { name })); void qc.invalidateQueries({ queryKey: ['repos'] }); },
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (path.trim()) link.mutate(); }}>
      <div className="field">
        <label htmlFor="link-path">{t('app.repos.linkLabel', { name })}</label>
        <input id="link-path" className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/dev/…" autoComplete="off" spellCheck={false} />
        <small>{t('app.repos.linkHint')}</small>
      </div>
      {link.error ? <ErrorState error={link.error} /> : null}
      <span><button type="submit" className="btn primary sm" disabled={!path.trim() || link.isPending}><Link2 size={14} aria-hidden="true" />{t('app.repos.link')}</button></span>
    </form>
  );
}

function LevelPanel({ name, level, color }: { name: string; level: Level; color: string }) {
  const t = useT();
  const tiers = useTiers();
  const next = NEXT_TIER[level.tier];
  return (
    <section className="panel" style={{ '--c': color } as CSSProperties}>
      <div className="panel-head"><h2>{t('app.repos.levelTitle')}</h2><span className="spacer" /><span className="repo-percent num">{level.percent} %</span></div>
      <div className="panel-body stack lg">
        <LevelBar percent={level.percent} tier={level.tier} tiers={tiers} color={color} label={t('app.repos.levelLabel', { name, n: level.percent, tier: tiers[level.tier] })} />
        {next ? <p className="small"><span className="muted">{t('app.repos.direction')} </span><strong>{tiers[next[0]]}</strong><span className="muted"> · {t('app.repos.at', { n: next[1] })}</span></p> : null}
        <ul className="parts">
          {level.parts.map((p) => (
            <li key={p.id}>
              <span>{t(`knowledge.part.${p.id}`)}</span>
              <span className="bar tinted" style={{ '--c': color } as CSSProperties}><span style={{ width: `${p.measured ? p.score * 100 : 0}%` }} /></span>
              <span className="num muted">{p.measured ? `${Math.round(p.score * p.weight)} / ${p.weight}` : t('app.repos.notMeasured')}</span>
            </li>
          ))}
        </ul>
        {level.next.length ? (
          <div className="stack" style={{ gap: 8 }}>
            <h3 className="links-title">{t('app.repos.nextTitle')}</h3>
            <ul className="next-steps">{level.next.map((g) => <li key={g.key + JSON.stringify(g.params)}><span className="pill sm accent num">{t('knowledge.points', { n: Math.max(1, Math.round(g.points)) })}</span>{gapText(t, g)}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function QuestionRow({ repoId, q }: { repoId: string; q: Question }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [by, setBy] = useState('');
  const asking = q.state === 'unknown' || q.state === 'open' || q.state === 'found';
  const save = async () => {
    if (!text.trim()) return;
    try { await post('/api/repos/answer', { id: repoId, question: q.id, text, by }); toast(t('web.repos.answered')); setOpen(false); setText(''); void qc.invalidateQueries({ queryKey: ['repo', repoId] }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <li className="question">
      {Q_ICON[q.state] ?? Q_ICON.open}
      <div className="grow">
        <p className={asking ? 'strong' : undefined}>{q.text}</p>
        <p className="small muted">
          {q.state === 'answered' || q.state === 'pending'
            ? <a href={hrefFor({ name: 'brain', path: q.note ?? q.target ?? '' })}>{(q.note ?? q.target ?? '').split('/').pop()?.replace(/\.md$/, '')}</a>
            : [q.why, q.askWho ? `${t('repo.questions.ask')} ${q.askWho}` : ''].filter(Boolean).join(' · ')}
        </p>
        {open ? (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('web.repos.answerPlaceholder')} aria-label={q.text} autoFocus />
            <div className="row"><input className="input" style={{ maxWidth: 240 }} value={by} onChange={(e) => setBy(e.target.value)} placeholder={t('repo.interview.who')} aria-label={t('repo.interview.who')} /><button type="button" className="btn sm primary" onClick={() => void save()} disabled={!text.trim()}>{t('web.repos.saveAnswer')}</button></div>
          </div>
        ) : null}
      </div>
      {asking || q.state === 'received' ? <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{t('web.repos.answer')}</button> : null}
    </li>
  );
}

function Questions({ repoId, questions }: { repoId: string; questions: Question[] }) {
  const t = useT();
  const themes = [...new Set(questions.map((q) => q.theme))];
  if (!questions.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2><CircleHelp size={17} aria-hidden="true" />{t('repo.status.questions')}</h2><span className="pill sm num">{questions.filter((q) => q.state === 'answered').length} / {questions.length}</span></div>
      <div className="panel-body stack">
        <p className="small muted">{t('web.repos.questionsLead')}</p>
        {themes.map((theme, i) => {
          const list = questions.filter((q) => q.theme === theme);
          const done = list.filter((q) => q.state === 'answered').length;
          return (
            <details key={theme} className="fold" open={i < 2}>
              <summary><ChevronRight size={15} aria-hidden="true" className="fold-chev" /><b>{t(`web.repos.theme.${theme}`)}</b><span className="muted small num">{done} / {list.length}</span></summary>
              <ul className="questions">{list.map((q) => <QuestionRow key={q.id} repoId={repoId} q={q} />)}</ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function CodeMap({ map, risks }: { map: NonNullable<RepoDetail['map']>; risks: RepoDetail['risks'] }) {
  const t = useT();
  const modules = map.modules.filter((m) => m.path !== '.');
  const ifaces = (list: Iface[]) => list.length ? (
    <ul className="ifaces">{list.slice(0, 12).map((i) => <li key={`${i.kind}${i.name}${i.at}`}><span className="pill sm">{t(`web.repos.kind.${i.kind}`)}</span><span className="grow"><code>{i.name}</code>{i.detail ? <small className="muted">{i.detail}</small> : null}</span>{i.at ? <code className="muted xs">{i.at}</code> : null}</li>)}</ul>
  ) : <p className="small muted">{t('repo.scan.nothingFound')}</p>;
  const commands = map.commands.filter((c) => c.from !== 'docs').slice(0, 6);
  return (
    <section className="panel">
      <div className="panel-head"><h2><MapIcon size={17} aria-hidden="true" />{t('web.repos.map')}</h2></div>
      <div className="panel-body stack lg">
        <p className="small muted">{t('web.repos.mapLead')}</p>
        {map.stack.length ? <div className="map-section"><h3>{t('repo.scan.stack')}</h3><div className="row wrap">{map.stack.map((x) => <span key={x.label} className="pill">{x.version ? `${x.label} ${x.version}` : x.label}</span>)}</div></div> : null}
        {modules.length ? (
          <div className="map-section"><h3>{t('repo.scan.modules')}</h3>
            <ul className="modules-list">{modules.map((m) => <li key={m.path}><code>{m.path}/</code><span>{m.role ? t(`repo.role.${m.role}`) : '—'}</span><span className="muted small">{tn(t, 'repo.scan.nFiles', m.files)} · {m.lines} l.</span><span className="muted small clip">{m.authors.join(', ')}</span></li>)}</ul>
          </div>
        ) : null}
        <div className="grid-even">
          <div className="map-section"><h3>{t('repo.scan.provides')}</h3>{ifaces(map.provides)}</div>
          <div className="map-section"><h3>{t('repo.scan.consumes')}</h3>{ifaces(map.consumes.filter((c) => c.kind !== 'url' || c.detail !== 'local'))}</div>
        </div>
        {commands.length ? <div className="map-section"><h3>{t('repo.scan.commands')}</h3><div className="stack" style={{ gap: 6 }}>{commands.map((c) => <code key={c.run} className="cmd"><Terminal size={13} aria-hidden="true" />{c.run}</code>)}</div></div> : null}
        {map.env.length ? <div className="map-section"><h3>{t('repo.scan.config')}</h3><div className="row wrap">{map.env.map((e) => <span key={e.name} className={`pill sm${e.sensitive ? ' warn' : ''}`}>{e.name}</span>)}</div></div> : null}
        {risks.length ? <div className="map-section"><h3>{t('repo.scan.watch')}</h3><div className="stack" style={{ gap: 6 }}>{risks.slice(0, 8).map((r) => <p key={r.text} className="notice warn"><TriangleAlert size={16} aria-hidden="true" />{r.text}</p>)}</div></div> : null}
      </div>
    </section>
  );
}

function LinkedDetail({ id, color, setTitle }: { id: string; color: string; setTitle?: (s: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['repo', id], queryFn: () => get<RepoDetail>('/api/repo', { id }) });
  const repoName = d.data?.repo.name;
  useEffect(() => { if (repoName) setTitle?.(repoName); }, [repoName, setTitle]);
  if (d.isLoading) return <SkeletonRows rows={8} />;
  if (d.error || !d.data) return <ErrorState error={d.error} retry={() => void d.refetch()} />;
  const { repo, status: s, map } = d.data;
  const written = s.notes.filter((n) => n.state === 'written').length;
  const answered = d.data.questions.filter((q) => q.state === 'answered').length;
  const propose = async (path: string, body: Record<string, unknown>) => {
    try { const r = await post<{ proposalId?: string }>(path, body); if (!r.proposalId) { toast(t('repo.questions.upToDate')); return; } toast(t('web.repos.proposed')); go({ name: 'inbox', tab: 'proposals', id: r.proposalId }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const rescan = async () => { try { await post('/api/repos/scan', { id: repo.id }); toast(t('web.repos.rescanned')); void qc.invalidateQueries({ queryKey: ['repo', id] }); } catch (e) { toast((e as Error).message, 'err'); } };
  return (
    <div className="stack lg">
      <section className="panel hero repo-hero" style={{ '--c': color } as CSSProperties}>
        <span className="tile" aria-hidden="true"><FolderGit2 size={20} /></span>
        <div className="grow">
          <h2>{repo.name}</h2>
          {map?.repo.description ? <p>{map.repo.description}</p> : null}
          <p className="small muted">HEAD {(s.head ?? '—').slice(0, 7)} · {s.scan.at ? t('web.repos.scanned', { when: rel(s.scan.at, t.lang), commit: (s.scan.commit ?? '').slice(0, 7) }) : t('repo.status.noScan')} {s.scan.behind ? <span className="pill sm warn">{t('repo.status.behind')}</span> : null}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn sm" onClick={() => void rescan()}><RefreshCw size={14} aria-hidden="true" />{t('web.repos.rescan')}</button>
          <button type="button" className="btn sm" onClick={() => void propose('/api/repos/questions', { id: repo.id })}><Sparkles size={14} aria-hidden="true" />{t('app.repos.proposeQuestions')}</button>
        </div>
      </section>
      {!s.notes.some((n) => n.state !== 'missing') ? <div className="notice"><Sparkles size={18} aria-hidden="true" /><div className="stack" style={{ gap: 8 }}><span>{t('web.repos.startOnboarding')}</span><code className="cmd"><Terminal size={13} aria-hidden="true" />/okb-dev:onboard</code></div></div> : null}
      {s.pending.length ? <div className="notice ok"><CheckCircle2 size={18} aria-hidden="true" /><span className="grow">{tn(t, 'repo.status.pending', s.pending.length)}</span><a className="btn sm primary" href={hrefFor({ name: 'inbox', tab: 'proposals', id: s.pending[0]!.id })}>{t('web.home.reviewNow')}</a></div> : null}
      {s.stale ? <div className="notice warn"><TriangleAlert size={18} aria-hidden="true" /><div className="stack" style={{ gap: 8 }}><span>{tn(t, 'repo.status.stale', s.stale)}</span><code className="cmd">/okb-dev:onboard refresh</code></div></div> : null}
      <div className="grid-2">
        <div className="stack lg">
          <LevelPanel name={repo.name} level={d.data.level} color={color} />
          <Questions repoId={repo.id} questions={d.data.questions} />
        </div>
        <div className="stack lg">
          <section className="panel">
            <div className="panel-head"><h2><BookOpen size={17} aria-hidden="true" />{t('repo.status.notes')}</h2><span className="pill sm num">{written} / {s.notes.length}</span></div>
            <ul className="rows tight">
              {d.data.pack.map((p) => {
                const n = s.notes.find((x) => x.kind === p.kind);
                const state = n?.state ?? 'missing';
                const body = <><span className="cat sm" style={{ '--c': state === 'written' ? color : 'var(--ink-3)' } as CSSProperties} aria-hidden="true">{PACK_ICON[p.kind] ?? <BookOpen size={16} />}</span><span className="grow"><span className="title">{p.title ?? t(`repo.note.${p.kind}`)}</span></span><span className={`pill sm ${state === 'written' ? 'ok' : state === 'pending' ? 'accent' : ''}`}>{t(`repo.noteState.${state}`)}</span></>;
                return <li key={p.kind} className={state === 'written' ? 'link-row' : undefined}>{state === 'written' ? <a href={hrefFor({ name: 'brain', path: n!.path })}>{body}</a> : body}</li>;
              })}
            </ul>
            {s.tickets || s.otherNotes ? <p className="panel-foot small muted">{t('repo.status.more', { tickets: s.tickets, other: s.otherNotes })}</p> : null}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>{t('web.repos.progress')}</h2></div>
            <div className="panel-body stack">
              <Meter label={t('web.repos.questions')} done={answered} total={d.data.questions.length} color={color} />
              {s.coverage.readTotal ? <Meter label={t('web.repos.read')} done={s.coverage.readFiles} total={s.coverage.readTotal} color={color} /> : null}
              {s.coverage.skimTotal ? <Meter label={t('web.repos.skimmed')} done={s.coverage.skimFiles} total={s.coverage.skimTotal} color={color} /> : null}
            </div>
          </section>
          <Tickets tickets={d.data.tickets} showRepos={false} />
          {d.data.freshness.notes.length ? (
            <section className="panel">
              <div className="panel-head"><h2>{t('web.repos.freshness')}</h2></div>
              <ul className="rows tight">
                {d.data.freshness.notes.map((n) => <li key={n.path} className="link-row"><a href={hrefFor({ name: 'brain', path: n.path })}><span className="grow"><span className="title">{n.path.split('/').pop()?.replace(/\.md$/, '')}</span>{n.files.length ? <span className="meta">{n.files.slice(0, 3).map((f) => f.file).join(', ')}</span> : null}</span><span className={`pill sm ${n.verdict === 'fresh' ? 'ok' : n.verdict === 'stale' ? 'warn' : ''}`}>{t(`repo.verdict.${n.verdict}`)}</span></a></li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <ExamPanel repo={repo.id} color={color} />
      {map ? <CodeMap map={map} risks={d.data.risks} /> : null}
      {d.data.landscape ? (
        <section className="panel">
          <div className="panel-head"><h2><Network size={17} aria-hidden="true" />{t('web.repos.landscapeTitle')}</h2><a className="link" href={hrefFor({ name: 'repos', tab: 'architecture' })}>{t('app.repos.tab.arch')}</a></div>
          <div className="panel-body"><Prose html={`<pre><code class="language-mermaid">${d.data.landscape.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`} /></div>
        </section>
      ) : null}
    </div>
  );
}

function Meter({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  return (
    <div className="meter-row" style={{ '--c': color } as CSSProperties}>
      <div className="row"><span className="small grow">{label}</span><span className="small muted num">{done} / {total}</span></div>
      <span className="bar tinted"><span style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></span>
    </div>
  );
}

function Detail({ data, id, setTitle }: { data: ReposData; id: string; setTitle?: (s: string) => void }) {
  const t = useT();
  const linked = data.repos.find((r) => r.id === id || r.name === id);
  const unlinked = data.unlinked.find((r) => r.name === id);
  const name = linked?.name ?? unlinked?.name ?? id;
  const product = linked?.product ?? unlinked?.product ?? '';
  const color = lineOf(product, productsOf(data));
  return (
    <div className="stack lg">
      <a className="btn ghost sm" style={{ alignSelf: 'flex-start' }} href={hrefFor({ name: 'repos' })}><ArrowLeft size={16} aria-hidden="true" />{t('app.repos.back')}</a>
      {linked ? <LinkedDetail id={linked.id} color={color} setTitle={setTitle} /> : unlinked ? (
        <>
          <LevelPanel name={name} level={unlinked.level} color={color} />
          <ExamPanel repo={unlinked.name} color={color} />
          <section className="panel"><div className="panel-head"><h2><Link2 size={17} aria-hidden="true" />{t('app.repos.linkTitle')}</h2></div><div className="panel-body"><LinkForm folder={unlinked.folder} name={unlinked.name} /></div></section>
          <section className="panel"><div className="panel-head"><h2><Terminal size={17} aria-hidden="true" />{t('app.repos.withClaude')}</h2></div><div className="panel-body stack">
            <p className="small muted">{t('app.repos.withClaudeWhy')}</p>
            <code className="cmd"><Terminal size={13} aria-hidden="true" />/okb-dev:onboard</code>
          </div></section>
        </>
      ) : <Empty title={t('app.repos.unknown', { id })} />}
    </div>
  );
}

/* ================================================================ the page */

export default function Repos({ route, setTitle }: { route: Extract<Route, { name: 'repos' }>; setTitle?: (s: string) => void }) {
  const t = useT();
  useScheme();
  const q = useQuery({ queryKey: ['repos'], queryFn: () => get<ReposData>('/api/repos') });
  if (route.tab === 'architecture') return <div className="page"><Suspense fallback={<SkeletonRows rows={6} />}><Arch route={route} /></Suspense></div>;
  if (q.isLoading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  if (route.id) return <div className="page"><Detail data={q.data} id={route.id} setTitle={setTitle} /></div>;
  const all = [
    ...q.data.repos.map((r) => ({ name: r.name, product: r.product ?? '', level: r.level, href: hrefFor({ name: 'repos', id: r.id }), linked: true })),
    ...q.data.unlinked.map((r) => ({ name: r.name, product: r.product, level: r.level, href: hrefFor({ name: 'repos', id: r.name }), linked: false })),
  ];
  const products = [...new Set(all.map((r) => r.product))].sort((a, b) => a.localeCompare(b));
  const unlinked = all.filter((r) => !r.linked).length;
  const active = q.data.tickets.filter((tk) => tk.status === 'active');
  return (
    <div className="page">
      <p className="page-intro">{t('app.repos.introShort')}</p>
      {unlinked ? <p className="notice plain small"><Link2 size={16} aria-hidden="true" />{t('app.repos.unlinkedNotice')}</p> : null}
      {active.length ? <Tickets tickets={active} showRepos /> : null}
      {all.length ? products.map((product) => {
        const color = lineOf(product, products);
        const rows = all.filter((r) => r.product === product).sort((a, b) => b.level.percent - a.level.percent || a.name.localeCompare(b.name));
        return (
          <section key={product || '-'} className="panel product" style={{ '--c': color } as CSSProperties} aria-labelledby={`p-${product}`}>
            <div className="panel-head"><span className="product-swatch" aria-hidden="true" /><h2 id={`p-${product}`}>{product || t('app.repos.noProduct')}</h2><span className="muted small">{tn(t, 'app.repos.count', rows.length)}</span></div>
            <ul className="repo-rows">{rows.map((r) => <RepoRow key={r.href} name={r.name} level={r.level} href={r.href} color={color} />)}</ul>
            <TierScale />
          </section>
        );
      }) : (
        <section className="panel"><Empty icon={<FolderGit2 size={22} />} title={t('app.repos.emptyTitle')} action={<code className="cmd"><Terminal size={13} aria-hidden="true" />cd &lt;repo&gt; &amp;&amp; okb repo add</code>}>{t('app.repos.empty')}</Empty></section>
      )}
      {q.data.repos.length > 1 ? <div className="row"><button type="button" className="btn" onClick={async () => { try { const r = await post<{ proposalId?: string }>('/api/repos/landscape', {}); if (r.proposalId) go({ name: 'inbox', tab: 'proposals', id: r.proposalId }); else toast(t('repo.questions.upToDate')); } catch (e) { toast((e as Error).message, 'err'); } }}><Sparkles size={15} aria-hidden="true" />{t('web.repos.landscape')}</button></div> : null}
    </div>
  );
}
