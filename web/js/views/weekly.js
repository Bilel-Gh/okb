import { h, frag, t, tn, get, post, icon, fmtDate, rel, loading, noteBox, toast, errorToast } from '../core.js';
import { setTitle, go, refreshStatus } from '../main.js';

const STEPS = ['inbox', 'proposals', 'reread', 'focus', 'health', 'next'];

export async function render({ mount, query }) {
  setTitle(t('weekly.title'));
  mount.append(loading(6));
  const r = await get('/api/weekly');
  mount.replaceChildren();
  let step = Math.max(0, STEPS.indexOf(query.get('step') ?? 'inbox'));
  const stepper = h('div', { class: 'steps' });
  const body = h('div', { class: 'card', style: { minHeight: '260px' } });
  const nav = h('div', { class: 'row', style: { marginTop: '14px' } });
  mount.append(h('p', { class: 'lead' }, `${t('weekly.period', { from: fmtDate(r.period.from), to: fmtDate(r.period.to) })} · ${t('web.weekly.lead')}`), stepper, body, nav);

  const draw = () => {
    stepper.replaceChildren(...STEPS.map((s, i) => h('div', { class: `s${i === step ? ' on' : i < step ? ' done' : ''}`, style: { cursor: 'pointer' }, onclick: () => { step = i; draw(); } }, h('span', { class: 'n' }, i < step ? '✓' : String(i + 1)), t(`web.weekly.step.${s}`))));
    body.replaceChildren(frag(content(STEPS[step], r)));
    nav.replaceChildren(
      step > 0 ? h('button', { class: 'btn', onclick: () => { step--; draw(); } }, t('web.back')) : h('span'),
      h('span', { class: 'spacer' }),
      step < STEPS.length - 1 ? h('button', { class: 'btn primary', onclick: () => { step++; draw(); } }, t('web.next'), icon('right', 15)) : h('a', { class: 'btn primary', href: '#/' }, t('web.weekly.finish')));
  };
  draw();
}

function content(step, r) {
  if (step === 'inbox') return [h('h2', null, `📥 ${t('weekly.inbox')}`),
    r.inbox.open ? h('p', null, tn('weekly.inboxOpen', r.inbox.open, { days: r.inbox.oldestDays ?? 0 })) : noteBox('ok', t('weekly.inboxEmpty')),
    ...r.inbox.stale.map((i) => h('div', { class: 'list-item' }, icon('alert', 16), h('div', { class: 'grow' }, h('div', null, i.title), h('div', { class: 'sub' }, tn('weekly.days', i.ageDays))))),
    r.inbox.open ? h('a', { class: 'btn', href: '#/inbox' }, t('web.home.sortInbox')) : null];
  if (step === 'proposals') return [h('h2', null, `⏳ ${t('weekly.proposals')}`),
    r.proposals.prepared.length ? h('div', { class: 'list' }, r.proposals.prepared.map((p) => h('div', { class: 'list-item', onclick: () => go(`#/proposal/${p.id}`) }, h('div', { class: 'grow' }, h('div', { class: 'title' }, p.label || p.id), h('div', { class: 'sub' }, `${tn('weekly.days', p.ageDays)} · ${tn('review.files', p.changes)}`)), icon('right', 16)))) : noteBox('ok', t('weekly.noProposals')),
    h('div', { class: 'small muted', style: { marginTop: '10px' } }, t('weekly.appliedLine', { receipts: r.applied.receipts, created: r.applied.created.length, updated: r.applied.updated.length }))];
  if (step === 'reread') return [h('h2', null, `🔁 ${t('weekly.reread')}`), h('p', { class: 'muted' }, t('web.weekly.rereadText')),
    r.toReview.length ? h('div', { class: 'list' }, r.toReview.map((n) => h('div', { class: 'list-item', onclick: () => go(`#/note/${encodeURIComponent(n.path)}`) }, h('span', { class: 'badge brand' }, `J+${n.milestone}`), h('div', { class: 'grow' }, h('div', { class: 'title' }, n.title), h('div', { class: 'sub mono' }, n.path))))) : noteBox('info', t('weekly.rereadNone')),
    h('a', { class: 'btn', href: '#/learn', style: { marginTop: '12px' } }, icon('learn', 15), t('web.weekly.quiz'))];
  if (step === 'focus') return [h('h2', null, `🎯 ${t('weekly.focus')}`),
    noteBox(r.focus.exists ? (r.focus.stale ? 'warn' : 'ok') : 'info', r.focus.exists ? (r.focus.stale ? t('weekly.focusStale', { days: r.focus.ageDays }) : t('weekly.focusOk', { days: r.focus.ageDays })) : t('weekly.focusNone')),
    h('p', null, tn('weekly.sessions', r.sessions.count)),
    ...r.sessions.next.map((s) => h('div', { class: 'list-item' }, icon('right', 16), h('div', { class: 'grow' }, h('div', null, s.next), h('div', { class: 'sub' }, `${rel(s.at)} · ${s.profile}`)))),
    h('a', { class: 'btn', href: '#/focus' }, r.focus.exists ? t('web.home.updateFocus') : t('web.home.writeFocus'))];
  if (step === 'health') return [h('h2', null, `🩺 ${t('weekly.maintenance')}`),
    noteBox(r.maintenance.errors ? 'err' : r.maintenance.warnings ? 'warn' : 'ok', `${tn('status.errors', r.maintenance.errors)} · ${tn('status.warnings', r.maintenance.warnings)}`),
    h('a', { class: 'btn', href: '#/health', style: { marginTop: '10px' } }, t('web.weekly.seeHealth'))];
  const idea = h('textarea', { class: 'textarea', placeholder: t('web.weekly.nextPlaceholder') });
  return [h('h2', null, `🧭 ${t('web.weekly.step.next')}`), h('p', { class: 'muted' }, t('web.weekly.nextText')), idea,
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: async () => {
      if (!idea.value.trim()) return;
      try { await post('/api/capture', { text: idea.value, title: t('web.weekly.nextTitle'), tags: ['weekly'] }); toast(t('web.inbox.captured')); idea.value = ''; refreshStatus(); } catch (e) { errorToast(e); }
    } }, t('web.weekly.saveNext')))];
}
