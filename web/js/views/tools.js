import { state, h, t, has, langName, get, post, icon, badge, empty, loading, noteBox, cmdBox, toast, errorToast, confirmDialog, TYPE_ICON, catDot, catColor, localiseCategory } from '../core.js';
import { setTitle, go, refreshStatus } from '../main.js';

export async function render(r) {
  const views = { source, skills, templates, doctor, help };
  return views[r.view](r);
}

/* ---------- add a source ---------- */
async function source({ mount }) {
  setTitle(t('web.nav.source'));
  // A raw extract follows no template: when the KB requires one, say so instead of failing later.
  const settings = await get('/api/settings').catch(() => ({ settings: [] }));
  const needsTemplate = settings.settings.find((x) => x.key === 'kb.requireTemplate')?.value === true;
  const input = h('input', { class: 'input', placeholder: t('web.source.placeholder') });
  let mode = 'claude';
  const target = h('input', { class: 'input', placeholder: 'guides/ma-note.md' });
  const title = h('input', { class: 'input', placeholder: t('web.source.titlePlaceholder') });
  const advanced = h('div', { class: 'grid cols-2', style: { display: 'none' } }, h('div', { class: 'field' }, h('label', null, t('web.source.target')), target), h('div', { class: 'field' }, h('label', null, t('web.source.noteTitle')), title));
  const result = h('div');
  const choices = h('div', { class: 'grid cols-2' });
  const drawChoices = () => choices.replaceChildren(
    h('div', { class: `choice${mode === 'claude' ? ' on' : ''}`, onclick: () => { mode = 'claude'; advanced.style.display = 'none'; drawChoices(); } }, h('span', { class: 'dot' }), h('div', null, h('b', null, t('web.source.withClaude'), ' ', h('span', { class: 'star' }, '★')), h('span', null, t('web.source.withClaudeText')))),
    needsTemplate
      ? h('div', { class: 'choice disabled', title: t('err.templateRequired.why') }, h('span', { class: 'dot' }), h('div', null, h('b', null, t('web.source.digest')), h('span', null, t('web.source.digestNeedsTemplate'), ' ', h('a', { href: '#/settings' }, t('web.nav.settings')))))
      : h('div', { class: `choice${mode === 'digest' ? ' on' : ''}`, onclick: () => { mode = 'digest'; advanced.style.display = 'grid'; drawChoices(); } }, h('span', { class: 'dot' }), h('div', null, h('b', null, t('web.source.digest')), h('span', null, t('web.source.digestText')))));
  drawChoices();
  const go2 = h('button', { class: 'btn primary', onclick: async () => {
    const src = input.value.trim();
    if (!src) return;
    go2.disabled = true;
    try {
      if (mode === 'claude') {
        const out = await post('/api/source', { source: src, mode: 'capture' });
        result.replaceChildren(noteBox('ok', t('web.source.readyClaude', { blocks: out.blocks }), h('div', { style: { marginTop: '10px' } }, cmdBox(out.claude))));
      } else {
        const out = await post('/api/source', { source: src, mode: 'digest', path: target.value.trim() || 'notes/import.md', title: title.value.trim() });
        result.replaceChildren(noteBox('ok', t('web.source.readyDigest'), h('div', { style: { marginTop: '10px' } }, h('a', { class: 'btn primary', href: `#/proposal/${out.proposalId}` }, t('web.review.open')))));
      }
      refreshStatus();
    } catch (e) { errorToast(e); } finally { go2.disabled = false; }
  } }, icon('source', 16), t('web.source.go'));
  mount.append(h('p', { class: 'lead' }, t('web.source.lead')),
    h('div', { class: 'card stack' }, h('div', { class: 'field' }, h('label', null, t('web.source.label')), input, h('div', { class: 'help' }, t('web.source.help'))), choices, advanced, h('div', { class: 'row' }, h('span', { class: 'spacer' }), go2)),
    h('div', { style: { height: '14px' } }), result);
}

