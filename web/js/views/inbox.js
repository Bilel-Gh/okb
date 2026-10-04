import { h, t, tn, get, post, icon, rel, badge, empty, loading, toast, errorToast, promptDialog, cmdBox } from '../core.js';
import { setTitle, refreshStatus, route } from '../main.js';

export async function render({ mount, query }) {
  setTitle(t('web.nav.inbox'));
  const text = h('textarea', { class: 'textarea', placeholder: t('capture.placeholder'), style: { minHeight: '84px' } });
  const source = h('input', { class: 'input', placeholder: t('web.inbox.sourcePlaceholder') });
  const save = h('button', { class: 'btn primary', onclick: async () => {
    if (!text.value.trim()) return;
    try { await post('/api/capture', { text: text.value, source: source.value }); toast(t('web.inbox.captured')); text.value = ''; source.value = ''; await refreshStatus(); route(); } catch (e) { errorToast(e); }
  } }, icon('plus', 16), t('web.inbox.capture'));
  text.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save.click(); });
  mount.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, icon('inbox', 17), h('h2', null, t('web.inbox.captureTitle'))),
    h('div', { class: 'stack', style: { gap: '8px' } }, text, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, source, save)),
    h('div', { class: 'small muted', style: { marginTop: '8px' } }, t('capture.where'))));
  if (query.get('new') === '1') setTimeout(() => text.focus(), 40);

  const showAll = query.get('all') === '1';
  const listBox = h('div', { class: 'stack', style: { marginTop: '18px' } }, loading());
  mount.append(h('div', { class: 'row', style: { marginTop: '22px' } }, h('h2', { style: { margin: 0 } }, t('web.inbox.waiting')), h('span', { class: 'spacer' }),
    h('a', { class: 'btn sm ghost', href: showAll ? '#/inbox' : '#/inbox?all=1' }, showAll ? t('web.inbox.onlyOpen') : t('web.inbox.history'))), listBox);
  const { items } = await get('/api/inbox', { all: showAll ? 1 : '' });
  listBox.replaceChildren();
  if (!items.length) { listBox.append(empty('📭', t('inbox.empty'), t('web.inbox.emptyText'))); return; }
  listBox.append(h('div', { class: 'muted small' }, tn('web.inbox.count', items.filter((i) => i.status === 'open').length)));
  for (const item of items) {
    const settle = async (status) => {
      let reason;
      if (status === 'dropped') { reason = await promptDialog({ title: t('inbox.triage.why'), placeholder: t('inbox.triage.whyPlaceholder'), ok: t('inbox.triage.drop') }); if (reason === null) return; }
      try { await post('/api/inbox/settle', { id: item.id, status, reason }); toast(status === 'done' ? t('inbox.settledDone', { title: item.title }) : t('inbox.settledDrop', { title: item.title })); await refreshStatus(); route(); } catch (e) { errorToast(e); }
    };
    const claude = h('div', { style: { display: 'none', marginTop: '10px' } }, h('div', { class: 'small muted', style: { marginBottom: '6px' } }, t('web.inbox.claudeHow')), cmdBox(`/okb:ingest ${item.path}`));
    listBox.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', null, item.title), item.status !== 'open' ? badge(item.status === 'done' ? '✔' : '✖') : null, h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, rel(item.capturedAt))),
      item.source ? h('div', { class: 'small muted' }, item.source) : null,
      h('div', { style: { whiteSpace: 'pre-wrap', margin: '8px 0', color: 'var(--text-2)', maxHeight: '180px', overflow: 'auto' } }, item.text),
      item.status === 'open' ? h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: () => { claude.style.display = claude.style.display === 'none' ? 'block' : 'none'; } }, icon('sparkles', 14), t('inbox.triage.claude')),
        h('button', { class: 'btn sm', onclick: () => settle('done') }, icon('check', 14), t('inbox.triage.done')),
        h('button', { class: 'btn sm danger', onclick: () => settle('dropped') }, icon('trash', 14), t('inbox.triage.drop'))) : null,
      claude));
  }
}
