// Code repositories documented in this KB: where each stands, its map, its notes and its open questions.
import { state, h, t, tn, get, post, icon, badge, empty, loading, errorToast, toast, cmdBox, noteBox, rel, clear } from '../core.js';
import { setTitle, go } from '../main.js';
import { enhance } from './notes.js';

const STATE_ICON = { answered: '✅', pending: '🕓', received: '📨', found: '🔎', unknown: '❓', open: '⬜' };
const NOTE_STATE = { written: ['ok', '✔'], pending: ['info', '◐'], missing: ['', '○'] };
const VERDICT = { fresh: 'ok', changed: 'info', stale: 'warn', unknown: '' };

function progress(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'stack', style: { gap: '4px' } },
    h('div', { class: 'row small muted', style: { justifyContent: 'space-between' } }, h('span', null, label), h('span', null, `${done}/${total}`)),
    h('div', { class: 'progress' }, h('div', { style: { width: `${pct}%` } })));
}

function counts(questions) {
  const c = { answered: 0, pending: 0, received: 0, unknown: 0, open: 0 };
  for (const q of questions) c[q.state === 'found' ? 'open' : q.state] += 1;
  return c;
}

export async function render({ view, arg, mount }) {
  if (view === 'repo' && arg) return renderRepo(mount, arg);
  setTitle(t('web.nav.repos'));
  mount.append(loading(4));
  const { repos, tickets = [], workspaces = [] } = await get('/api/repos');
  clear(mount);
  mount.append(h('p', { class: 'lead muted' }, t('web.repos.lead')));
  for (const w of workspaces) {
    mount.append(h('div', { class: 'row small muted', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
      h('span', null, `🗂️ ${t('web.repos.workspace', { name: w.name })}`), '·', h('span', { class: 'mono' }, w.roots.join(', ')),
      w.prefixes.length ? badge(`🎫 ${w.prefixes.join(', ')}`) : null));
  }
  const active = tickets.filter((tk) => tk.status === 'active');
  if (active.length) mount.append(ticketsCard(active, true), h('div', { style: { height: '16px' } }));
  if (!repos.length) {
    mount.append(empty('📦', t('web.repos.none'), t('web.repos.noneText'), h('div', { class: 'stack', style: { width: 'min(520px, 100%)' } }, cmdBox('/okb:onboard'), cmdBox('cd <repo> && okb repo add'))));
    return;
  }
  mount.append(h('div', { class: 'grid cols-2' }, repos.map((r) => {
    const s = r.status;
    const c = counts(s.questions);
    const written = s.notes.filter((n) => n.state === 'written').length;
    return h('div', { class: 'card hover', role: 'button', tabindex: '0', onclick: () => go(`#/repo/${encodeURIComponent(r.id)}`) },
      h('div', { class: 'card-head' }, h('span', { style: { fontSize: '20px' } }, '📦'), h('h2', null, r.name),
        s.pending.length ? badge(tn('web.repos.pending', s.pending.length), 'brand') : null,
        active.some((tk) => tk.repos.some((x) => x.id === r.id)) ? badge(`🎫 ${active.filter((tk) => tk.repos.some((x) => x.id === r.id)).map((tk) => tk.ref).join(', ')}`, 'info') : null,
        s.stale ? badge(tn('web.repos.stale', s.stale), 'warn') : null),
      r.description ? h('p', { class: 'muted', style: { marginTop: 0 } }, r.description) : null,
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '12px' } }, r.stack.map((x) => badge(x))),
      h('div', { class: 'stack', style: { gap: '10px' } },
        progress(written, s.notes.length, t('web.repos.notes')),
        progress(c.answered, s.questions.length, t('web.repos.questions')),
        s.coverage.readTotal ? progress(s.coverage.readFiles, s.coverage.readTotal, t('web.repos.read')) : null),
      h('div', { class: 'small muted', style: { marginTop: '10px' } }, s.scan.at ? t('web.repos.scanned', { when: rel(s.scan.at), commit: (s.scan.commit ?? '').slice(0, 7) }) : t('repo.status.noScan')));
  })));
  if (repos.length > 1) mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => propose('/api/repos/landscape', {}) }, icon('sparkles', 16), t('web.repos.landscape'))));
}