/* ---------- procedures → skills ---------- */
async function skills({ mount }) {
  setTitle(t('web.nav.skills'));
  mount.append(loading());
  const { candidates } = await get('/api/skillify');
  mount.replaceChildren(h('p', { class: 'lead' }, t('web.skills.lead')));
  if (!candidates.length) { mount.append(empty('🛠️', t('err.skillifyNoNotes.title'), t('err.skillifyNoNotes.fix'))); return; }
  const preview = h('div');
  mount.append(h('div', { class: 'split' },
    h('div', { class: 'card flat side-panel', style: { padding: '8px' } }, h('div', { class: 'list' }, candidates.map((c) => h('div', { class: 'list-item', onclick: () => draft(c.path) }, h('span', null, TYPE_ICON[c.type] ?? '📄'), h('div', { class: 'grow' }, h('div', { class: 'title' }, c.title), h('div', { class: 'sub mono' }, c.path)))))),
    preview));
  async function draft(path) {
    preview.replaceChildren(loading(8));
    try {
      const { draft: d } = await get('/api/skillify', { path });
      const dir = h('input', { class: 'input', value: '' , placeholder: '/chemin/du/projet/.claude/skills' });
      preview.replaceChildren(h('div', { class: 'card stack' },
        h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, `🛠️ ${d.name}`), badge(`${d.counts.steps} ${t('web.skills.steps')}`, 'brand')),
        h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: '14px', borderRadius: '12px', maxHeight: '50vh', overflow: 'auto', margin: 0 } }, d.content),
        noteBox('info', t('skillify.reviewTip')),
        h('div', { class: 'field' }, h('label', null, t('skillify.where')), dir, h('div', { class: 'help' }, t('web.skills.whereHelp'))),
        h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
          if (!dir.value.trim()) { dir.focus(); return; }
          try { const out = await post('/api/skillify', { path, dir: dir.value.trim() }); toast(t('skillify.written', { path: out.path, steps: d.counts.steps })); } catch (e) { errorToast(e); }
        } }, t('web.skills.write')))));
    } catch (e) { errorToast(e); }
  }
}

/* ---------- templates and style ---------- */
async function templates({ mount }) {
  setTitle(t('web.nav.templates'));
  mount.append(loading());
  const r = await get('/api/templates');
  mount.replaceChildren(h('p', { class: 'lead' }, t('web.templates.lead')));
  mount.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { class: 'card-head' }, icon('sparkles', 17), h('h2', null, t('web.templates.style')), h('span', { class: 'spacer' }), h('a', { class: 'btn sm', href: '#/settings' }, t('web.templates.change'))),
    h('div', { class: 'row' }, Object.entries(r.style).filter(([k]) => k !== 'instructions').map(([k, v]) => {
      const key = has(`web.style.k.${k}`) ? t(`web.style.k.${k}`) : k;
      const value = k === 'language' ? langName(String(v)) : has(`web.style.v.${v}`) ? t(`web.style.v.${v}`) : String(v);
      return h('span', { class: 'badge', title: `${k}: ${v}` }, h('span', { class: 'muted' }, `${key} · `), value);
    })),
    h('details', { style: { marginTop: '12px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('web.templates.brief')), h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: '12px', borderRadius: '10px' } }, r.brief))));
  // Templates grouped by the category of the notes they produce.
  const cats = (r.categories ?? []).map(localiseCategory);
  for (const c of cats) {
    const items = r.templates.filter((tp) => tp.category === c.id);
    if (!items.length) continue;
    mount.append(h('div', { class: 'row', style: { margin: '22px 0 10px', gap: '10px' } }, catDot(c, 12), h('h2', { style: { margin: 0, fontSize: '17px' } }, `${c.emoji} ${c.name}`), h('span', { class: 'muted small' }, c.about)),
      h('div', { class: 'grid cols-2' }, items.map((tp) => h('div', { class: 'card', style: { borderLeft: `3px solid ${catColor(c)}` } },
        h('div', { class: 'row' }, h('b', null, tp.label), h('span', { class: 'spacer' }), h('code', { class: 'small' }, tp.id), h('span', { class: 'mono muted small' }, `${tp.folder}/`)),
        h('div', { class: 'muted small', style: { margin: '4px 0 10px' } }, tp.when),
        h('div', { class: 'stack', style: { gap: '4px' } }, tp.sections.map((s) => h('div', { class: 'small', title: s.guide }, `${s.emoji} ${s.heading}`, s.required ? h('span', { class: 'star' }, ' *') : null)))))));
  }
}

/* ---------- doctor ---------- */
async function doctor({ mount }) {
  setTitle(t('web.nav.doctor'));
  mount.append(loading(8));
  const r = await get('/api/doctor');
  mount.replaceChildren(h('p', { class: 'lead' }, t('web.doctor.lead')));
  const ico = { ok: ['check', 'var(--ok)'], warn: ['alert', 'var(--warn)'], fail: ['x', 'var(--err)'], unknown: ['info', 'var(--muted)'] };
  mount.append(h('div', { class: 'card', style: { padding: '6px' } }, h('div', { class: 'list' }, r.checks.map((c) => h('div', { class: 'list-item', style: { cursor: 'default' } },
    h('span', { style: { color: ico[c.status][1] } }, icon(ico[c.status][0], 17)),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, c.label), h('div', { class: 'sub' }, c.detail)),
    c.fix ? h('button', { class: 'btn sm primary', onclick: async () => {
      try { const out = await post('/api/doctor/fix', { fix: c.fix }); toast(out.ok ? t('web.doctor.fixed') : t('doctor.fixFailed'), out.ok ? 'ok' : 'err'); go('#/doctor'); dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { errorToast(e); }
    } }, t('web.doctor.fix')) : null)))));
  mount.append(h('div', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'card-head' }, icon('bolt', 17), h('h2', null, t('web.doctor.update')), h('span', { class: 'spacer' }), badge(`v${r.version}`)),
    h('p', { class: 'muted', style: { marginTop: 0 } }, t('update.q')),
    h('button', { class: 'btn', onclick: async () => {
      if (!(await confirmDialog({ title: t('update.q'), ok: t('web.doctor.updateGo') }))) return;
      toast(t('update.running'), 'info');
      try { const out = await post('/api/update'); toast(out.ok ? `${t('update.done', { version: out.version })} — ${t('web.doctor.restart')}` : t('update.failed'), out.ok ? 'ok' : 'err'); } catch (e) { errorToast(e); }
    } }, t('web.doctor.updateGo'))));
}

