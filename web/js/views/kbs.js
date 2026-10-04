import { state, h, t, get, post, icon, langName, badge, loading, noteBox, toast, errorToast, confirmDialog } from '../core.js';
import { setTitle, go, switchKb, refreshStatus } from '../main.js';

export async function render(r) {
  if (r.view === 'newkb') return wizard(r.mount, false);
  setTitle(t('web.kb.manage'));
  const s = await get('/api/session');
  state.session.kbs = s.kbs;
  r.mount.append(h('p', { class: 'lead' }, t('web.kb.lead')),
    h('div', { class: 'grid cols-2' }, s.kbs.map((kb) => h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'logo-mark', style: { width: '34px', height: '34px' } }),
        h('div', { style: { minWidth: 0 } }, h('b', { style: { fontSize: '15px' } }, kb.name), h('div', { class: 'small muted mono' }, kb.id)),
        h('span', { class: 'spacer' }),
        kb.active ? badge(`★ ${t('profile.active')}`, 'brand') : null),
      h('div', { class: 'small muted mono', style: { margin: '10px 0' } }, kb.root),
      h('div', { class: 'row small' }, badge(langName(kb.writingLanguage)), kb.exists ? null : badge(t('kb.missing'), 'err'), kb.owner === 'other' ? badge(t('err.kbOtherOwner.title'), 'err') : null),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn sm', onclick: () => { switchKb(kb.id); go('#/'); } }, icon('right', 14), t('web.kb.open')),
        kb.active ? null : h('button', { class: 'btn sm ghost', onclick: async () => { await switchKb(kb.id, true); toast(t('kb.switched', { name: kb.name, root: '' })); go('#/kbs'); } }, t('web.kb.makeActive')),
        kb.owner === 'none' ? h('button', { class: 'btn sm ghost', onclick: async () => { try { await post('/api/kb/adopt', { kb: kb.id }); toast(t('kb.adopt.done', { root: kb.root, id: kb.id })); } catch (e) { errorToast(e); } } }, t('web.kb.adopt')) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!(await confirmDialog({ title: t('kb.archive.confirm', { id: kb.id }), ok: t('kb.menu.archive'), danger: true }))) return;
          try { await post('/api/kb/archive', { id: kb.id }); toast(t('kb.archived', { id: kb.id, where: '' })); location.hash = '#/kbs'; location.reload(); } catch (e) { errorToast(e); }
        } }, icon('trash', 14))))),
      h('div', { class: 'card hover', style: { display: 'grid', placeItems: 'center', minHeight: '150px', borderStyle: 'dashed' }, onclick: () => go('#/newkb') }, h('div', { class: 'row', style: { color: 'var(--brand)', fontWeight: 650 } }, icon('plus', 18), t('web.kb.new')))));
}

/** Full-screen first run: no KB yet. */
export async function onboarding(app) {
  const card = h('div', { class: 'card' });
  app.append(h('div', { class: 'onboard' }, card));
  await wizard(card, true);
}

