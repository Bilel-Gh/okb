import { h, t, has, get, post, icon, langName, loading, toast, errorToast } from '../core.js';
import { setTitle } from '../main.js';

const GROUPS = ['language', 'writing', 'help', 'memory', 'history', 'assistant', 'advanced'];

function display(s, value) {
  if (s.key === 'writing.language') return langName(value);
  if (s.key === 'ui.language') return value === 'auto' ? t('wiz.lang.auto') : langName(value);
  if (typeof value === 'boolean') return value ? t('web.settings.on') : t('web.settings.off');
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  const k = `settings.opt.${s.key}.${value}`;
  return has(k) ? t(k) : String(value);
}

export async function render({ mount }) {
  setTitle(t('web.nav.settings'));
  mount.append(loading(8));
  const { kb, settings } = await get('/api/settings');
  mount.replaceChildren(h('p', { class: 'lead' }, t('web.settings.lead')));
  const saveValue = async (s, value, after) => {
    try {
      const out = await post('/api/settings', { key: s.key, value });
      s.value = out.value; s.isDefault = false;
      toast(t('settings.changed', { label: t(`settings.label.${s.key}`), value: display(s, out.value) }));
      if (s.key === 'ui.language') location.reload();
      after?.();
    } catch (e) { errorToast(e); }
  };
  for (const g of GROUPS) {
    const items = settings.filter((s) => s.group === g);
    if (!items.length) continue;
    const card = h('div', { class: 'card', style: { marginBottom: '14px' } }, h('div', { class: 'card-head' }, h('h2', null, t(`settings.group.${g}`)), h('span', { class: 'muted small' }, t(`settings.groupHint.${g}`))));
    for (const s of items) {
      let control;
      if (s.type === 'bool') {
        control = h('button', { class: `switch${s.value ? ' on' : ''}`, role: 'switch', 'aria-label': t(`settings.label.${s.key}`), 'aria-checked': String(Boolean(s.value)), onclick: (e) => { const el = e.currentTarget; saveValue(s, !s.value, () => { el.classList.toggle('on', Boolean(s.value)); el.setAttribute('aria-checked', String(Boolean(s.value))); }); } });
      } else if (s.type === 'choice') {
        control = h('div', { class: 'segmented' }, s.options.map((o) => h('button', { class: String(s.value) === o ? 'on' : '', title: has(`settings.hint.${s.key}.${o}`) ? t(`settings.hint.${s.key}.${o}`) : '', onclick: (e) => saveValue(s, o, () => { [...e.currentTarget.parentElement.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); }) }, display(s, o), s.recommended === o ? h('span', { class: 'star' }, ' ★') : null)));
      } else {
        const input = h('input', { class: 'input', value: Array.isArray(s.value) ? s.value.join(', ') : String(s.value ?? ''), placeholder: s.type === 'list' ? t('settings.listPlaceholder') : '', style: { maxWidth: '420px' } });
        const btn = h('button', { class: 'btn sm', onclick: () => saveValue(s, s.type === 'number' ? Number(input.value) : input.value) }, t('web.save'));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
        control = h('div', { class: 'row', style: { flexWrap: 'nowrap', flex: 1, justifyContent: 'flex-end' } }, input, btn);
      }
      card.append(h('div', { class: 'row', style: { padding: '10px 0', borderTop: '1px solid var(--border)', alignItems: 'flex-start' } },
        h('div', { style: { flex: '1 1 280px', minWidth: 0 } },
          h('div', { style: { fontWeight: 600 } }, t(`settings.label.${s.key}`), s.scope === 'global' ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, t('web.settings.allKbs')) : null),
          has(`settings.explain.${s.key}`) ? h('div', { class: 'small muted' }, t(`settings.explain.${s.key}`)) : null,
          h('div', { class: 'small mono muted' }, s.key)),
        control));
    }
    mount.append(card);
  }
  mount.append(h('div', { class: 'small muted' }, icon('info', 14), ' ', t('web.settings.footer', { kb })));
}
