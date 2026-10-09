import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronLeft, ChevronRight, FolderOpen, FolderPlus, Link2, Star, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { currentKb, get, post, type Session } from '../app/api';
import { useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { Choice, Switch } from '../ui/Choice';
import { ConfirmDialog } from '../ui/Confirm';
import { LogoMark } from '../ui/Logo';
import { readLogo, readLook, readStyle } from '../app/theme';
import { ErrorState, SkeletonRows } from '../ui/States';

type Kb = Session['kbs'][number] & { owner?: 'this' | 'other' | 'none' };
const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'] as const;
const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');

/* ================================================================ the brains on this computer */

export function BrainsList() {
  const t = useT();
  const s = useQuery({ queryKey: ['session-full'], queryFn: () => get<Omit<Session, 'kbs'> & { kbs: Kb[] }>('/api/session') });
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState<Kb | null>(null);
  const [formats, setFormats] = useState<Record<string, string>>({});
  if (s.isLoading) return <SkeletonRows rows={4} />;
  if (s.error || !s.data) return <ErrorState error={s.error} retry={() => void s.refetch()} />;
  const open = async (id: string, makeActive = false) => {
    try { localStorage.setItem('okb-kb', id); } catch { /* private window */ }
    if (makeActive) { try { await post('/api/kb/switch', { id }); toast(t('app.brains.activeNow')); void s.refetch(); return; } catch (e) { toast((e as Error).message, 'err'); return; } }
    window.location.hash = '#/';
    window.location.reload();
  };
  const check = async (kb: Kb) => {
    try {
      const r = await get<{ legacy: number; notes: number; alreadyOkb: number; wikilinks: number }>('/api/kb/convert', { kb: kb.id });
      setFormats((f) => ({ ...f, [kb.id]: r.legacy ? `${t('kb.convert.counts', { notes: String(r.notes), legacy: String(r.legacy), okb: String(r.alreadyOkb), links: String(r.wikilinks) })} ${t('web.kb.convertHow')}` : t('kb.convert.nothing') }));
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const adopt = async (kb: Kb) => { try { await post('/api/kb/adopt', { kb: kb.id }); toast(t('kb.adopt.done', { root: kb.root, id: kb.id })); void s.refetch(); } catch (e) { toast((e as Error).message, 'err'); } };
  const remove = async (kb: Kb) => { await post('/api/kb/archive', { id: kb.id }); toast(t('kb.archived', { id: kb.id, where: '' })); window.location.reload(); };
  return (
    <>
      <p className="page-intro">{t('web.kb.lead')}</p>
      <ul className="grid-cards brain-cards">
        {s.data.kbs.map((kb) => (
          <li key={kb.id} className={`panel brain-card${kb.id === currentKb() ? ' current' : ''}`}>
            <div className="row" style={{ gap: 12 }}>
              <span className="kb-avatar lg" aria-hidden="true">{kb.name.slice(0, 1).toUpperCase()}</span>
              <div className="grow" style={{ minWidth: 0 }}><b>{kb.name}</b><small className="muted clip" style={{ display: 'block' }}>{short(kb.root)}</small></div>
              {kb.active ? <span className="pill sm accent"><Star size={12} aria-hidden="true" />{t('app.brains.active')}</span> : null}
            </div>
            <div className="row wrap">
              {kb.brain ? <span className="pill sm">{t(`brain.preset.${kb.brain}`)}</span> : kb.kind ? <span className="pill sm">{t(`kb.kind.${kb.kind}`)}</span> : null}
              <span className="pill sm">{t(`app.lang.${kb.writingLanguage}`)}</span>
              {!kb.exists ? <span className="pill sm err">{t('kb.missing')}</span> : null}
              {kb.owner === 'other' ? <span className="pill sm err">{t('err.kbOtherOwner.title')}</span> : null}
            </div>
            {formats[kb.id] ? <p className="notice plain small">{formats[kb.id]}</p> : null}
            <div className="row wrap brain-actions">
              <button type="button" className="btn sm primary" onClick={() => void open(kb.id)}><ArrowRight size={14} aria-hidden="true" />{t('web.kb.open')}</button>
              {!kb.active ? <button type="button" className="btn sm ghost" onClick={() => void open(kb.id, true)}>{t('web.kb.makeActive')}</button> : null}
              {kb.owner === 'none' ? <button type="button" className="btn sm ghost" onClick={() => void adopt(kb)}>{t('web.kb.adopt')}</button> : null}
              {!formats[kb.id] ? <button type="button" className="btn sm ghost" onClick={() => void check(kb)}>{t('web.kb.checkFormat')}</button> : null}
              <span className="spacer" />
              <button type="button" className="btn sm ghost icon" aria-label={t('web.kb.remove')} title={t('web.kb.remove')} onClick={() => setRemoving(kb)}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          </li>
        ))}
        <li><a className="panel dashed add-card" href={hrefFor({ name: 'settings', tab: 'new' })}><FolderPlus size={20} aria-hidden="true" />{t('app.kb.create')}</a></li>
        <li>{connecting ? <section className="panel"><div className="panel-body"><Connect back={() => setConnecting(false)} /></div></section> : <button type="button" className="panel dashed add-card" onClick={() => setConnecting(true)}><Link2 size={20} aria-hidden="true" />{t('app.brains.connect')}</button>}</li>
      </ul>
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(v) => { if (!v) setRemoving(null); }} title={t('web.kb.remove')} confirm={t('web.kb.remove')} danger onConfirm={() => (removing ? remove(removing) : undefined)}>
        {removing ? t('kb.archive.confirm', { id: removing.id, root: removing.root }) : null}
      </ConfirmDialog>
    </>
  );
}

/* ================================================================ connect a folder of notes */

export function Connect({ back }: { back: () => void }) {
  const t = useT();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [confidential, setConfidential] = useState(false);
  const go2 = async () => {
    if (!path.trim() || !name.trim()) { toast(t('wiz.required'), 'err'); return; }
    try {
      const r = await post<{ id: string; root: string }>('/api/kb/add', { path: path.trim(), name: name.trim(), confidential });
      toast(t('kb.add.done', { name: name.trim(), root: r.root }));
      try { localStorage.setItem('okb-kb', r.id); } catch { /* private window */ }
      window.location.hash = '#/';
      window.location.reload();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div className="stack lg">
      <h2>{t('wiz.start.add')}</h2>
      <div className="field"><label htmlFor="c-path">{t('kb.add.where')}</label><input id="c-path" className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Documents/mes-notes" autoFocus /></div>
      <div className="field"><label htmlFor="c-name">{t('wiz.name.q')}</label><input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('wiz.name.placeholder')} /></div>
      <label className="check-row"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />{t('kb.add.confidential')}</label>
      <p className="notice plain small">{t('web.kb.connectHelp')}</p>
      <div className="row"><button type="button" className="btn" onClick={back}>{t('web.back')}</button><span className="spacer" /><button type="button" className="btn primary" onClick={() => void go2()}><Check size={15} aria-hidden="true" />{t('web.kb.connect')}</button></div>
    </div>
  );
}

/* ================================================================ create a brain, step by step */

type WizardData = {
  context: { vaults: { path: string; kbs: string[] }[]; kbs: unknown[]; claude?: { cli: boolean; installed: boolean }; launcher?: { onPath: boolean; candidates: string[] }; sharedFocus: string | null };
  defaults: Answers;
};
type Answers = { name: string; root: string; uiLanguage: string; writingLanguage: string; preset: string; readerLevel: string; conceptAssist: string; requireTemplate: boolean; focus: string; plugin: boolean; launcher: string | null; adopt?: boolean; activate?: boolean };
type FolderCheck = { root: string; names: { folder: string; id: string }; check: { state: 'new' | 'empty' | 'okb' | 'foreign' | 'overlap'; with?: string; examples: string[] } };
const STEPS = ['name', 'where', 'lang', 'style', 'tools', 'recap'] as const;

export function Wizard({ first }: { first: boolean }) {
  const t = useT();
  const w = useQuery({ queryKey: ['wizard'], queryFn: () => get<WizardData>('/api/wizard') });
  const [a, setA] = useState<Answers | null>(null);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'quick' | 'custom'>('quick');
  const [folder, setFolder] = useState<FolderCheck | null>(null);
  const [suggested, setSuggested] = useState('');
  const [custom, setCustom] = useState('');
  const [done, setDone] = useState<{ id: string; steps: { step: string; ok: boolean; detail?: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (w.data && !a) setA({ ...w.data.defaults, name: '', root: '' }); }, [w.data, a]);
  const set = (patch: Partial<Answers>) => setA((x) => (x ? { ...x, ...patch } : x));
  // The folder follows the name until the person picks one.
  useEffect(() => {
    if (!a?.name.trim()) { setFolder(null); return; }
    const id = setTimeout(() => {
      void get<FolderCheck>('/api/wizard/folder', { name: a.name, root: a.root || '', kb: '' }).then((f) => { setFolder(f); if (!a.root) set({ root: f.root }); });
      if (!a.root) void get<FolderCheck>('/api/wizard/folder', { name: a.name, kb: '' }).then((f) => setSuggested(f.root));
    }, 200);
    return () => clearTimeout(id);
  }, [a?.name, a?.root]); // eslint-disable-line react-hooks/exhaustive-deps

  if (w.isLoading || !a) return <SkeletonRows rows={6} />;
  if (w.error || !w.data) return <ErrorState error={w.error} retry={() => void w.refetch()} />;
  const ctx = w.data.context;
  const s = STEPS[step]!;
  const next = () => {
    if (s === 'name' && !a.name.trim()) { toast(t('wiz.required'), 'err'); return; }
    if (s === 'where' && folder?.check.state === 'overlap') { toast(t('err.kbOverlap.title'), 'err'); return; }
    if (s === 'where' && folder?.check.state === 'foreign' && !a.adopt) { toast(t('err.kbForeign.title'), 'err'); return; }
    setStep(step + 1);
  };
  const create = async () => {
    setBusy(true);
    try { setDone(await post<{ id: string; steps: { step: string; ok: boolean; detail?: string }[] }>('/api/wizard', { answers: a })); } catch (e) { toast((e as Error).message, 'err'); setStep(0); } finally { setBusy(false); }
  };
  const seg = (label: string, key: keyof Answers, values: string[], prefix: string) => (
    <div className="field"><span className="label">{label}</span>
      <div className="segmented">{values.map((v) => <button type="button" key={v} aria-pressed={a[key] === v} title={t.has(`settings.hint.${prefix}.${v}`) ? t(`settings.hint.${prefix}.${v}`) : undefined} onClick={() => set({ [key]: v } as Partial<Answers>)}>{t(`settings.opt.${prefix}.${v}`)}</button>)}</div>
    </div>
  );
  const toggle = (label: string, key: 'requireTemplate' | 'plugin' | 'activate', help?: ReactNode) => (
    <div className="setting-row"><div className="grow"><b>{label}</b>{help ? <small className="muted">{help}</small> : null}</div><Switch on={Boolean(a[key])} onChange={(v) => set({ [key]: v } as Partial<Answers>)} label={label} /></div>
  );
  if (done) {
    return (
      <div className="stack lg">
        <p className="notice ok"><Check size={18} aria-hidden="true" />{t('wiz.outro', { name: a.name, id: done.id })}</p>
        <ul className="checks">{done.steps.map((r) => <li key={r.step}>{r.ok ? <Check size={17} className="ok-ink" aria-hidden="true" /> : <ChevronRight size={17} className="warn-ink" aria-hidden="true" />}<div className="stack" style={{ gap: 2 }}><span>{t(`wiz.step.${r.step}`)}</span>{r.detail ? <code className="xs muted">{r.detail}</code> : null}</div></li>)}</ul>
        <div className="row"><span className="spacer" /><button type="button" className="btn primary lg" onClick={() => { try { localStorage.setItem('okb-kb', done.id); } catch { /* private window */ } window.location.hash = '#/'; window.location.reload(); }}>{t('web.wizard.open')}<ArrowRight size={15} aria-hidden="true" /></button></div>
      </div>
    );
  }
  const opts = [suggested || folder?.root || '', ...ctx.vaults.filter((v) => v.kbs.length > 0).slice(0, 3).map((v) => `${v.path}/${folder?.names.folder ?? ''}`)].filter((p, i, all) => p && all.indexOf(p) === i);
  return (
    <div className="wizard stack lg">
      <header className="row" style={{ gap: 14 }}>
        <LogoMark logo={readLogo()} look={readLook()} style={readStyle()} size={40} />
        <div><h2>{first ? t('wiz.intro.first') : t('wiz.intro.new')}</h2><p className="small muted">{t('web.wizard.sub')}</p></div>
      </header>
      <ol className="stepper">
        {STEPS.map((x, i) => <li key={x} className={i === step ? 'now' : i < step ? 'done' : ''}><button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}><span className="step-n num">{i < step ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{t(`web.wizard.step.${x}`)}</button></li>)}
      </ol>
      <section className="panel"><div className="panel-body stack lg wizard-body">
        {s === 'name' ? (
          <>
            <div className="field"><label htmlFor="w-name">{t('wiz.name.q')}</label><input id="w-name" className="input lg" value={a.name} onChange={(e) => set({ name: e.target.value, root: '' })} onKeyDown={(e) => { if (e.key === 'Enter') next(); }} placeholder={t('wiz.name.placeholder')} autoFocus />{folder ? <small>{t('wiz.name.derived', { folder: folder.names.folder, id: folder.names.id })}</small> : null}</div>
            <p className="notice plain small">{t('web.wizard.nameHelp')}</p>
          </>
        ) : s === 'where' ? (
          <>
            <span className="label strong">{t('wiz.where.q', { name: a.name })}</span>
            <div className="choices column">{opts.map((p, i) => <Choice key={p} on={a.root === p} star={i === 0} title={<span className="row" style={{ gap: 8 }}><FolderOpen size={15} aria-hidden="true" />{short(p)}</span>} text={i === 0 ? t('wiz.where.suggested') : t('wiz.where.vault')} onClick={() => { set({ root: p }); setCustom(''); }} />)}</div>
            <div className="field"><label htmlFor="w-root">{t('wiz.where.other')}</label><input id="w-root" className="input" value={custom} placeholder={t('wiz.where.path')} onChange={(e) => setCustom(e.target.value)} onBlur={() => { if (custom.trim()) set({ root: custom.trim() }); }} /></div>
            {folder ? (
              folder.check.state === 'overlap' ? <p className="notice err">{t('err.kbOverlap.why', { other: folder.check.with ?? '', root: a.root })}</p>
                : folder.check.state === 'foreign' ? <div className="notice warn"><div className="stack" style={{ gap: 8 }}><span>{t('wiz.where.foreignNote', { root: a.root, example: folder.check.examples[0] ?? '' })}</span><label className="check-row"><input type="checkbox" checked={Boolean(a.adopt)} onChange={(e) => set({ adopt: e.target.checked })} />{t('wiz.where.adopt')}</label></div></div>
                  : folder.check.state === 'okb' ? <p className="notice plain">{t('wiz.where.existing')}</p>
                    : <p className="notice ok"><Check size={16} aria-hidden="true" />{folder.check.state === 'new' ? t('web.wizard.folderNew') : t('web.wizard.folderEmpty')}</p>
            ) : null}
          </>
        ) : s === 'lang' ? (
          <>
            <div className="field"><span className="label">{t('settings.label.ui.language')}</span><div className="segmented">{['fr', 'en', 'auto'].map((l) => <button type="button" key={l} aria-pressed={a.uiLanguage === l} onClick={() => set({ uiLanguage: l })}>{l === 'auto' ? t('wiz.lang.auto') : t(`app.lang.${l}`)}</button>)}</div></div>
            <div className="field"><span className="label">{t('wiz.writing.q')}</span><div className="segmented">{LANGS.map((l) => <button type="button" key={l} aria-pressed={a.writingLanguage === l} onClick={() => set({ writingLanguage: l })}>{t(`app.lang.${l}`)}</button>)}</div></div>
            <p className="notice plain small">{t('web.wizard.langHelp')}</p>
          </>
        ) : s === 'style' ? (
          <>
            <div className="choices">
              <Choice on={mode === 'quick'} star title={t('wiz.mode.quick')} text={t('wiz.mode.quickHint')} onClick={() => { setMode('quick'); set({ preset: 'standard', readerLevel: 'intermediate', conceptAssist: 'targeted', requireTemplate: true }); }} />
              <Choice on={mode === 'custom'} title={t('wiz.mode.custom')} text={t('wiz.mode.customHint')} onClick={() => setMode('custom')} />
            </div>
            {mode === 'custom' ? (
              <>
                {seg(t('wiz.reader.q'), 'readerLevel', ['beginner', 'intermediate', 'expert'], 'reader.level')}
                {seg(t('wiz.style.q'), 'preset', ['standard', 'pedagogique', 'expert'], 'writing.preset')}
                {seg(t('wiz.help.q'), 'conceptAssist', ['targeted', 'pedagogical', 'off'], 'conceptAssist.level')}
                <div className="field"><span className="label">{t('wiz.focus.q')}</span><div className="segmented">{[...(ctx.sharedFocus ? ['shared'] : []), 'create', 'later'].map((v) => <button type="button" key={v} aria-pressed={a.focus === v} onClick={() => set({ focus: v })}>{t(`wiz.focus.${v}`)}</button>)}</div></div>
                {toggle(t('wiz.templates.q'), 'requireTemplate')}
              </>
            ) : null}
          </>
        ) : s === 'tools' ? (
          <>
            {ctx.claude?.cli && !ctx.claude.installed ? toggle(t('wiz.plugin.q'), 'plugin') : null}
            {!first ? toggle(t('wiz.activate.q', { name: a.name }), 'activate') : null}
            {!(ctx.claude?.cli && !ctx.claude.installed) && first ? <p className="notice ok"><Check size={16} aria-hidden="true" />{t('web.wizard.nothingToAdd')}</p> : null}
          </>
        ) : (
          <table className="table recap">
            <tbody>
              {[
                [t('wiz.recap.kb'), `${a.name} (${folder?.names.folder ?? ''})`], [t('wiz.recap.folder'), short(a.root)],
                [t('wiz.recap.uiLang'), a.uiLanguage === 'auto' ? t('wiz.lang.auto') : t(`app.lang.${a.uiLanguage}`)], [t('wiz.recap.writingLang'), t(`app.lang.${a.writingLanguage}`)],
                [t('wiz.recap.style'), `${t(`settings.opt.writing.preset.${a.preset}`)} · ${t(`settings.opt.reader.level.${a.readerLevel}`)}`],
                [t('wiz.recap.help'), t(`settings.opt.conceptAssist.level.${a.conceptAssist}`)], [t('wiz.recap.focus'), t(`wiz.focus.${a.focus}`)],
              ].map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{v}</td></tr>)}
            </tbody>
          </table>
        )}
      </div></section>
      <div className="row">
        {step > 0 ? <button type="button" className="btn" onClick={() => setStep(step - 1)}><ChevronLeft size={15} aria-hidden="true" />{t('web.back')}</button> : first ? null : <a className="btn ghost" href={hrefFor({ name: 'settings', tab: 'brains' })}>{t('web.cancel')}</a>}
        <span className="spacer" />
        {step < STEPS.length - 1 ? <button type="button" className="btn primary" onClick={next}>{t('web.next')}<ChevronRight size={15} aria-hidden="true" /></button>
          : <button type="button" className="btn primary lg" disabled={busy} aria-busy={busy} onClick={() => void create()}><Check size={16} aria-hidden="true" />{t('wiz.go.yes')}</button>}
      </div>
    </div>
  );
}

/** The first run: no brain yet on this computer — create one, or connect a folder of notes. */
export function FirstChoice() {
  const t = useT();
  const [path, setPath] = useState<'pick' | 'create' | 'connect'>('pick');
  if (path === 'create') return <Wizard first />;
  if (path === 'connect') return <Connect back={() => setPath('pick')} />;
  return (
    <div className="stack lg">
      <header className="row" style={{ gap: 14 }}>
        <LogoMark logo={readLogo()} look={readLook()} style={readStyle()} size={44} />
        <div><h2>{t('app.kb.noneTitle')}</h2><p className="muted">{t('wiz.start.q')}</p></div>
      </header>
      <p className="muted">{t('app.kb.noneWhy')}</p>
      <div className="choices column">
        <Choice on={false} star title={t('wiz.start.create')} text={t('wiz.start.createHint')} onClick={() => setPath('create')} />
        <Choice on={false} title={t('wiz.start.add')} text={t('wiz.start.addHint')} onClick={() => setPath('connect')} />
      </div>
    </div>
  );
}
