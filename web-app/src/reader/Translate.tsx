import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Languages, Save } from 'lucide-react';
import { useState } from 'react';
import { ApiError, currentKb, currentSession, get, post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { hrefFor } from '../app/router';
import { toast } from '../app/toast';
import { ErrorState } from '../ui/States';
import { TokenUsage } from '../ui/TokenUsage';
import { useShareWords } from '../app/sharing';

const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'] as const;
type Estimate = { tokens: number; cached: number; toTranslate: number; budget?: { spent: number; daily: number }; hash?: string };
type Result = { ok: true; title: string; html: string; translated: number; failed: number; cached: number; tokens: number; estimated?: boolean };

/**
 * Translate, on request only: the cost first (nothing is translated in advance),
 * « En bref » before the whole note, and « save as a note » as a proposal.
 */
export function Translate({ path, source: noteLang, onShow, shown }: { path: string; source?: string; onShow: (v: { html: string; lang: string } | null) => void; shown: string | null }) {
  const t = useT();
  const w = useShareWords();
  const source = (noteLang ?? currentSession()?.kbs.find((k) => k.id === currentKb())?.writingLanguage ?? 'fr').slice(0, 2);
  const choices = LANGS.filter((l) => l !== source);
  const [lang, setLang] = useState<string>(choices.includes(t.lang as (typeof LANGS)[number]) ? t.lang : choices[0]!);
  const [scope, setScope] = useState<'brief' | 'full'>('brief');
  const [open, setOpen] = useState(false);
  const [confirmSecret, setConfirmSecret] = useState(false);
  // The scope of the translation on screen: « save as a note » needs the whole note translated.
  const [doneScope, setDoneScope] = useState<'brief' | 'full' | null>(null);
  const estimate = useQuery({
    queryKey: ['translate-estimate', path, lang, scope, confirmSecret],
    queryFn: () => get<Estimate>('/api/translate/estimate', { path, lang, scope, confirmSecret: confirmSecret ? '1' : undefined }),
    enabled: open, retry: false,
  });
  const run = useMutation({
    // A yes for a 🔒 note holds for the content the estimate described (its hash), never for a later version.
    mutationFn: () => post<Result>('/api/translate', { path, lang, scope, confirmSecret: confirmSecret && estimate.data?.hash ? estimate.data.hash : false }),
    onSuccess: (r) => {
      onShow({ html: r.html, lang });
      setDoneScope(scope);
      if (r.failed) toast(tn(t, 'app.translate.partial', r.failed));
      setOpen(false);
    },
  });
  const save = useMutation({
    mutationFn: () => post<{ ok: true; proposalId: string }>('/api/translate/save', { path, lang }),
    onSuccess: (r) => { toast(t('app.translate.saved')); window.location.hash = hrefFor({ name: 'inbox', tab: 'proposals', id: r.proposalId }).slice(1); },
    onError: (e) => toast((e as Error).message, 'err'),
  });
  const secret = estimate.error instanceof ApiError && estimate.error.key === 'translateSecret';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="btn sm" aria-label={t('app.translate.button')}><Languages size={15} aria-hidden="true" /><span className="hide-narrow">{shown ? shown.toUpperCase() : t('app.translate.button')}</span></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu translate" align="end" sideOffset={6}>
          <div className="stack" style={{ padding: 'var(--s3)', gap: 'var(--s3)', width: 300 }}>
            <div className="field">
              <label htmlFor="tr-lang">{t('app.translate.into')}</label>
              <select id="tr-lang" className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
                {choices.map((l) => <option key={l} value={l}>{t(`app.lang.${l}`)}</option>)}
              </select>
            </div>
            <div className="segmented" role="group" aria-label={t('app.translate.scope')}>
              <button type="button" aria-pressed={scope === 'brief'} onClick={() => setScope('brief')}>{t('app.translate.brief')}</button>
              <button type="button" aria-pressed={scope === 'full'} onClick={() => setScope('full')}>{t('app.translate.full')}</button>
            </div>
            {estimate.error ? (
              <div className="stack" style={{ gap: 'var(--s2)' }}>
                <ErrorState error={estimate.error} />
                {secret ? <label className="row small"><input type="checkbox" checked={confirmSecret} onChange={(e) => setConfirmSecret(e.target.checked)} />{t('app.translate.confirmSecret')}</label> : null}
              </div>
            ) : (
              <p className="small muted" aria-live="polite">
                {estimate.isLoading ? t('app.loading') : estimate.data ? (estimate.data.tokens ? `${t('app.translate.cost', { tokens: estimate.data.tokens })}${estimate.data.cached ? ` ${tn(t, 'app.translate.cached', estimate.data.cached)}` : ''}${estimate.data.budget ? ` ${t('app.translate.left', { left: Math.max(0, estimate.data.budget.daily - estimate.data.budget.spent).toLocaleString(t.lang) })}` : ''}` : t('app.translate.free')) : null}
              </p>
            )}
            {run.error ? <ErrorState error={run.error} /> : null}
            {run.data ? <p className="small muted">{w('Dernière traduction : ', 'Last translation: ')}<TokenUsage tokens={run.data.tokens} estimated={run.data.estimated} /></p> : null}
            <div className="row">
              <button type="button" className="btn primary sm" disabled={!estimate.data || run.isPending} aria-busy={run.isPending} onClick={() => run.mutate()}>{run.isPending ? t('app.translate.running') : t('app.translate.go')}</button>
              {shown === lang && scope === 'full' && doneScope === 'full' ? <button type="button" className="btn sm" disabled={save.isPending} onClick={() => save.mutate()}><Save size={14} aria-hidden="true" />{t('app.translate.save')}</button> : null}
            </div>
            <p className="xs muted">{t('app.translate.note')}</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
