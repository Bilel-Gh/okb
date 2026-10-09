import { BookOpen, CircleHelp, Keyboard, Play, Search, Sparkles, Terminal } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { SkeletonRows } from '../ui/States';

const TERMS = ['kb', 'proposal', 'approval', 'receipt', 'profile', 'concept', 'inbox', 'focus', 'journal', 'template', 'style', 'evidence', 'okf', 'plugin', 'skill', 'hook'];
type TourStep = { n?: number; title: string; body: string; detail?: string };

/** Help: a guided tour on a throwaway brain, the words of OKB, the shortcuts, what an error code means. */
export default function Help() {
  const t = useT();
  const [tour, setTour] = useState<TourStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [explained, setExplained] = useState<{ title: string; explain: string; fix?: string } | null>(null);
  const start = async () => {
    setBusy(true);
    try { setTour((await post<{ steps: TourStep[] }>('/api/tour')).steps); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const explain = async () => {
    if (!code.trim()) return;
    try { setExplained(await get<{ title: string; explain: string; fix?: string }>('/api/explain', { code: code.trim() })); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div className="page">
      <section className="panel hero help-hero">
        <div className="stack" style={{ gap: 8 }}>
          <h2>{t('web.help.title')}</h2>
          <p className="muted">{t('home.welcome')}</p>
          <span><button type="button" className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void start()}><Play size={15} aria-hidden="true" />{t('web.help.tour')}</button></span>
        </div>
      </section>
      {busy ? <SkeletonRows rows={5} /> : null}
      {tour ? (
        <ol className="tour">
          {tour.map((s) => (
            <li key={s.title} className="panel">
              <div className="panel-body stack" style={{ paddingTop: 18 }}>
                <div className="row">{s.n ? <span className="step-n num">{s.n}</span> : null}<b>{s.title}</b></div>
                <p>{s.body}</p>
                {s.detail ? <pre className="code-block">{s.detail}</pre> : null}
              </div>
            </li>
          ))}
          <li><p className="notice ok"><Sparkles size={17} aria-hidden="true" />{t('tour.outro')}</p></li>
        </ol>
      ) : null}
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2><BookOpen size={17} aria-hidden="true" />{t('web.help.glossary')}</h2></div>
          <dl className="glossary">
            {TERMS.map((k) => <div key={k}><dt>{t(`glossary.${k}.term`)}</dt><dd>{t(`glossary.${k}.def`)}</dd></div>)}
          </dl>
        </section>
        <div className="stack lg">
          <section className="panel">
            <div className="panel-head"><h2><Keyboard size={17} aria-hidden="true" />{t('web.help.shortcuts')}</h2></div>
            <div className="panel-body stack small">
              <p className="row"><kbd>⌘K</kbd><kbd>/</kbd><span>{t('web.help.kPalette')}</span></p>
              <p className="row"><kbd>⌘\</kbd><span>{t('app.help.kRail')}</span></p>
              <p className="row"><kbd>⌘↵</kbd><span>{t('web.help.kCapture')}</span></p>
              <p className="row"><kbd>␣</kbd><kbd>1–4</kbd><span>{t('app.help.kLearn')}</span></p>
              <p className="row"><kbd>↑</kbd><kbd>↓</kbd><span>{t('app.help.kList')}</span></p>
              <p className="row"><kbd>{t.lang === 'fr' ? 'Échap' : 'Esc'}</kbd><span>{t('app.help.kEscape')}</span></p>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2><Sparkles size={17} aria-hidden="true" />{t('web.help.claude')}</h2><a className="link" href={hrefFor({ name: 'claude' })}>{t('app.nav.claude')}</a></div>
            <div className="panel-body stack">
              <p className="small muted">{t('help.claude')}</p>
              {['/okb:menu', '/okb:ingest', '/okb:ask', '/okb:done', '/okb:weekly'].map((c) => <code key={c} className="cmd"><Terminal size={13} aria-hidden="true" />{c}</code>)}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2><CircleHelp size={17} aria-hidden="true" />{t('web.help.explain')}</h2></div>
            <div className="panel-body stack">
              <div className="search-field"><Search size={16} aria-hidden="true" /><input className="input" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void explain(); }} placeholder="E_STALE, LINK_BROKEN_TARGET…" aria-label={t('web.help.explain')} /></div>
              {explained ? <div className="notice plain"><div className="stack" style={{ gap: 4 }}><b>{explained.title}</b><span>{explained.explain}</span>{explained.fix ? <span className="small">→ {explained.fix}</span> : null}</div></div> : null}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2><Terminal size={17} aria-hidden="true" />{t('web.help.terminal')}</h2></div>
            <div className="panel-body stack"><p className="small muted">{t('web.help.terminalText')}</p><code className="cmd">okb</code><code className="cmd">okb help</code></div>
          </section>
        </div>
      </div>
    </div>
  );
}