async function wizard(mount, first) {
  setTitle?.(t('web.kb.new'));
  mount.append(loading(6));
  const { context: ctx, defaults } = await get('/api/wizard');
  const a = { ...defaults, name: first ? t('wiz.name.default') : '', root: '' };
  let step = 0, folder = null, mode = 'quick';
  const steps = ['name', 'where', 'lang', 'style', 'tools', 'recap'];
  const stepper = h('div', { class: 'steps' });
  const body = h('div', { class: 'stack', style: { minHeight: '260px' } });
  const nav = h('div', { class: 'row', style: { marginTop: '18px' } });
  mount.replaceChildren(
    h('div', { class: 'row', style: { marginBottom: '14px' } }, h('span', { class: 'logo-mark' }), h('div', null, h('h2', { style: { margin: 0, fontSize: '20px' } }, first ? t('wiz.intro.first') : t('wiz.intro.new')), h('div', { class: 'muted small' }, t('web.wizard.sub')))),
    stepper, body, nav);

  const check = async () => {
    folder = await get('/api/wizard/folder', { name: a.name, root: a.root || '', kb: '' });
    if (!a.root) a.root = folder.root;
    return folder;
  };
  const choice = (on, title, text, onClick, star) => h('div', { class: `choice${on ? ' on' : ''}`, onclick: onClick }, h('span', { class: 'dot' }), h('div', null, h('b', null, title, star ? h('span', { class: 'star' }, ' ★') : null), text ? h('span', null, text) : null));
  const toggle = (label, help, key) => h('div', { class: 'row', style: { padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'nowrap' } },
    h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, label), help ? h('div', { class: 'small muted' }, help) : null),
    h('button', { class: `switch${a[key] ? ' on' : ''}`, role: 'switch', 'aria-label': label, 'aria-checked': String(Boolean(a[key])), onclick: (e) => { a[key] = !a[key]; e.currentTarget.classList.toggle('on', Boolean(a[key])); e.currentTarget.setAttribute('aria-checked', String(Boolean(a[key]))); } }));

  const draw = async () => {
    stepper.replaceChildren(...steps.map((s, i) => h('div', { class: `s${i === step ? ' on' : i < step ? ' done' : ''}` }, h('span', { class: 'n' }, i < step ? '✓' : String(i + 1)), t(`web.wizard.step.${s}`))));
    body.replaceChildren();
    const s = steps[step];
    if (s === 'name') {
      const input = h('input', { class: 'input', value: a.name, placeholder: t('wiz.name.placeholder'), style: { fontSize: '16px', padding: '11px 13px' } });
      const derived = h('div', { class: 'small muted' });
      const upd = async () => { a.name = input.value; a.root = ''; if (!a.name.trim()) { derived.textContent = ''; return; } const f = await check(); derived.textContent = t('wiz.name.derived', { folder: f.names.folder, id: f.names.id }); };
      input.addEventListener('input', upd);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
      body.append(h('div', { class: 'field' }, h('label', null, t('wiz.name.q')), input, derived), noteBox('info', t('web.wizard.nameHelp')));
      upd();
      setTimeout(() => input.focus(), 30);
    }
    if (s === 'where') {
      const f = await check();
      // The recommendation is computed without the person's own path, which stays in the free field.
      const suggested = (await get('/api/wizard/folder', { name: a.name, kb: '' })).root;
      const opts = [suggested, ...ctx.vaults.filter((v) => v.kbs.length > 0).slice(0, 3).map((v) => `${v.path}/${f.names.folder}`)].filter((p, i, all) => all.indexOf(p) === i);
      const custom = h('input', { class: 'input', placeholder: t('wiz.where.path'), value: opts.includes(a.root) ? '' : a.root });
      const status = h('div');
      const showCheck = async () => {
        const c = (await get('/api/wizard/folder', { name: a.name, root: a.root, kb: '' })).check;
        folder.check = c;
        status.replaceChildren(
          c.state === 'overlap' ? noteBox('err', t('err.kbOverlap.why', { other: c.with, root: a.root }))
            : c.state === 'foreign' ? noteBox('warn', t('wiz.where.foreignNote', { root: a.root, example: c.examples[0] }), h('label', { class: 'row', style: { marginTop: '8px' } }, h('input', { type: 'checkbox', class: 'check', checked: a.adopt, onchange: (e) => { a.adopt = e.target.checked; } }), t('wiz.where.adopt')))
              : c.state === 'okb' ? noteBox('info', t('wiz.where.existing'))
                : noteBox('ok', c.state === 'new' ? t('web.wizard.folderNew') : t('web.wizard.folderEmpty')));
      };
      body.append(h('div', { class: 'field' }, h('label', null, t('wiz.where.q', { name: a.name })),
        h('div', { class: 'stack', style: { gap: '8px' } }, opts.map((p, i) => choice(a.root === p, p.replace(/^\/Users\/[^/]+/, '~'), i === 0 ? t(ctx.kbs.length || ctx.vaults.some((v) => v.kbs.length) ? 'wiz.where.suggested' : 'wiz.where.fresh') : t('wiz.where.vault'), () => { a.root = p; custom.value = ''; draw(); }, i === 0)),
          h('div', { class: 'field' }, h('label', { class: 'small muted' }, t('wiz.where.other')), custom))), status);
      custom.addEventListener('change', () => { if (custom.value.trim()) { a.root = custom.value.trim(); draw(); } });
      showCheck();
    }
    if (s === 'lang') {
      body.append(h('div', { class: 'field' }, h('label', null, t('settings.label.ui.language')),
        h('div', { class: 'segmented' }, ['fr', 'en', 'auto'].map((l) => h('button', { class: a.uiLanguage === l ? 'on' : '', onclick: () => { a.uiLanguage = l; draw(); } }, l === 'auto' ? t('wiz.lang.auto') : langName(l))))),
      h('div', { class: 'field' }, h('label', null, t('wiz.writing.q')),
        h('div', { class: 'segmented' }, ['fr', 'en', 'es', 'de', 'it', 'pt'].map((l) => h('button', { class: a.writingLanguage === l ? 'on' : '', onclick: () => { a.writingLanguage = l; draw(); } }, langName(l))))),
      noteBox('info', t('web.wizard.langHelp')));
    }
    if (s === 'style') {
      body.append(h('div', { class: 'grid cols-2' },
        choice(mode === 'quick', t('wiz.mode.quick'), t('wiz.mode.quickHint'), () => { mode = 'quick'; Object.assign(a, { preset: 'standard', readerLevel: 'intermediate', conceptAssist: 'targeted', requireTemplate: true }); draw(); }, true),
        choice(mode === 'custom', t('wiz.mode.custom'), t('wiz.mode.customHint'), () => { mode = 'custom'; draw(); })));
      if (mode === 'custom') {
        const seg = (label, key, values, prefix) => h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'segmented' }, values.map((v) => h('button', { class: a[key] === v ? 'on' : '', title: t(`settings.hint.${prefix}.${v}`), onclick: () => { a[key] = v; draw(); } }, t(`settings.opt.${prefix}.${v}`)))));
        body.append(seg(t('wiz.reader.q'), 'readerLevel', ['beginner', 'intermediate', 'expert'], 'reader.level'),
          seg(t('wiz.style.q'), 'preset', ['standard', 'pedagogique', 'expert'], 'writing.preset'),
          seg(t('wiz.help.q'), 'conceptAssist', ['targeted', 'pedagogical', 'off'], 'conceptAssist.level'),
          h('div', { class: 'field' }, h('label', null, t('wiz.focus.q')), h('div', { class: 'segmented' }, [...(ctx.sharedFocus ? ['shared'] : []), 'create', 'later'].map((v) => h('button', { class: a.focus === v ? 'on' : '', onclick: () => { a.focus = v; draw(); } }, t(`wiz.focus.${v}`))))),
          toggle(t('wiz.templates.q'), '', 'requireTemplate'));
      }
    }
    if (s === 'tools') {
      if (ctx.git) body.append(toggle(t('wiz.git.q'), t('web.wizard.gitHelp'), 'git'));
      if (ctx.git && ctx.gh?.loggedIn) body.append(toggle(t('wiz.github.q', { user: ctx.gh.user }), '', 'github'));
      if (ctx.claude?.cli && !ctx.claude.installed) body.append(toggle(t('wiz.plugin.q'), '', 'plugin'));
      if (!ctx.launcher?.onPath && ctx.launcher?.candidates?.[0]) { if (a.launcher === undefined) a.launcher = ctx.launcher.candidates[0]; body.append(h('div', { class: 'row', style: { padding: '10px 0', borderTop: '1px solid var(--border)' } }, h('div', { style: { flex: 1, fontWeight: 600 } }, t('wiz.launcher.q', { dir: ctx.launcher.candidates[0] })), h('button', { class: `switch${a.launcher ? ' on' : ''}`, onclick: (e) => { a.launcher = a.launcher ? null : ctx.launcher.candidates[0]; e.currentTarget.classList.toggle('on', Boolean(a.launcher)); } }))); }
      if (!first) body.append(toggle(t('wiz.activate.q', { name: a.name }), '', 'activate'));
      if (!body.children.length) body.append(noteBox('ok', t('web.wizard.nothingToAdd')));
    }
    if (s === 'recap') {
      const rows = [
        [t('wiz.recap.kb'), `${a.name} (${folder?.names.folder})`], [t('wiz.recap.folder'), a.root],
        [t('wiz.recap.uiLang'), a.uiLanguage === 'auto' ? t('wiz.lang.auto') : langName(a.uiLanguage)], [t('wiz.recap.writingLang'), langName(a.writingLanguage)],
        [t('wiz.recap.style'), `${t(`settings.opt.writing.preset.${a.preset}`)} · ${t(`settings.opt.reader.level.${a.readerLevel}`)}`],
        [t('wiz.recap.help'), t(`settings.opt.conceptAssist.level.${a.conceptAssist}`)], [t('wiz.recap.focus'), t(`wiz.focus.${a.focus}`)],
        [t('wiz.recap.git'), a.git ? `${t('ui.yes')}${a.github ? ` · ${t('wiz.recap.github')}` : ''}` : t('ui.no')],
      ];
      body.append(h('table', { class: 'table' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('td', { class: 'muted', style: { width: '40%' } }, k), h('td', null, v))))));
    }
    nav.replaceChildren(
      step > 0 ? h('button', { class: 'btn', onclick: () => { step--; draw(); } }, t('web.back')) : (first ? h('span') : h('a', { class: 'btn ghost', href: '#/kbs' }, t('web.cancel'))),
      h('span', { class: 'spacer' }),
      step < steps.length - 1 ? h('button', { class: 'btn primary', onclick: next }, t('web.next'), icon('right', 15)) : h('button', { class: 'btn primary lg', onclick: create }, icon('check', 16), t('wiz.go.yes')));
  };
  async function next() {
    if (steps[step] === 'name' && !a.name.trim()) { toast(t('wiz.required'), 'err'); return; }
    if (steps[step] === 'where') {
      const c = folder?.check;
      if (c?.state === 'overlap') { toast(t('err.kbOverlap.title'), 'err'); return; }
      if (c?.state === 'foreign' && !a.adopt) { toast(t('err.kbForeign.title'), 'err'); return; }
    }
    step++; draw();
  }
  async function create() {
    body.replaceChildren(loading(5));
    nav.replaceChildren();
    try {
      const out = await post('/api/wizard', { answers: a });
      body.replaceChildren(noteBox('ok', t('wiz.outro', { name: a.name, id: out.id })),
        h('div', { class: 'list' }, out.steps.map((r) => h('div', { class: 'list-item', style: { cursor: 'default' } }, h('span', { style: { color: r.ok ? 'var(--ok)' : 'var(--warn)' } }, icon(r.ok ? 'check' : 'alert', 16)), h('div', { class: 'grow' }, h('div', null, t(`wiz.step.${r.step}`)), r.detail ? h('div', { class: 'sub mono' }, r.detail) : null)))));
      nav.replaceChildren(h('span', { class: 'spacer' }), h('button', { class: 'btn primary lg', onclick: () => { try { localStorage.setItem('okb-kb', out.id); } catch { /* ignore */ } location.hash = '#/'; location.reload(); } }, t('web.wizard.open'), icon('right', 15)));
      refreshStatus?.();
    } catch (e) {
      errorToast(e);
      step = 0; draw();
    }
  }
  draw();
}