async function propose(path, body) {
  try {
    const r = await post(path, body);
    if (!r.proposalId) { toast(t('repo.questions.upToDate'), 'info'); return; }
    toast(t('web.repos.proposed'));
    go(`#/proposal/${r.proposalId}`);
  } catch (e) { errorToast(e); }
}

async function renderRepo(mount, id) {
  mount.append(loading(6));
  const d = await get('/api/repo', { id });
  clear(mount);
  const { repo, status: s, map } = d;
  setTitle(repo.name, t('web.nav.repos'));
  const c = counts(d.questions);

  mount.append(
    h('div', { class: 'hero' },
      h('div', { class: 'muted small mono' }, repo.displayPath ?? repo.path),
      h('h2', null, `📦 ${repo.name}`),
      map?.repo.description ? h('p', { class: 'muted', style: { margin: '4px 0 0' } }, map.repo.description) : null,
      h('div', { class: 'row muted small', style: { marginTop: '8px' } },
        h('span', null, `HEAD ${(s.head ?? '—').slice(0, 7)}`), '·',
        h('span', null, s.scan.at ? t('web.repos.scanned', { when: rel(s.scan.at), commit: (s.scan.commit ?? '').slice(0, 7) }) : t('repo.status.noScan')),
        s.scan.behind ? badge(t('repo.status.behind'), 'warn') : null)),
    h('div', { class: 'row', style: { margin: '14px 0' } },
      h('button', { class: 'btn', onclick: async () => { try { await post('/api/repos/scan', { id: repo.id }); toast(t('web.repos.rescanned')); go(`#/repo/${encodeURIComponent(repo.id)}?t=${Date.now()}`); } catch (e) { errorToast(e); } } }, icon('history', 16), t('web.repos.rescan')),
      h('button', { class: 'btn', onclick: () => propose('/api/repos/questions', { id: repo.id }) }, icon('help', 16), t('web.repos.proposeQuestions'))),
  );

  // Next steps first: the person should know what to do on this page.
  const steps = [];
  if (!s.notes.some((n) => n.state !== 'missing')) steps.push(noteBox('info', t('web.repos.startOnboarding'), h('div', { style: { marginTop: '8px' } }, cmdBox('/okb:onboard'))));
  if (s.pending.length) steps.push(noteBox('ok', tn('repo.status.pending', s.pending.length), h('div', { style: { marginTop: '8px' } }, h('a', { class: 'btn sm primary', href: `#/proposal/${s.pending[0].id}` }, t('web.home.reviewNow')))));
  if (s.stale) steps.push(noteBox('warn', tn('repo.status.stale', s.stale), h('div', { style: { marginTop: '8px' } }, cmdBox('/okb:onboard refresh'))));
  if (steps.length) mount.append(h('div', { class: 'stack' }, steps), h('div', { style: { height: '16px' } }));

  mount.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('notes', 17), h('h2', null, t('repo.status.notes'))),
      h('div', { class: 'list' }, d.pack.map((p) => {
        const n = s.notes.find((x) => x.kind === p.kind);
        const [tone, mark] = NOTE_STATE[n?.state ?? 'missing'];
        return h('div', { class: 'list-item', onclick: n?.state === 'written' ? () => go(`#/note/${encodeURIComponent(n.path)}`) : null },
          h('span', { style: { fontSize: '17px' } }, p.emoji),
          h('div', { class: 'grow' }, h('div', null, p.title ?? t(`repo.note.${p.kind}`)), h('div', { class: 'small muted mono' }, n?.path ?? p.path)),
          badge(`${mark} ${t(`repo.noteState.${n?.state ?? 'missing'}`)}`, tone));
      })),
      s.tickets || s.otherNotes ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, t('repo.status.more', { tickets: s.tickets, other: s.otherNotes })) : null),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('learn', 17), h('h2', null, t('web.repos.progress'))),
      h('div', { class: 'stack', style: { gap: '12px' } },
        progress(c.answered, d.questions.length, t('web.repos.questions')),
        s.coverage.readTotal ? progress(s.coverage.readFiles, s.coverage.readTotal, t('web.repos.read')) : null,
        s.coverage.skimTotal ? progress(s.coverage.skimFiles, s.coverage.skimTotal, t('web.repos.skimmed')) : null,
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          badge(`✅ ${c.answered}`, 'ok'), badge(`🕓 ${c.pending}`, 'info'), badge(`📨 ${c.received}`), badge(`❓ ${c.unknown}`, 'warn'), badge(`⬜ ${c.open}`)),
        h('div', { class: 'small muted' }, t('web.repos.legend'))))));

  if (d.tickets?.length) mount.append(h('div', { style: { height: '16px' } }), ticketsCard(d.tickets, false));

  // The onboarding questions, by theme, with whom to ask and an inline answer.
  mount.append(h('div', { style: { height: '16px' } }), questionsCard(repo, d.questions));

  if (map) mount.append(h('div', { style: { height: '16px' } }), mapCard(map, d.risks));

  if (d.freshness.notes.length) {
    mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'card' },
      h('div', { class: 'card-head' }, icon('history', 17), h('h2', null, t('web.repos.freshness'))),
      h('div', { class: 'list' }, d.freshness.notes.map((n) => h('div', { class: 'list-item', onclick: () => go(`#/note/${encodeURIComponent(n.path)}`) },
        h('div', { class: 'grow' }, h('div', { class: 'mono small' }, n.path), n.files.length ? h('div', { class: 'small muted' }, n.files.slice(0, 3).map((f) => f.file).join(', ')) : null),
        badge(t(`repo.verdict.${n.verdict}`), VERDICT[n.verdict])))),
      d.freshness.news.length ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, `${t('repo.update.news')} : ${d.freshness.news.slice(0, 6).map((x) => x.file).join(', ')}`) : null));
  }

  if (d.landscape) {
    const article = h('div', { class: 'reader' }, h('pre', null, h('code', { class: 'language-mermaid' }, d.landscape)));
    mount.append(h('div', { style: { height: '16px' } }), h('div', { class: 'card' }, h('div', { class: 'card-head' }, icon('globe', 17), h('h2', null, t('web.repos.landscapeTitle'))), article));
    enhance(article);
  }
}

