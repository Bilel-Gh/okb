// Core of the OKB web app: DOM helper, API client, translations, toasts, dialogs, icons.

export const state = { session: null, kb: null, messages: {}, lang: 'fr', status: null };

/* ---------- translations (the same catalogue as the terminal) ---------- */
export function t(key, params = {}) {
  const text = state.messages[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
export function tn(key, n, params = {}) {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}
export function has(key) { return key in state.messages; }

/* ---------- DOM ---------- */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sv === null || sv === undefined) continue; if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv; }
      else if (k === 'html') el.innerHTML = v; // only for sanitized server HTML and built-in icons
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  // Option cards (.choice) behave as radio buttons for the keyboard and screen readers.
  const cls = typeof props?.class === 'string' ? props.class : '';
  if (/\bchoice\b/.test(cls)) {
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-checked', String(/\bon\b/.test(cls)));
    el.setAttribute('aria-label', (el.querySelector('b')?.textContent ?? el.textContent).replace('★', '').trim().slice(0, 120));
    if (/\bdisabled\b/.test(cls)) el.setAttribute('aria-disabled', 'true');
    else {
      el.tabIndex = 0;
      el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); } });
    }
  }
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el) { el.replaceChildren(); return el; }
export const frag = (...children) => { const f = document.createDocumentFragment(); append(f, children); return f; };

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(body, status) { super(body?.message || body?.error || `HTTP ${status}`); this.body = body; this.status = status; }
}
function withKb(params = {}) {
  const p = new URLSearchParams();
  if (state.kb && !('kb' in params)) p.set('kb', state.kb);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.toString();
}
export async function get(path, params) {
  const qs = withKb(params);
  const r = await fetch(`${path}${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body, r.status);
  return body;
}
export async function post(path, body = {}) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OKB-Token': state.session?.token ?? '' },
    body: JSON.stringify({ kb: state.kb, ...body }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(out, r.status);
  return out;
}

/* ---------- formatting ---------- */
export function rel(date) {
  const at = new Date(date).getTime();
  const diff = at - Date.now();
  const units = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  const f = new Intl.RelativeTimeFormat(state.lang === 'fr' ? 'fr-FR' : 'en-GB', { numeric: 'auto', style: 'short' });
  for (const [u, ms] of units) if (Math.abs(diff) >= ms) return f.format(Math.round(diff / ms), u);
  return t('web.justNow');
}
export function fmtDate(date) {
  return new Date(date).toLocaleString(state.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function langName(code) {
  const names = { fr: ['Français', 'French'], en: ['Anglais', 'English'], es: ['Espagnol', 'Spanish'], de: ['Allemand', 'German'], it: ['Italien', 'Italian'], pt: ['Portugais', 'Portuguese'] };
  const n = names[String(code).slice(0, 2)];
  return n ? n[state.lang === 'fr' ? 0 : 1] : code;
}

/* ---------- icons (stroke, 18px) ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  usage: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="19" cy="17" r="1.6"/><path d="M8.3 7.1 15.6 7M7.2 8.2l3.6 7.6M16.7 9.1l-3.6 6.7M14.5 18.1l3-.6"/>',
  repo: '<path d="M21 7.5 12 3 3 7.5v9L12 21l9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  notes: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  review: '<path d="M9 11.5 11.5 14 16 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
  focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  weekly: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  learn: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5"/>',
  health: '<path d="M20.5 8.5c0 5-8.5 11-8.5 11s-8.5-6-8.5-11A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.5z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
  source: '<path d="M12 4v12M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  skill: '<path d="m15 4 5 5L9 20H4v-5z"/><path d="m13.5 5.5 5 5"/>',
  template: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M3.5 9h17M9 9v11.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  doctor: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
  kb: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"/><path d="M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  right: '<path d="m10 7 5 5-5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  journal: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M10 8h5M10 12h5"/>',
};
export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
  return span;
}

/* ---------- toasts ---------- */
export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}` }, icon(kind === 'err' ? 'alert' : kind === 'info' ? 'info' : 'check', 16), h('div', null, message));
  box.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, kind === 'err' ? 7000 : 3600);
}
export function errorToast(e) {
  const b = e?.body;
  if (!b && /fetch|network/i.test(String(e?.message ?? ''))) return toast(`${t('web.offline.title')} — ${t('web.offline.text')}`, 'err');
  toast(b?.title ? `${b.title} — ${b.detail ?? b.message ?? ''}${b.fix ? ` · ${b.fix}` : ''}` : String(e?.message ?? e), 'err');
}

