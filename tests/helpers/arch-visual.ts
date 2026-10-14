import type { ArchLink, ArchNode } from '../../src/arch/model.js';

const node = (id: string, name: string, kind: ArchNode['kind'] = 'repo'): ArchNode => ({ id, name, kind, tech: id.replace(/^[^:]+:/, '') });
const link = (from: string, to: string, n: number, kind: ArchLink['kind'] = 'http', confidence: ArchLink['confidence'] = 'sure'): ArchLink => ({ id: `${kind}:${from}>${to}`, from, to, kind, confidence, calls: [{ what: kind === 'http' ? 'POST /orders' : kind === 'data' ? 'PostgreSQL' : 'order.created', line: n }], evidence: [{ repo: from, file: 'src/client.ts', line: n }, { repo: to, file: 'src/route.ts', line: n + 1 }], verb: kind === 'http' ? 'crée orders' : kind === 'data' ? 'stocke ses données' : 'publie order.created' });

/** Fictitious complete API response shared by component, layout and real-browser checks. */
export function architectureFixture(kind: 'small' | 'dense' | 'cycle' | 'uncertain' = 'dense') {
  const nodes: ArchNode[] = [node('repo:front', 'Boutique en ligne'), node('repo:orders', 'Service de gestion des commandes internationales et des remboursements auprès des fournisseurs partenaires'), node('repo:shipping', 'Préparation des expéditions'), node('store:shared', 'Base partagée des commandes', 'datastore')];
  const links: ArchLink[] = [link('repo:front', 'repo:orders', 3), link('repo:orders', 'repo:shipping', 6, 'event'), link('repo:shipping', 'repo:orders', 9), link('repo:orders', 'store:shared', 12, 'data'), link('repo:shipping', 'store:shared', 15, 'data')];
  if (kind === 'dense') {
    for (let i = 0; i < 13; i++) nodes.push(node(`repo:service${i}`, `Service régional des commandes ${i + 1}`));
    for (let i = 0; i < 13; i++) {
      links.push(link('repo:front', `repo:service${i}`, 20 + i, 'http', i % 3 === 0 ? 'probable' : 'sure'));
      links.push(link(`repo:service${i}`, 'repo:orders', 40 + i));
    }
    nodes.push(node('ext:partner', 'Échange avec les fournisseurs externes', 'external'));
    links.push(link('repo:orders', 'ext:partner', 60, 'external', 'to-confirm'));
  }
  if (kind === 'uncertain') { links[0] = { ...links[0]!, confidence: 'probable' }; links[1] = { ...links[1]!, confidence: 'to-confirm' }; }
  const view = { kind: 'containers' as const, boxes: nodes, arrows: links, mermaid: 'flowchart LR', check: { score: 94, findings: [] } };
  return { system: 'Boutique fictive', model: { nodes, links, questions: [{ repo: 'front', what: 'ANY /refunds', evidence: { repo: 'front', file: 'src/client.ts', line: 75 } }] }, pages: Object.fromEntries(nodes.filter((n) => n.kind === 'repo').map((n) => [n.id, n.tech])), calls: [{ from: 'repo:front', call: 'POST /orders' }], views: { containers: view, context: { ...view, kind: 'context' as const }, flow: { ...view, kind: 'flow' as const } } };
}
