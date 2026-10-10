import type { ArchLink, ArchNode, SystemModel } from './model.js';

/**
 * Diagrams drawn from the system model (src/arch/model.ts), never from memory:
 * containers (the repositories, their datastores and outside systems, at most
 * twelve boxes) and flows (a sequence following the calls from an entry point).
 * Boxes carry a name people understand with the technical id small below it;
 * arrows go in the direction of the call and carry a verb.
 */
export type View = {
  readonly kind: 'context' | 'containers' | 'flow';
  readonly boxes: readonly ArchNode[];
  readonly arrows: readonly ArchLink[];
  readonly mermaid: string;
  readonly legend: readonly string[];
};

export const MAX_BOXES = 12;

const mid = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');
const quote = (s: string) => s.replace(/"/g, "'").replace(/[<>]/g, '');
const label = (n: ArchNode) => (n.name === n.tech ? quote(n.name) : `${quote(n.name)}<br/><small>${quote(n.tech)}</small>`);

function shape(n: ArchNode): string {
  if (n.kind === 'datastore') return `${mid(n.id)}[("${label(n)}")]`;
  if (n.kind === 'external') return `${mid(n.id)}(["${label(n)}"])`;
  return `${mid(n.id)}["${label(n)}"]`;
}

function arrow(l: ArchLink): string {
  const verb = quote(l.verb || '');
  const text = l.calls.length > 1 ? `${verb} +${l.calls.length - 1}` : verb;
  if (l.kind === 'event') return `${mid(l.from)} -.->|"${text}"| ${mid(l.to)}`;
  if (l.kind === 'package') return `${mid(l.from)} -.-o|"${text}"| ${mid(l.to)}`;
  return `${mid(l.from)} -->|"${text}"| ${mid(l.to)}`;
}

export function containersView(model: SystemModel, options: { lang?: 'fr' | 'en' } = {}): View {
  const fr = (options.lang ?? 'fr') === 'fr';
  // Repositories first, then datastores, then outside systems; beyond twelve, outside systems are grouped.
  const order = (n: ArchNode) => (n.kind === 'repo' ? 0 : n.kind === 'datastore' ? 1 : 2);
  const all = [...model.nodes].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  let boxes = all.slice(0, MAX_BOXES);
  const hidden = all.slice(MAX_BOXES);
  let arrows = model.links.filter((l) => boxes.some((b) => b.id === l.from) && boxes.some((b) => b.id === l.to));
  if (hidden.length) {
    const others: ArchNode = { id: 'ext:others', kind: 'external', name: fr ? `${hidden.length + 1} autres systèmes` : `${hidden.length + 1} other systems`, tech: hidden.map((h) => h.tech).slice(0, 3).join(', ') };
    const lastKept = boxes[boxes.length - 1]!;
    boxes = [...boxes.slice(0, -1), others];
    const folded = new Set([lastKept.id, ...hidden.map((h) => h.id)]);
    arrows = [
      ...model.links.filter((l) => boxes.some((b) => b.id === l.from) && boxes.some((b) => b.id === l.to)),
      ...model.links.filter((l) => folded.has(l.to) && boxes.some((b) => b.id === l.from)).map((l) => ({ ...l, to: others.id, id: `${l.id}>others`, verb: fr ? 'appelle' : 'calls' })),
    ];
  }
  const mermaid = ['flowchart LR', ...boxes.map((b) => `  ${shape(b)}`), ...arrows.map((a) => `  ${arrow(a)}`)].join('\n');
  const legend = fr
    ? ['flèche pleine : appel (HTTP, service)', 'pointillés : événement publié → écouté', 'pointillés à rond : bibliothèque utilisée', 'cylindre : base de données', 'ovale : système extérieur']
    : ['solid arrow: call (HTTP, service)', 'dotted: event published → listened to', 'dotted with a circle: library used', 'cylinder: database', 'oval: outside system'];
  return { kind: 'containers', boxes, arrows, mermaid, legend };
}

/**
 * The context: the whole system as one box, and the outside systems it calls
 * around it — what a newcomer needs first, before the inside.
 */
export function contextView(model: SystemModel, systemName: string, options: { lang?: 'fr' | 'en' } = {}): View {
  const fr = (options.lang ?? 'fr') === 'fr';
  const system: ArchNode = { id: 'system', kind: 'system', name: systemName, tech: fr ? `${model.nodes.filter((n) => n.kind === 'repo').length} repos` : `${model.nodes.filter((n) => n.kind === 'repo').length} repositories` };
  const outside = model.nodes.filter((n) => n.kind === 'external').slice(0, MAX_BOXES - 1);
  const arrows: ArchLink[] = outside.map((o) => {
    const into = model.links.filter((l) => l.to === o.id);
    return { id: `context>${o.id}`, from: system.id, to: o.id, kind: 'external', confidence: into.every((l) => l.confidence === 'sure') ? 'sure' : 'probable', calls: into.flatMap((l) => l.calls), evidence: into.flatMap((l) => l.evidence), verb: into[0]?.verb ?? (fr ? 'appelle' : 'calls') };
  });
  const boxes = [system, ...outside];
  const mermaid = ['flowchart LR', ...boxes.map((b) => `  ${shape(b)}`), ...arrows.map((a) => `  ${arrow(a)}`)].join('\n');
  return { kind: 'context', boxes, arrows, mermaid, legend: fr ? ['rectangle : le système (tous les repos)', 'ovale : système extérieur'] : ['rectangle: the system (all repositories)', 'oval: outside system'] };
}

/**
 * The ways into the system: repositories that call others and that nobody
 * calls (a web front, a public API), with their first call in the code.
 */
export function entryPoints(model: SystemModel): { repo: string; call: string }[] {
  const flowing = (l: ArchLink) => l.kind === 'http' || l.kind === 'event';
  const called = new Set(model.links.filter(flowing).map((l) => l.to));
  return model.nodes
    .filter((n) => n.kind === 'repo' && !called.has(n.id))
    .flatMap((n) => {
      const first = model.links.filter((l) => l.from === n.id && l.kind === 'http').flatMap((l) => l.calls).sort((a, b) => a.line - b.line)[0];
      return first ? [{ repo: n.id, call: first.what }] : [];
    });
}

/**
 * A flow: from an entry repository and one of its calls, follow the calls and
 * events breadth first, each link once, in the order the code makes them.
 */
export function flowView(model: SystemModel, start: string, call: string, options: { lang?: 'fr' | 'en'; max?: number } = {}): View & { steps: { from: string; to: string; what: string; verb: string }[] } {
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.tech ?? id;
  const steps: { from: string; to: string; what: string; verb: string }[] = [];
  const used = new Set<string>();
  const first = model.links.find((l) => l.from === start && l.calls.some((c) => c.what === call));
  const arrows: ArchLink[] = [];
  const queue: ArchLink[] = first ? [first] : [];
  const expanded = new Set<string>([start]);
  while (queue.length && steps.length < (options.max ?? 12)) {
    const l = queue.shift()!;
    if (used.has(l.id)) continue;
    used.add(l.id);
    arrows.push(l);
    // The first step is the call the person chose, not the first call of its link (F2.0-34).
    steps.push({ from: name(l.from), to: name(l.to), what: l === first ? call : (l.calls[0]?.what ?? ''), verb: l.verb });
    if (expanded.has(l.to)) continue;
    expanded.add(l.to);
    const next = model.links.filter((x) => x.from === l.to && (x.kind === 'http' || x.kind === 'event')).sort((a, b) => (a.calls[0]?.line ?? 0) - (b.calls[0]?.line ?? 0));
    queue.push(...next);
  }
  const ids = [...new Set(arrows.flatMap((a) => [a.from, a.to]))];
  const boxes = ids.map((id) => model.nodes.find((n) => n.id === id)).filter((n): n is ArchNode => Boolean(n));
  const mermaid = [
    'sequenceDiagram',
    ...boxes.map((b) => `  participant ${mid(b.id)} as ${quote(b.name)}`),
    ...arrows.map((a) => `  ${mid(a.from)}${a.kind === 'event' ? '--)' : '->>'}${mid(a.to)}: ${quote(a.verb)}${a.calls[0] ? ` (${quote(a.calls[0].what)})` : ''}`),
  ].join('\n');
  const fr = (options.lang ?? 'fr') === 'fr';
  return { kind: 'flow', boxes, arrows, mermaid, legend: fr ? ['flèche pleine : appel', 'flèche ouverte : événement'] : ['solid arrow: call', 'open arrow: event'], steps };
}