/* ---------- dialogs ---------- */
export function overlay(content, onClose) {
  const root = document.getElementById('overlay');
  const back = h('div', { class: 'backdrop', onclick: (ev) => { if (ev.target === back) close(); } }, content);
  const esc = (ev) => { if (ev.key === 'Escape') close(); };
  function close() { document.removeEventListener('keydown', esc); back.remove(); onClose?.(); }
  document.addEventListener('keydown', esc);
  root.append(back);
  return close;
}
export function confirmDialog({ title, message, ok, cancel, danger = false, body = null }) {
  return new Promise((done) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; close(); done(v); } };
    const okBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, ok ?? t('ui.yes'));
    const modal = h('div', { class: 'modal', role: 'dialog' },
      h('h3', null, title), message ? h('p', { class: 'muted', style: { margin: 0, whiteSpace: 'pre-line' } }, message) : null, body,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => finish(false) }, cancel ?? t('ui.no')), okBtn));
    const close = overlay(modal, () => finish(false));
    setTimeout(() => okBtn.focus(), 30);
  });
}
export function promptDialog({ title, message, value = '', placeholder = '', ok }) {
  return new Promise((done) => {
    const input = h('input', { class: 'input', value, placeholder });
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; close(); done(v); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(input.value.trim()); });
    const modal = h('div', { class: 'modal' }, h('h3', null, title), message ? h('p', { class: 'muted' }, message) : null, input,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => finish(null) }, t('web.cancel')), h('button', { class: 'btn primary', onclick: () => finish(input.value.trim()) }, ok ?? t('web.ok'))));
    const close = overlay(modal, () => finish(null));
    setTimeout(() => input.focus(), 30);
  });
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('web.copied')); } catch { toast(text, 'info'); }
}
export function cmdBox(text) {
  return h('div', { class: 'cmd' }, icon('terminal', 15), h('code', null, text), h('button', { class: 'btn sm ghost', title: t('web.copy'), onclick: () => copy(text) }, icon('copy', 14)));
}
export function empty(emoji, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'emoji' }, emoji), h('b', null, title), text ? h('div', null, text) : null, action ?? null);
}
export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }
export function noteBox(kind, text, extra) {
  return h('div', { class: `note-box ${kind}` }, icon(kind === 'warn' || kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info', 17), h('div', null, text, extra ?? null));
}
export function loading(lines = 4) {
  return h('div', { class: 'stack' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { width: `${90 - i * 12}%` } })));
}
export const TYPE_ICON = { Guide: '📘', Concept: '💡', Runbook: '🪜', Process: '🔁', Tool: '🧰', Automation: '🤖', Experience: '🧯', Decision: '⚖️', Meeting: '🗣️' };

/* ---------- note categories (colour, emoji, name), the same everywhere ---------- */
const catCache = new Map();
/** The KB's categories, localised: `name` (plural), `one` (singular), `about`. */
export async function categories() {
  const key = state.kb ?? '';
  if (!catCache.has(key)) catCache.set(key, get('/api/categories').then((r) => r.categories.map(localiseCategory)).catch((e) => { catCache.delete(key); throw e; }));
  return catCache.get(key);
}
export function localiseCategory(c) {
  const fr = state.lang === 'fr';
  return { ...c, name: fr ? c.label.fr : c.label.en, one: fr ? c.singular.fr : c.singular.en, about: fr ? c.description.fr : c.description.en };
}
export function catColor(c) {
  if (!c) return 'var(--muted)';
  return document.documentElement.dataset.theme === 'dark' ? c.colorDark : c.color;
}
export function catDot(c, size = 9) {
  return h('span', { class: 'cat-dot', style: { width: `${size}px`, height: `${size}px`, background: catColor(c) }, title: c?.name ?? '' });
}
/** A coloured chip: dot, emoji, name. */
export function catChip(c, extra) {
  if (!c) return null;
  return h('span', { class: 'cat-chip', style: { '--cat': catColor(c) }, title: c.about ?? '' }, catDot(c, 8), `${c.emoji} ${c.one ?? c.name}`, extra ?? null);
}
export function catOf(list, id) {
  return list.find((c) => c.id === id) ?? list.find((c) => c.id === 'other');
}