/** Tickets OKB follows: branch, commits and what the work taught, before /okb:ticket writes the note. */
function ticketsCard(tickets, showRepos) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('span', { style: { fontSize: '18px' } }, '🎫'), h('h2', null, t('web.repos.tickets'))),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.repos.ticketsLead')),
    h('div', { class: 'list' }, tickets.map((tk) => h('div', { class: 'list-item wrap', style: { alignItems: 'flex-start' } },
      h('div', { class: 'grow' },
        h('div', null, h('strong', null, tk.ref), tk.title && tk.title !== tk.ref ? ` · ${tk.title}` : ''),
        h('div', { class: 'small muted' }, [
          showRepos ? tk.repos.map((r) => r.branch ? `${r.id} (${r.branch})` : r.id).join(', ') : tk.branch ?? t('scope.noBranch'),
          tn('scope.commits', tk.commits), rel(tk.updatedAt),
        ].join(' · ')),
        tk.journal.length ? h('div', { class: 'stack', style: { gap: '2px', marginTop: '6px' } }, tk.journal.map((j) => h('div', { class: 'small' }, h('span', { class: 'muted' }, `${t(`ticket.kind.${j.kind}`)} · `), j.text))) : null),
      badge(t(`ticket.status.${tk.status}`), tk.status === 'active' ? 'info' : 'ok')))),
    h('div', { style: { marginTop: '10px' } }, cmdBox('/okb:ticket')));
}

function questionsCard(repo, questions) {
  const themes = [...new Set(questions.map((q) => q.theme))];
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, icon('help', 17), h('h2', null, t('repo.status.questions'))),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.repos.questionsLead')),
    themes.map((theme) => h('div', { style: { marginBottom: '14px' } },
      h('div', { class: 'nav-label', style: { padding: '6px 0' } }, t(`web.repos.theme.${theme}`)),
      h('div', { class: 'list' }, questions.filter((q) => q.theme === theme).map((q) => questionRow(repo, q))))));
}

