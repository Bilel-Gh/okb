// #/graph?brain=1 — the brain from above, by levels: drawers and products, then a product's sides and repositories,
// then a repository's notes. A click goes one level down; the breadcrumb goes back up.
import { h, t, get, icon, loading, clear } from '../core.js';
import { setTitle, go } from '../main.js';
import { GraphView } from '../graph.js';

const KINDS = {
  drawer: { emoji: '🗄️', color: '#6366f1', colorDark: '#a5b4fc' },
  subject: { emoji: '📦', color: '#0ea5e9', colorDark: '#7dd3fc' },
  side: { emoji: '📁', color: '#14b8a6', colorDark: '#5eead4' },
  repo: { emoji: '💻', color: '#8b5cf6', colorDark: '#c4b5fd' },
  note: { emoji: '📄', color: '#64748b', colorDark: '#cbd5e1' },
  outside: { emoji: '↗️', color: '#94a3b8', colorDark: '#64748b' },
};

export async function renderBrainGraph({ mount, query }) {
  const focus = query.get('focus') ?? '';
  setTitle(t('web.brain.graph'));
  mount.append(loading(3));
  const data = await get('/api/brain/graph', { focus });
  clear(mount);
  const crumbs = h('div', { class: 'row small', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
    data.crumbs.map((c, i) => [i ? ' › ' : '', i === data.crumbs.length - 1 ? h('b', null, c.label) : h('a', { href: `#/graph?brain=1${c.focus ? `&focus=${encodeURIComponent(c.focus)}` : ''}` }, c.label)]),
    h('span', { class: 'spacer' }),
    h('a', { class: 'btn sm', href: '#/graph?notes=1' }, icon('graph', 14), t('web.brain.allNotes')));
  const stage = h('div', { class: 'graph-stage', style: { height: 'calc(100vh - 220px)' } });
  const legend = h('div', { class: 'row small muted', style: { gap: '12px', flexWrap: 'wrap', marginTop: '8px' } },
    Object.entries(KINDS).filter(([k]) => data.nodes.some((n) => n.kind === k)).map(([k, v]) => h('span', null, `${v.emoji} ${t(`web.brain.kind.${k}`)}`)));
  mount.append(crumbs, h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } }, stage), legend,
    h('div', { class: 'small muted', style: { marginTop: '6px' } }, t('web.brain.graphHint')));
  if (!data.nodes.length) { stage.append(h('div', { class: 'small muted', style: { padding: '20px' } }, t('web.brain.emptySubject'))); return; }
  const categories = Object.entries(KINDS).map(([id, v]) => ({ id, name: t(`web.brain.kind.${id}`), emoji: v.emoji, color: v.color, colorDark: v.colorDark }));
  const nodes = data.nodes.map((n) => ({ id: n.id, title: `${n.kind === 'note' ? '' : `${KINDS[n.kind].emoji} `}${n.label}${n.kind === 'note' ? '' : ` · ${n.notes}`}`, category: n.kind, weight: n.kind === 'note' ? 0 : n.notes, path: n.path, drill: n.drill }));
  const edges = data.edges.map((e) => ({ source: e.from, target: e.to, kind: 'link' }));
  const view = new GraphView(stage, {
    nodes, edges, categories,
    onSelect: () => {},
    onOpen: (n) => {
      if (n.drill) go(`#/graph?brain=1&focus=${encodeURIComponent(n.drill)}`);
      else if (n.path) go(`#/note/${encodeURIComponent(n.path)}`);
    },
  });
  view.setOptions({ labels: 'all', groupBy: 'none' });
}
