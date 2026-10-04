import { state, h, t, tn, get, post, icon, rel, fmtDate, badge, empty, loading, noteBox, cmdBox, toast, errorToast, confirmDialog, catDot, catChip, catOf, localiseCategory } from '../core.js';
import { setTitle, go, refreshStatus } from '../main.js';
import { enhance } from './notes.js';

export async function render(r) {
  if (r.view === 'proposal') return detail(r);
  if (r.view === 'history') return history(r);
  return list(r);
}

async function list({ mount, query }) {
  setTitle(t('web.nav.review'));
  const all = query.get('all') === '1';
  mount.append(loading());
  const { proposals } = await get('/api/proposals', { all: all ? 1 : '' });
  mount.replaceChildren();
  const pending = proposals.filter((p) => p.status === 'prepared');
  mount.append(h('p', { class: 'lead' }, t('web.review.lead')));
  if (!pending.length) mount.append(empty('✅', t('review.nothingPending'), t('web.review.emptyText'), h('a', { class: 'btn', href: '#/source' }, t('web.home.addSource'))));
  else mount.append(h('div', { class: 'stack' }, pending.map((p) => h('div', { class: 'card hover', onclick: () => go(`#/proposal/${p.id}`) },
    h('div', { class: 'row' },
      h('span', { class: 'badge brand' }, `#${p.number}`),
      h('b', { style: { fontSize: '15px' } }, p.title),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted small' }, rel(p.createdAt)),
      h('button', { class: 'btn sm primary' }, t('web.review.open'))),
    h('div', { class: 'row small muted', style: { marginTop: '6px' } },
      h('span', null, tn('review.files', p.files)), '·', h('span', null, t('review.createdUpdated', { created: p.created, updated: p.updated })))))));
  const history = proposals.filter((p) => p.status !== 'prepared');
  mount.append(h('div', { class: 'row', style: { marginTop: '22px' } },
    h('h2', { style: { margin: 0 } }, t('review.history')), h('span', { class: 'spacer' }),
    h('a', { class: 'btn sm ghost', href: all ? '#/review' : '#/review?all=1' }, all ? t('web.review.hideDrafts') : t('web.review.showDrafts')),
    h('a', { class: 'btn sm', href: '#/history' }, icon('history', 14), t('web.nav.history'))));
  if (!history.length) mount.append(h('p', { class: 'muted small' }, t('web.review.noHistory')));
  if (history.length) mount.append(h('div', { class: 'card flat', style: { marginTop: '10px', padding: '6px' } }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, t('undo.col.state')), h('th', null, t('review.col.proposal')), h('th', null, t('review.col.size')), h('th', null, t('undo.col.when')))),
    h('tbody', null, history.slice(0, 40).map((p) => h('tr', null,
      h('td', null, badge(t(`review.status.${p.status}`), p.status === 'applied' ? 'ok' : '')),
      h('td', null, p.title), h('td', { class: 'muted' }, tn('review.files', p.files)), h('td', { class: 'muted' }, fmtDate(p.createdAt))))))));
}

function diffView(text) {
  const box = h('div', { class: 'diff' });
  for (const line of text.split('\n')) {
    const cls = line.startsWith('+++') || line.startsWith('---') ? 'meta' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
    box.append(h('div', { class: cls }, line || ' '));
  }
  return box;
}

