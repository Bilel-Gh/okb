import { state, h, t, tn, get, post, icon, rel, fmtDate, langName, toast, errorToast, loading, cmdBox, categories, catColor, catDot } from '../core.js';
import { setTitle, refreshStatus, go } from '../main.js';

function tile(label, value, hint, ico, onClick, tone) {
  return h('div', { class: `card hover tile`, onclick: onClick, role: 'button', tabindex: '0' },
    h('div', { class: 'label' }, icon(ico, 15), label),
    h('div', { class: 'value', style: tone ? { color: `var(--${tone})` } : null }, value),
    h('div', { class: 'hint' }, hint));
}

function greeting() {
  const hour = new Date().getHours();
  return t(hour < 6 ? 'web.home.night' : hour < 12 ? 'web.home.morning' : hour < 18 ? 'web.home.afternoon' : 'web.home.evening');
}

export async function render({ mount }) {
  setTitle(t('web.nav.home'));
  mount.append(loading(5));
  const s = state.status ?? (await get('/api/status'));
  mount.replaceChildren();

  const suggestions = [];
  if (s.pending.length) suggestions.push({ ico: 'review', text: tn('status.pendingCount', s.pending.length), action: t('web.home.reviewNow'), to: s.pending.length === 1 ? `#/proposal/${s.pending[0].id}` : '#/review', primary: true });
  if (!s.focus.exists) suggestions.push({ ico: 'focus', text: t('web.home.noFocus'), action: t('web.home.writeFocus'), to: '#/focus' });
  else if (s.focus.stale) suggestions.push({ ico: 'focus', text: t('status.focusStale', { age: s.focus.ageDays }), action: t('web.home.updateFocus'), to: '#/focus' });
  if (s.inbox.open) suggestions.push({ ico: 'inbox', text: tn('status.inboxOpen', s.inbox.open, { days: s.inbox.oldestDays ?? 0 }), action: t('web.home.sortInbox'), to: '#/inbox' });
  if (s.toReview) suggestions.push({ ico: 'learn', text: tn('status.toReviewCount', s.toReview), action: t('web.home.reread'), to: '#/weekly' });
  // The weekly review on Sunday or Monday, once there is something to review.
  if ((new Date().getDay() === 1 || new Date().getDay() === 0) && (s.notes > 0 || s.inbox.open > 0)) suggestions.push({ ico: 'weekly', text: t('web.home.weeklyTime'), action: t('web.home.startWeekly'), to: '#/weekly' });
  if (!suggestions.length) suggestions.push({ ico: 'source', text: t('web.home.allClear'), action: t('web.home.addSource'), to: '#/source' });

  const quick = h('input', { class: 'input', placeholder: t('web.home.quickCapture') });
  const quickBtn = h('button', { class: 'btn primary', onclick: async () => {
    const text = quick.value.trim();
    if (!text) return;
    try { await post('/api/capture', { text }); quick.value = ''; toast(t('web.inbox.captured')); refreshStatus(); } catch (e) { errorToast(e); }
  } }, icon('plus', 16), t('web.home.capture'));
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickBtn.click(); });

  const h1 = s.health;
  // The shape of the KB: how many notes of each kind, one click to the graph.
  const kbShape = h('div', { class: 'card hover', role: 'button', tabindex: '0', onclick: () => go('#/graph') },
    h('div', { class: 'card-head' }, icon('graph', 17), h('h2', null, t('web.home.shape')), h('span', { class: 'spacer' }), h('span', { class: 'btn sm' }, t('web.graph.see'))),
    loading(1));
  categories().then((cats) => {
    const used = cats.filter((c) => c.count);
    const total = used.reduce((n, c) => n + c.count, 0);
    if (!total) { kbShape.remove(); return; }
    kbShape.lastChild.replaceWith(h('div', { class: 'stack', style: { gap: '10px' } },
      h('div', { class: 'cat-bar' }, used.map((c) => h('span', { title: `${c.name} : ${c.count}`, style: { width: `${(c.count / total) * 100}%`, background: catColor(c) } }))),
      h('div', { class: 'row small', style: { gap: '14px', flexWrap: 'wrap' } }, used.map((c) => h('span', { class: 'row', style: { gap: '6px' } }, catDot(c, 9), `${c.emoji} ${c.name}`, h('b', null, String(c.count)))))));
  }).catch(() => kbShape.remove());
  mount.append(
    h('div', { class: 'hero' },
      h('div', { class: 'muted small' }, greeting()),
      h('h2', null, s.name),
      h('div', { class: 'row muted' },
        h('span', null, tn('status.notes', s.notes, { concepts: s.concepts })), '·',
        h('span', null, t('status.writing', { lang: langName(s.writingLanguage) })),
        null)),
    h('div', { style: { height: '16px' } }),
    h('div', { class: 'grid cols-4' },
      tile(t('status.pending'), String(s.pending.length), s.pending.length ? t('web.home.waitingYou') : t('status.pendingNone'), 'review', () => go('#/review'), s.pending.length ? 'brand' : null),
      tile(t('status.inbox'), String(s.inbox.open), s.inbox.open ? t('web.home.toSort') : t('status.inboxEmpty'), 'inbox', () => go('#/inbox')),
      tile(t('status.focus'), s.focus.exists ? `${s.focus.ageDays ?? 0} ${t('web.daysShort')}` : '—', s.focus.exists ? (s.focus.stale ? t('web.home.stale') : t('web.home.fresh')) : t('web.home.none'), 'focus', () => go('#/focus'), s.focus.stale ? 'warn' : null),
      tile(t('status.health'), h1 ? `${h1.score}` : '—', h1 ? `${tn('status.errors', h1.errors)} · ${tn('status.warnings', h1.warnings)}` : '', 'health', () => go('#/health'), h1?.errors ? 'err' : null)),
    h('div', { style: { height: '16px' } }),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('sparkles', 17), h('h2', null, t('web.home.next'))),
        h('div', { class: 'list' }, suggestions.slice(0, 4).map((x) => h('div', { class: 'list-item', onclick: () => go(x.to) },
          h('span', { style: { color: 'var(--brand)' } }, icon(x.ico, 18)),
          h('div', { class: 'grow' }, h('div', null, x.text)),
          h('button', { class: `btn sm ${x.primary ? 'primary' : ''}` }, x.action))))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, icon('journal', 17), h('h2', null, t('status.lastSession'))),
        s.lastSession
          ? h('div', { class: 'stack' },
            h('div', null, h('div', { style: { fontWeight: 600 } }, s.lastSession.summary), h('div', { class: 'small muted' }, `${fmtDate(s.lastSession.at)} · ${s.lastSession.profile}`)),
            s.lastSession.next ? h('div', { class: 'note-box ok' }, icon('right', 16), h('div', null, h('b', null, t('focus.nextTime')), ' ', s.lastSession.next)) : null,
            h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '#/focus?done=1' }, t('web.home.endSession')), h('a', { class: 'btn sm ghost', href: '#/focus' }, t('web.home.journal'))))
          : h('div', { class: 'stack' }, h('div', { class: 'muted' }, t('web.home.noSession')), h('div', null, h('a', { class: 'btn sm', href: '#/focus?done=1' }, t('web.home.endSession')))))),
    h('div', { style: { height: '16px' } }),
    kbShape,
    h('div', { style: { height: '16px' } }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('inbox', 17), h('h2', null, t('web.home.captureTitle'))),
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, quick, quickBtn),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, t('capture.where'))),
    h('div', { style: { height: '16px' } }),
    h('div', { class: 'card flat' },
      h('div', { class: 'card-head' }, icon('terminal', 17), h('h2', null, t('web.home.claudeTitle'))),
      h('p', { class: 'muted', style: { marginTop: 0 } }, t('web.home.claudeText')),
      h('div', { class: 'grid cols-2' }, cmdBox('/okb:ingest'), cmdBox('/okb:done'))),
  );
  if (s.lastApply) mount.append(h('p', { class: 'small muted', style: { marginTop: '16px' } }, `${t('status.lastApply')} : ${rel(s.lastApply.appliedAt)} · ${tn('status.files', s.lastApply.files)}`));
}
