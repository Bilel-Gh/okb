import { Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tn, useT } from '../app/i18n';
import { go, hrefFor } from '../app/router';
import { graphCategories, useGraphData } from '../graph/data';
import { GraphView } from '../graph/GraphView';

/** The note and its neighbours, drawn small under the note: a click on a dot goes there. */
export function LocalGraph({ path }: { path: string }) {
  const t = useT();
  const graph = useGraphData();
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<GraphView | null>(null);
  const [depth, setDepth] = useState(1);
  const [count, setCount] = useState(0);
  const known = graph.data?.nodes.some((n) => n.id === path) ?? false;

  useEffect(() => {
    const el = stage.current;
    if (!el || !graph.data || !known) return;
    const v = new GraphView(el, {
      nodes: graph.data.nodes, edges: graph.data.edges, categories: graphCategories(graph.data.categories, t.lang), mini: true, label: t('web.graph.local'),
      filter: { focus: path, depth: 1 }, options: { labels: 'always' },
      onSelect: (n) => { if (n && n.id !== path) go({ name: 'brain', path: n.id }); },
    });
    view.current = v;
    setCount(v.nodes.length - 1);
    return () => { v.destroy(); view.current = null; };
  }, [graph.data, known, path, t]);
  useEffect(() => { view.current?.setFilter({ depth }); if (view.current) setCount(view.current.nodes.length - 1); }, [depth]);

  if (!known) return null;
  return (
    <section className="local-graph" aria-label={t('web.graph.local')}>
      <div className="local-graph-head">
        <h3 className="links-title">{t('app.note.around')} <span className="muted num">{tn(t, 'web.graph.neighbours', count)}</span></h3>
        <span className="spacer" />
        <div className="segmented mini" role="group" aria-label={t('app.graph.depth')}>
          {[1, 2].map((d) => <button type="button" key={d} aria-pressed={depth === d} onClick={() => setDepth(d)}>{tn(t, 'web.graph.depth', d)}</button>)}
        </div>
        <a className="btn sm ghost" href={hrefFor({ name: 'graph', focus: path })}><Share2 size={14} aria-hidden="true" />{t('web.graph.inFull')}</a>
      </div>
      <div ref={stage} className="graph-stage mini" />
    </section>
  );
}