async function detail({ arg, mount }) {
  setTitle(t('review.boxTitle'), t('web.nav.review'));
  mount.append(loading(6));
  const p = await get('/api/proposal', { id: arg });
  mount.replaceChildren();
  setTitle(p.number ? `#${p.number} · ${p.title}` : p.title, t('web.nav.review'));
  const done = p.status === 'applied' || p.status === 'partially-applied';
  const header = h('div', { class: 'hero' },
    h('div', { class: 'row' }, p.number ? badge(`#${p.number}`, 'brand') : null, badge(t(`review.status.${p.status}`), done ? 'ok' : p.status === 'prepared' ? 'warn' : '')),
    h('h2', { style: { marginTop: '8px' } }, p.title),
    h('div', { class: 'row muted small' }, h('span', null, tn('review.files', p.files.length || p.changes.length)), '·', h('span', null, t('review.prepared', { when: rel(p.createdAt) })), '·', h('span', { class: 'mono' }, p.id)));
  mount.append(header, h('div', { style: { height: '14px' } }));
  if (done) { mount.append(noteBox('ok', t('review.alreadyApplied'))); return; }
  if (p.status === 'superseded') { mount.append(noteBox('info', t('review.superseded'))); return; }
  if (!p.guard.ok) { mount.append(noteBox('warn', t('web.review.stale'))); return; }

  const notes = p.notes.filter(Boolean);
  // Preparation remarks are technical (limits of the extraction, ambiguous links): folded by default.
  if (notes.length) mount.append(h('details', { class: 'note-box info fold' }, h('summary', null, icon('info', 17), h('b', null, `${t('review.notes')} (${notes.length})`)), h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px' } }, notes.map((n) => h('li', null, n)))), h('div', { style: { height: '12px' } }));
  for (const c of p.contradictions) mount.append(noteBox('warn', t('review.contradiction', { path: c.path, existing: c.existingClaim, incoming: c.incomingClaim })));

  const selected = new Set(p.changes.map((c) => c.id));
  const counter = h('span', { class: 'muted small' });
  const updateCounter = () => { counter.textContent = tn('review.selectionNow', selected.size); };
  const filesBox = h('div', { class: 'stack', style: { gap: '8px' } });
  const cats = (p.categories ?? []).map(localiseCategory);
  for (const f of p.files) {
    const check = h('input', { type: 'checkbox', class: 'check', checked: true, title: t('web.review.keepFile'), onclick: (e) => e.stopPropagation(), onchange: (e) => { for (const id of f.changeIds) e.target.checked ? selected.add(id) : selected.delete(id); updateCounter(); } });
    const body = h('div', { class: 'file-body', style: { display: 'none' } });
    let mode = 'preview';
    const renderBody = async () => {
      body.replaceChildren(h('div', { class: 'segmented', style: { marginBottom: '10px' } },
        h('button', { class: mode === 'preview' ? 'on' : '', onclick: () => { mode = 'preview'; renderBody(); } }, t('web.review.preview')),
        h('button', { class: mode === 'diff' ? 'on' : '', onclick: () => { mode = 'diff'; renderBody(); } }, t('web.review.diff'))));
      if (mode === 'diff') body.append(diffView(f.diff));
      else { const art = h('article', { class: 'reader card flat', html: f.html }); body.append(art); await enhance(art); }
    };
    const row = h('div', { class: 'file-row', onclick: () => { const open = body.style.display === 'none'; body.style.display = open ? 'block' : 'none'; row.classList.toggle('open', open); if (open) renderBody(); } },
      check, cats.length && f.noteCategory ? catDot(catOf(cats, f.noteCategory), 10) : h('span', null, f.category === 'concept-card' ? '💡' : f.category === 'article' ? '📘' : '📄'), h('span', { class: 'path' }, f.path),
      cats.length && f.noteCategory && f.created ? catChip(catOf(cats, f.noteCategory)) : null,
      badge(f.created ? t('review.new') : t('review.changed'), f.created ? 'ok' : 'info'),
      h('span', { class: 'plus' }, `+${f.stats.added}`), h('span', { class: 'minus' }, `−${f.stats.removed}`), icon('chevron', 16));
    filesBox.append(h('div', null, row, body));
  }
  mount.append(h('h2', { style: { marginTop: '6px' } }, t('web.review.files')), filesBox);
  if (p.evidence.length) {
    const ev = h('details', { class: 'card flat', style: { marginTop: '14px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 650 } }, `📌 ${t('web.review.evidence')} (${p.evidence.length})`),
      h('div', { class: 'stack', style: { marginTop: '10px', gap: '8px' } }, p.evidence.slice(0, 120).map((e) => h('div', { class: 'small' }, h('div', { class: 'muted mono' }, e.locator), h('div', { style: { borderLeft: '3px solid var(--border-strong)', paddingLeft: '10px' } }, e.quote)))));
    mount.append(ev);
  }
  updateCounter();

  const presence = state.session.presence;
  const approve = async (apply) => {
    if (!selected.size) { toast(t('review.emptySelection'), 'err'); return; }
    if (presence === 'none') return;
    const ok = await confirmDialog({ title: apply ? t('review.confirmApply', { n: selected.size }) : t('review.confirmApprove', { n: selected.size }), message: presence === 'dialog' ? t('web.review.dialogHint') : t('web.review.terminalHint'), ok: apply ? t('review.action.apply') : t('web.review.approve') });
    if (!ok) return;
    try {
      toast(presence === 'dialog' ? t('web.review.waitDialog') : t('web.review.waitTerminal'), 'info');
      const r = await post('/api/proposal/approve', { id: p.id, selection: [...selected], apply });
      if (!r.ok) { toast(r.presence === 'refused' ? t('web.review.refused') : t('web.review.noPresence'), 'err'); return; }
      if (r.applied) {
        const created = r.receipt.results.filter((x) => x.action === 'created').length;
        const updated = r.receipt.results.filter((x) => x.action === 'updated').length;
        toast(`${t('apply.summary', { created, updated, deleted: 0 })}${r.git?.committed ? ` · commit ${r.git.sha}` : ''}`);
      } else toast(t('review.approvedShort'));
      await refreshStatus();
      go('#/review');
    } catch (e) { errorToast(e); }
  };
  const discard = async () => {
    if (!(await confirmDialog({ title: t('review.discard.q'), ok: t('review.action.discard'), danger: true }))) return;
    try { await post('/api/proposal/discard', { id: p.id }); toast(t('review.discarded')); await refreshStatus(); go('#/review'); } catch (e) { errorToast(e); }
  };
  const bar = h('div', { class: 'action-bar' },
    counter, h('span', { class: 'spacer' }),
    h('button', { class: 'btn danger', onclick: discard }, icon('trash', 15), t('review.action.discard')),
    presence !== 'none' ? h('button', { class: 'btn', onclick: () => approve(false) }, t('review.action.approveOnly')) : null,
    presence !== 'none' ? h('button', { class: 'btn primary lg', onclick: () => approve(true) }, icon('check', 16), t('review.action.apply')) : null);
  if (presence === 'none') mount.append(h('div', { style: { height: '12px' } }), noteBox('info', t('web.review.useTerminal'), cmdBox(p.approvalCommand)));
  mount.append(bar);
}

async function history({ mount }) {
  setTitle(t('web.nav.history'));
  mount.append(loading());
  const { receipts } = await get('/api/receipts');
  mount.replaceChildren(h('p', { class: 'lead' }, t('web.history.lead')));
  if (!receipts.length) { mount.append(empty('🕰️', t('web.history.empty'), t('web.history.emptyText'))); return; }
  const lastUndoable = receipts.find((r) => r.complete && !r.rolledBack);
  mount.append(h('div', { class: 'timeline' }, receipts.map((r) => h('div', { class: 't-item card flat' },
    h('div', { class: 'row' },
      badge(r.rolledBack ? t('undo.undone') : r.complete ? t('undo.applied') : t('undo.interrupted'), r.rolledBack ? '' : r.complete ? 'ok' : 'warn'),
      h('b', null, fmtDate(r.appliedAt)), h('span', { class: 'muted small' }, rel(r.appliedAt)), h('span', { class: 'spacer' }),
      r === lastUndoable ? h('button', { class: 'btn sm', onclick: () => undo(r) }, icon('undo', 14), t('web.history.undo')) : null),
    h('div', { class: 'small muted', style: { marginTop: '4px' } }, `${t('review.createdUpdated', { created: r.created, updated: r.updated })} · ${r.id}`)))));
}

async function undo(r) {
  const ok = await confirmDialog({ title: t('undo.q'), message: `${tn('undo.removes', r.created)}\n${tn('undo.restores', r.updated)}`, ok: t('web.history.undo'), danger: true });
  if (!ok) return;
  try {
    const out = await post('/api/undo', { receipt: r.id });
    toast(tn('undo.restored', out.restored.length));
    await refreshStatus();
    go('#/history');
    dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { errorToast(e); }
}