/* ---------- help: glossary, tour, codes ---------- */
async function help({ mount }) {
  setTitle(t('web.nav.help'));
  const terms = ['kb', 'proposal', 'approval', 'receipt', 'profile', 'concept', 'inbox', 'focus', 'journal', 'template', 'style', 'evidence', 'okf', 'plugin', 'skill', 'hook'];
  const story = h('div', { class: 'stack' });
  const code = h('input', { class: 'input', placeholder: 'E_STALE, LINK_BROKEN_TARGET…' });
  const codeOut = h('div');
  code.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    try { const r = await get('/api/explain', { code: code.value.trim() }); codeOut.replaceChildren(noteBox('info', h('span', null, h('b', null, r.title), h('br'), r.explain, r.fix ? h('div', { style: { marginTop: '6px' } }, `→ ${r.fix}`) : null))); } catch { codeOut.replaceChildren(noteBox('warn', t('err.explainUnknown.why', { code: code.value }))); }
  });
  mount.append(
    h('div', { class: 'hero' }, h('h2', null, t('web.help.title')), h('p', { class: 'muted', style: { margin: '6px 0 14px' } }, t('home.welcome')),
      h('button', { class: 'btn primary', onclick: async (e) => {
        e.currentTarget.disabled = true;
        story.replaceChildren(loading(6));
        try {
          const r = await post('/api/tour');
          story.replaceChildren(...r.steps.map((s) => h('div', { class: 'card' }, h('div', { class: 'row' }, s.n ? h('span', { class: 'badge brand' }, String(s.n)) : null, h('b', null, s.title)), h('p', { style: { margin: '8px 0' } }, s.body), s.detail ? h('pre', { class: 'mono', style: { margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)' } }, s.detail) : null)),
            noteBox('ok', t('tour.outro')));
        } catch (err) { errorToast(err); }
      } }, icon('sparkles', 16), t('web.help.tour'))),
    h('div', { style: { height: '14px' } }), story,
    h('div', { class: 'grid cols-2', style: { marginTop: '16px', alignItems: 'start' } },
      h('div', { class: 'card' }, h('h2', null, `📖 ${t('web.help.glossary')}`), h('div', { class: 'stack', style: { gap: '10px' } }, terms.map((k) => h('div', null, h('b', null, t(`glossary.${k}.term`)), h('div', { class: 'muted small' }, t(`glossary.${k}.def`)))))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', null, `⌨️ ${t('web.help.shortcuts')}`), h('div', { class: 'stack small', style: { gap: '6px' } },
          h('div', null, h('kbd', null, '⌘K'), ' / ', h('kbd', null, '/'), ' ', t('web.help.kPalette')),
          h('div', null, h('kbd', null, '⌘↵'), ' ', t('web.help.kCapture')))),
        h('div', { class: 'card' }, h('h2', null, `🧩 ${t('web.help.claude')}`), h('p', { class: 'muted small', style: { marginTop: 0 } }, t('help.claude')),
          h('div', { class: 'stack', style: { gap: '6px' } }, ['/okb:menu', '/okb:ingest', '/okb:ask', '/okb:done', '/okb:weekly'].map((c) => cmdBox(c)))),
        h('div', { class: 'card' }, h('h2', null, `🔍 ${t('web.help.explain')}`), code, h('div', { style: { height: '8px' } }), codeOut),
        h('div', { class: 'card' }, h('h2', null, `💻 ${t('web.help.terminal')}`), h('p', { class: 'muted small', style: { marginTop: 0 } }, t('web.help.terminalText')), cmdBox('okb'), h('div', { style: { height: '6px' } }), cmdBox('okb help')))));
  void state;
}
