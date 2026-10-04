import { h, t, get, post, icon, rel, fmtDate, empty, loading, toast, errorToast } from '../core.js';
import { setTitle, refreshStatus, route } from '../main.js';
import { enhance } from './notes.js';

function listEditor(placeholder) {
  const box = h('div', { class: 'stack', style: { gap: '6px' } });
  const add = (value = '') => {
    const input = h('input', { class: 'input', value, placeholder });
    const row = h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, input, h('button', { class: 'btn icon sm ghost', onclick: () => row.remove(), title: '✕' }, icon('x', 14)));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); box.lastChild?.querySelector('input')?.focus(); } });
    box.append(row);
  };
  add();
  return { el: h('div', null, box, h('button', { class: 'btn sm ghost', onclick: () => add() }, icon('plus', 14), t('web.add'))), values: () => [...box.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean) };
}

export async function render({ mount, query }) {
  setTitle(t('web.nav.focus'));
  mount.append(loading());
  const [focus, journal] = await Promise.all([get('/api/focus'), get('/api/journal')]);
  mount.replaceChildren();
  mount.append(h('p', { class: 'lead' }, t('focus.why')));

  // ----- focus -----
  const focusCard = h('div', { class: 'card' });
  const drawFocus = async (editing) => {
    focusCard.replaceChildren(h('div', { class: 'card-head' }, icon('focus', 17), h('h2', null, t('focus.title')),
      focus.exists ? h('span', { class: `badge ${focus.stale ? 'warn' : 'ok'}` }, focus.stale ? t('web.home.stale') : t('focus.updatedAgo', { when: rel(focus.updatedAt) })) : null,
      h('span', { class: 'spacer' }),
      focus.exists && !editing ? h('button', { class: 'btn sm', onclick: () => drawFocus(true) }, t('web.edit')) : null));
    if (!focus.exists) {
      focusCard.append(empty('🎯', t('focus.none'), t('web.focus.createText'), h('button', { class: 'btn primary', onclick: async () => {
        try { await post('/api/focus/init'); toast(t('focus.created', { path: '' })); await refreshStatus(); route(); } catch (e) { errorToast(e); }
      } }, t('web.focus.create'))));
      return;
    }
    if (editing) {
      const area = h('textarea', { class: 'textarea code', style: { minHeight: '300px' } }, focus.raw);
      focusCard.append(area, h('div', { class: 'row', style: { marginTop: '10px' } },
        h('span', { class: 'small muted' }, t('focus.previousKept')), h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => drawFocus(false) }, t('web.cancel')),
        h('button', { class: 'btn primary', onclick: async () => {
          try { await post('/api/focus', { text: area.value }); toast(t('focus.updated', { path: '' })); await refreshStatus(); route(); } catch (e) { errorToast(e); }
        } }, t('web.save'))));
      setTimeout(() => area.focus(), 30);
      return;
    }
    const art = h('article', { class: 'reader', html: focus.html, style: { maxWidth: 'none' } });
    focusCard.append(art);
    await enhance(art);
  };
  await drawFocus(false);

  // ----- end of session -----
  const summary = h('input', { class: 'input', placeholder: t('done.summary.placeholder') });
  const did = listEditor(t('web.done.didPlaceholder'));
  const decided = listEditor(t('web.done.decidedPlaceholder'));
  const keep = listEditor(t('done.keep.placeholder'));
  const next = h('input', { class: 'input', placeholder: t('done.next.placeholder') });
  const doneCard = h('div', { class: 'card', id: 'done' },
    h('div', { class: 'card-head' }, icon('check', 17), h('h2', null, t('web.done.title'))),
    h('p', { class: 'muted', style: { marginTop: 0 } }, t('web.done.text')),
    h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', null, t('done.summary.q')), summary),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'field' }, h('label', null, t('web.done.did')), did.el),
        h('div', { class: 'field' }, h('label', null, t('web.done.decided')), decided.el)),
      h('div', { class: 'field' }, h('label', null, t('web.done.keep')), h('div', { class: 'help' }, t('done.captured')), keep.el),
      h('div', { class: 'field' }, h('label', null, t('done.next.q')), next),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
        if (!summary.value.trim()) { toast(t('web.done.needSummary'), 'err'); summary.focus(); return; }
        try {
          const r = await post('/api/done', { summary: summary.value, did: did.values(), decided: decided.values(), keep: keep.values(), next: next.value });
          toast(`${t('done.saved', { path: '' })}${r.captured.length ? ` · 📥 ${r.captured.length}` : ''}`);
          await refreshStatus(); route();
        } catch (e) { errorToast(e); }
      } }, icon('check', 16), t('web.done.save')))));

  // ----- journal -----
  const journalCard = h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('journal', 17), h('h2', null, t('web.journal.title'))));
  if (!journal.sessions.length) journalCard.append(h('div', { class: 'muted' }, t('status.noSession')));
  else journalCard.append(h('div', { class: 'timeline' }, journal.sessions.slice(0, 30).map((s) => h('div', { class: 't-item' },
    h('div', { class: 'row' }, h('b', null, s.summary)), h('div', { class: 'small muted' }, `${fmtDate(s.at)} · ${s.profile}`),
    s.next ? h('div', { class: 'small', style: { marginTop: '4px' } }, '↪ ', h('b', null, t('focus.nextTime')), ' ', s.next) : null))));

  mount.append(h('div', { class: 'grid cols-2', style: { alignItems: 'start' } }, h('div', { class: 'stack' }, focusCard, journalCard), doneCard));
  if (query.get('done') === '1') setTimeout(() => { doneCard.scrollIntoView({ behavior: 'smooth' }); summary.focus(); }, 60);
}