function questionRow(repo, q) {
  const box = h('div', { style: { display: 'none', marginTop: '8px' } });
  const toggle = () => {
    if (box.style.display === 'none') {
      const text = h('textarea', { class: 'textarea', rows: 3, placeholder: t('web.repos.answerPlaceholder') });
      const by = h('input', { class: 'input', placeholder: t('repo.interview.who'), style: { maxWidth: '220px' } });
      clear(box).append(h('div', { class: 'stack', style: { gap: '6px' } }, text, h('div', { class: 'row' }, by,
        h('button', { class: 'btn sm primary', onclick: async (e) => {
          e.stopPropagation();
          if (!text.value.trim()) return;
          try { await post('/api/repos/answer', { id: repo.id, question: q.id, text: text.value, by: by.value }); toast(t('web.repos.answered')); go(`#/repo/${encodeURIComponent(repo.id)}?t=${Date.now()}`); } catch (err) { errorToast(err); }
        } }, t('web.repos.saveAnswer')))));
      box.style.display = 'block';
      setTimeout(() => text.focus(), 20);
    } else box.style.display = 'none';
  };
  const open = q.state === 'unknown' || q.state === 'open' || q.state === 'found';
  return h('div', { class: 'list-item', style: { alignItems: 'flex-start', cursor: 'default' } },
    h('span', { style: { fontSize: '16px' } }, STATE_ICON[q.state]),
    h('div', { class: 'grow' },
      h('div', { style: { fontWeight: open ? 600 : 400 } }, q.text),
      h('div', { class: 'small muted' }, q.state === 'answered' || q.state === 'pending'
        ? h('a', { href: `#/note/${encodeURIComponent(q.note ?? q.target)}` }, q.note ?? q.target)
        : [q.state === 'unknown' && q.why ? q.why : q.why, q.askWho ? ` · ${t('repo.questions.ask')} ${q.askWho}` : ''].filter(Boolean).join('')),
      box),
    open || q.state === 'received' ? h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); toggle(); } }, icon('plus', 14), t('web.repos.answer')) : null);
}

function mapCard(map, risks) {
  const section = (title, content) => (content ? h('div', { style: { marginBottom: '14px' } }, h('div', { class: 'nav-label', style: { padding: '6px 0' } }, title), content) : null);
  const ifaceList = (list) => h('div', { class: 'list' }, list.slice(0, 12).map((i) => h('div', { class: 'list-item', style: { cursor: 'default' } },
    badge(t(`web.repos.kind.${i.kind}`)), h('div', { class: 'grow' }, h('div', { class: 'mono small' }, i.name), i.detail ? h('div', { class: 'small muted' }, i.detail) : null), h('span', { class: 'small muted mono' }, i.at))));
  const modules = map.modules.filter((m) => m.path !== '.');
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, icon('kb', 17), h('h2', null, t('web.repos.map'))),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, t('web.repos.mapLead')),
    section(t('repo.scan.stack'), map.stack.length ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, map.stack.map((x) => badge(x.version ? `${x.label} ${x.version}` : x.label))) : null),
    section(t('repo.scan.modules'), !modules.length ? null : h('table', { class: 'table' }, h('tbody', null, modules.map((m) => h('tr', null,
      h('td', { class: 'mono' }, `${m.path}/`), h('td', null, m.role ? t(`repo.role.${m.role}`) : '—'), h('td', { class: 'muted' }, `${tn('repo.scan.nFiles', m.files)} · ${m.lines} l.`), h('td', { class: 'muted small' }, m.authors.join(', '))))))),
    section(t('repo.scan.provides'), map.provides.length ? ifaceList(map.provides) : h('div', { class: 'muted small' }, t('repo.scan.nothingFound'))),
    section(t('repo.scan.consumes'), map.consumes.length ? ifaceList(map.consumes.filter((c) => c.kind !== 'url' || c.detail !== 'local')) : h('div', { class: 'muted small' }, t('repo.scan.nothingFound'))),
    section(t('repo.scan.commands'), map.commands.some((c) => c.from !== 'docs') ? h('div', { class: 'stack', style: { gap: '6px' } }, map.commands.filter((c) => c.from !== 'docs').slice(0, 6).map((c) => cmdBox(c.run))) : null),
    section(t('repo.scan.config'), map.env.length ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, map.env.map((e) => badge(e.name, e.sensitive ? 'warn' : ''))) : null),
    risks.length ? section(t('repo.scan.watch'), h('div', { class: 'stack', style: { gap: '6px' } }, risks.slice(0, 8).map((r) => noteBox('warn', r.text)))) : null);
}
